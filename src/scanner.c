#include "tree_sitter/alloc.h"
#include "tree_sitter/parser.h"

#include <wctype.h>

enum TokenType {
    STRING_CONTENT,
    STRING_CLOSE,
    RAW_STRING_LITERAL_START,
    RAW_STRING_LITERAL_CONTENT,
    RAW_STRING_LITERAL_END,
    TRAILING_DOT_FLOAT_LITERAL,
    BLOCK_OUTER_DOC_MARKER,
    BLOCK_INNER_DOC_MARKER,
    BLOCK_COMMENT_CONTENT,
    LINE_DOC_CONTENT,
    RANGE_UNARY_ENDPOINT_START,
    ERROR_SENTINEL,
    FOREIGN_DECLARATION_CONTEXT,
    FOREIGN_DECLARATION_START,
    MACRO_METAVARIABLE_NAME,
    LITERAL_SUFFIX_START,
    FRONTMATTER_START,
    FRONTMATTER_HEADER_END,
    FRONTMATTER_CONTENT,
    FRONTMATTER_END,
    FRONTMATTER_CONTEXT,
    ORDINARY_LINE_COMMENT,
    INNER_LINE_COMMENT_START,
    OUTER_LINE_COMMENT_START,
    ORDINARY_BLOCK_COMMENT_START,
    OUTER_BLOCK_COMMENT_START
};

#include "frontmatter.h"

typedef struct {
    Frontmatter frontmatter;
    uint8_t opening_hash_count;
    uint8_t literal_suffix_pending;
} Scanner;

void *tree_sitter_rust_external_scanner_create() { return ts_calloc(1, sizeof(Scanner)); }

void tree_sitter_rust_external_scanner_destroy(void *payload) { ts_free((Scanner *)payload); }

unsigned tree_sitter_rust_external_scanner_serialize(void *payload, char *buffer) {
    Scanner *scanner = (Scanner *)payload;
    buffer[0] = (char)scanner->opening_hash_count;
    buffer[1] = (char)scanner->literal_suffix_pending;
    for (unsigned i = 0; i < 4; i++) buffer[2 + i] = (char)(scanner->frontmatter.fence_length >> (8 * i));
    buffer[6] = scanner->frontmatter.allowed;
    return 7;
}

void tree_sitter_rust_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
    Scanner *scanner = (Scanner *)payload;
    scanner->frontmatter.fence_length = 0;
    scanner->frontmatter.allowed = false;
    scanner->opening_hash_count = 0;
    scanner->literal_suffix_pending = 0;
    if (length == 7) scanner->frontmatter.allowed = buffer[6];
    if (length > 0) scanner->opening_hash_count = (uint8_t)buffer[0];
    if (length > 1) scanner->literal_suffix_pending = (uint8_t)buffer[1];
    if (length >= 6) {
        for (unsigned i = 0; i < 4; i++) scanner->frontmatter.fence_length |= (uint32_t)(uint8_t)buffer[2 + i] << (8 * i);
    }
}

static inline bool is_num_char(int32_t c) { return c == '_' || iswdigit(c); }

static inline void advance(TSLexer *lexer) { lexer->advance(lexer, false); }

static inline void skip(TSLexer *lexer) { lexer->advance(lexer, true); }

static inline bool scan_range_unary_endpoint_start(TSLexer *lexer);

static inline bool process_string(TSLexer *lexer) {
    bool has_content = false;
    for (;;) {
        if (lexer->lookahead == '\"' || lexer->lookahead == '\\') {
            break;
        }
        if (lexer->eof(lexer)) {
            return false;
        }
        has_content = true;
        advance(lexer);
    }
    lexer->result_symbol = STRING_CONTENT;
    lexer->mark_end(lexer);
    return has_content;
}

static inline bool scan_raw_string_start_rest(Scanner *scanner, TSLexer *lexer);

static inline bool scan_raw_string_start(Scanner *scanner, TSLexer *lexer) {
    if (lexer->lookahead == 'b' || lexer->lookahead == 'c') {
        advance(lexer);
    }
    if (lexer->lookahead != 'r') {
        return false;
    }
    advance(lexer);

    return scan_raw_string_start_rest(scanner, lexer);
}

static inline bool scan_raw_string_start_rest(Scanner *scanner, TSLexer *lexer) {
    uint8_t opening_hash_count = 0;
    while (lexer->lookahead == '#') {
        advance(lexer);
        opening_hash_count++;
    }

    if (lexer->lookahead != '"') {
        return false;
    }
    advance(lexer);
    scanner->opening_hash_count = opening_hash_count;

    lexer->result_symbol = RAW_STRING_LITERAL_START;
    return true;
}

static inline bool scan_raw_string_content(Scanner *scanner, TSLexer *lexer) {
    for (;;) {
        if (lexer->eof(lexer)) {
            return false;
        }
        if (lexer->lookahead == '"') {
            lexer->mark_end(lexer);
            advance(lexer);
            unsigned hash_count = 0;
            while (lexer->lookahead == '#' && hash_count < scanner->opening_hash_count) {
                advance(lexer);
                hash_count++;
            }
            if (hash_count == scanner->opening_hash_count) {
                lexer->result_symbol = RAW_STRING_LITERAL_CONTENT;
                return true;
            }
        } else {
            advance(lexer);
        }
    }
}

static void mark_string_end(Scanner *scanner, TSLexer *lexer);

static inline bool scan_raw_string_end(Scanner *scanner, TSLexer *lexer) {
    advance(lexer);
    for (unsigned i = 0; i < scanner->opening_hash_count; i++) {
        advance(lexer);
    }
    lexer->result_symbol = RAW_STRING_LITERAL_END;
    mark_string_end(scanner, lexer);
    return true;
}

static bool scan_string_tokens(Scanner *scanner, TSLexer *lexer, const bool *valid_symbols) {
    if (valid_symbols[LITERAL_SUFFIX_START] && scanner->literal_suffix_pending) {
        scanner->literal_suffix_pending = 0;
        lexer->result_symbol = LITERAL_SUFFIX_START;
        return true;
    }
    if (valid_symbols[STRING_CONTENT] && !valid_symbols[TRAILING_DOT_FLOAT_LITERAL] && process_string(lexer)) return true;
    if (!valid_symbols[STRING_CLOSE] || lexer->lookahead != '"') return false;
    advance(lexer);
    lexer->result_symbol = STRING_CLOSE;
    mark_string_end(scanner, lexer);
    return true;
}

static bool is_literal_suffix_candidate(int32_t c);

// The zero-width marker gates the internal suffix token: token.immediate alone still permits comment extras.
static void mark_string_end(Scanner *scanner, TSLexer *lexer) {
    lexer->mark_end(lexer);
    scanner->literal_suffix_pending = is_literal_suffix_candidate(lexer->lookahead);
}

static bool is_literal_suffix_candidate(int32_t c) {
    // Unicode validity is checked by the internal lexer after the marker. Exclude whitespace here so it cannot
    // create a suffix path after trivia, including characters that the Wasm C locale does not classify as spaces.
    if (c >= 0x2000 && c <= 0x200a) return false;
    switch (c) {
        case 0x85: case 0xa0: case 0x1680:
        case 0x200e: case 0x200f:
        case 0x2028: case 0x2029: case 0x202f: case 0x205f: case 0x3000: case 0xfeff:
            return false;
        default:
            return c == '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c >= 0x80;
    }
}

static inline bool process_trailing_dot_float_literal(TSLexer *lexer) {
    lexer->result_symbol = TRAILING_DOT_FLOAT_LITERAL;
    advance(lexer);
    while (is_num_char(lexer->lookahead)) {
        advance(lexer);
    }
    if (lexer->lookahead != '.') {
        return false;
    }
    advance(lexer);
    if (iswalpha(lexer->lookahead) || is_num_char(lexer->lookahead) || lexer->lookahead == '.') {
        return false;
    }
    lexer->mark_end(lexer);
    return true;
}

static inline bool process_line_doc_content(TSLexer *lexer) {
    lexer->result_symbol = LINE_DOC_CONTENT;
    for (;;) {
        if (lexer->eof(lexer)) {
            return true;
        }
        if (lexer->lookahead == '\n') {
            // Line endings are useful for markdown injection.
            advance(lexer);
            return true;
        }
        advance(lexer);
    }
}

typedef enum {
    LeftForwardSlash,
    LeftAsterisk,
    Continuing,
} BlockCommentState;

typedef struct {
    BlockCommentState state;
    unsigned nestingDepth;
} BlockCommentProcessing;

static inline void process_left_forward_slash(BlockCommentProcessing *processing, int32_t current) {
    if (current == '*') {
        processing->nestingDepth += 1;
    } else if (current == '/') {
        processing->state = LeftForwardSlash;
        return;
    }
    processing->state = Continuing;
};

static inline void process_left_asterisk(BlockCommentProcessing *processing, int32_t current, TSLexer *lexer) {
    if (current == '*') {
        lexer->mark_end(lexer);
        processing->state = LeftAsterisk;
        return;
    }

    if (current == '/') {
        processing->nestingDepth -= 1;
    }

    processing->state = Continuing;
}

static inline void process_continuing(BlockCommentProcessing *processing, int32_t current) {
    switch (current) {
        case '/':
            processing->state = LeftForwardSlash;
            break;
        case '*':
            processing->state = LeftAsterisk;
            break;
    }
}

static inline bool process_block_comment(TSLexer *lexer, const bool *valid_symbols) {
    int32_t first = lexer->lookahead;
    // Paths reaching the comment-state initializer must advance exactly once, so first is the character just consumed.
    if (valid_symbols[BLOCK_INNER_DOC_MARKER] && first == '!') {
        lexer->result_symbol = BLOCK_INNER_DOC_MARKER;
        advance(lexer);
        return true;
    }
    if (valid_symbols[BLOCK_OUTER_DOC_MARKER] && first == '*') {
        advance(lexer);
        lexer->mark_end(lexer);
        if (lexer->lookahead == '/') {
            return false;
        }
        if (lexer->lookahead != '*') {
            lexer->result_symbol = BLOCK_OUTER_DOC_MARKER;
            return true;
        }
    } else {
        advance(lexer);
    }

    if (valid_symbols[BLOCK_COMMENT_CONTENT]) {
        BlockCommentProcessing processing = {Continuing, 1};
        switch (first) {
            case '*':
                processing.state = LeftAsterisk;
                if (lexer->lookahead == '/') {
                    return false;
                }
                break;
            case '/':
                processing.state = LeftForwardSlash;
                break;
            default:
                processing.state = Continuing;
                break;
        }

        // Accept unterminated content so highlighting remains available while the closing delimiter is being typed.
        while (!lexer->eof(lexer) && processing.nestingDepth != 0) {
            first = lexer->lookahead;
            switch (processing.state) {
                case LeftForwardSlash:
                    process_left_forward_slash(&processing, first);
                    break;
                case LeftAsterisk:
                    process_left_asterisk(&processing, first, lexer);
                    break;
                case Continuing:
                    lexer->mark_end(lexer);
                    process_continuing(&processing, first);
                    break;
                default:
                    break;
            }
            advance(lexer);
            if (first == '/' && processing.nestingDepth != 0) {
                lexer->mark_end(lexer);
            }
        }
        lexer->result_symbol = BLOCK_COMMENT_CONTENT;
        return true;
    }

    return false;
}

static bool scan_macro_metavariable_name(Scanner *scanner, TSLexer *lexer, bool raw_string_valid);
static bool scan_foreign_declaration_start(TSLexer *lexer);
static bool foreign_restricted_visibility(TSLexer *lexer);
static bool foreign_identifier(TSLexer *lexer);
static bool foreign_word(TSLexer *lexer, const char *word);
static bool foreign_identifier_continue(int32_t c);
static bool skip_trivia(TSLexer *lexer);
static bool skip_block_trivia(TSLexer *lexer);
static bool scanner_whitespace(int32_t c);
static bool scan_comment_start(TSLexer *lexer, const bool *valid_symbols);
static void skip_token_whitespace(TSLexer *lexer, bool frontmatter_start);

bool tree_sitter_rust_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    // Recovery enables every external token; only comment starts are safe without parser context.
    if (valid_symbols[ERROR_SENTINEL]) {
        skip_token_whitespace(lexer, false);
        return lexer->lookahead == '/' && scan_comment_start(lexer, valid_symbols);
    }

    Scanner *scanner = (Scanner *)payload;
    if (valid_symbols[FRONTMATTER_CONTEXT] || valid_symbols[FRONTMATTER_CONTENT] ||
        valid_symbols[FRONTMATTER_HEADER_END] || valid_symbols[FRONTMATTER_END]) {
        return scan_frontmatter_token(&scanner->frontmatter, lexer, valid_symbols);
    }

    if (valid_symbols[BLOCK_COMMENT_CONTENT] || valid_symbols[BLOCK_INNER_DOC_MARKER] ||
        valid_symbols[BLOCK_OUTER_DOC_MARKER]) {
        return process_block_comment(lexer, valid_symbols);
    }

    if (scan_string_tokens(scanner, lexer, valid_symbols)) return true;

    if (valid_symbols[LINE_DOC_CONTENT]) {
        return process_line_doc_content(lexer);
    }

    if (valid_symbols[RAW_STRING_LITERAL_CONTENT]) {
        return scan_raw_string_content(scanner, lexer);
    }

    skip_token_whitespace(lexer, valid_symbols[FRONTMATTER_START]);
    if (valid_symbols[FRONTMATTER_START] && lexer->lookahead == '-') {
        return scan_frontmatter_start(&scanner->frontmatter, lexer);
    }
    if (lexer->lookahead == '/') return scan_comment_start(lexer, valid_symbols);
    if (valid_symbols[FOREIGN_DECLARATION_CONTEXT] && valid_symbols[FOREIGN_DECLARATION_START]) {
        return scan_foreign_declaration_start(lexer);
    }

    if (valid_symbols[MACRO_METAVARIABLE_NAME] &&
        (lexer->lookahead == '_' || (lexer->lookahead >= 'a' && lexer->lookahead <= 'z') ||
         (lexer->lookahead >= 'A' && lexer->lookahead <= 'Z'))) {
        return scan_macro_metavariable_name(scanner, lexer, valid_symbols[RAW_STRING_LITERAL_START]);
    }

    if (valid_symbols[RANGE_UNARY_ENDPOINT_START] &&
        (lexer->lookahead == '*' || lexer->lookahead == '-' || lexer->lookahead == '!' || lexer->lookahead == '&' ||
         lexer->lookahead == '/')) {
        return scan_range_unary_endpoint_start(lexer);
    }

    if (valid_symbols[RAW_STRING_LITERAL_START] &&
        (lexer->lookahead == 'r' || lexer->lookahead == 'b' || lexer->lookahead == 'c')) {
        return scan_raw_string_start(scanner, lexer);
    }

    if (valid_symbols[RAW_STRING_LITERAL_END] && lexer->lookahead == '"') {
        return scan_raw_string_end(scanner, lexer);
    }

    return valid_symbols[TRAILING_DOT_FLOAT_LITERAL] && iswdigit(lexer->lookahead) &&
        process_trailing_dot_float_literal(lexer);
}

static bool scan_macro_metavariable_name(Scanner *scanner, TSLexer *lexer, bool raw_string_valid) {
    int32_t c = lexer->lookahead;
    char prefix[2] = {0};
    unsigned length = 0;
    do {
        if (length < sizeof(prefix)) prefix[length] = (char)c;
        length++;
        advance(lexer);
        c = lexer->lookahead;
    } while (c == '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9'));
    if (c >= 0x80 && !rust_whitespace(c)) return false;
    bool byte_prefix = length == 1 && prefix[0] == 'b';
    bool string_prefix = length == 1 && (prefix[0] == 'r' || prefix[0] == 'c' || byte_prefix);
    bool raw_prefix = (length == 1 && prefix[0] == 'r') ||
        (length == 2 && (prefix[0] == 'b' || prefix[0] == 'c') && prefix[1] == 'r');
    if (raw_prefix && (c == '"' || c == '#')) {
        return raw_string_valid && scan_raw_string_start_rest(scanner, lexer);
    }
    if ((c == '"' && string_prefix) || (c == '\'' && byte_prefix)) return false;
    lexer->mark_end(lexer);
    lexer->result_symbol = MACRO_METAVARIABLE_NAME;
    return true;
}

static inline bool scan_range_unary_endpoint_start(TSLexer *lexer) {
    lexer->mark_end(lexer);
    if (!skip_trivia(lexer)) return false;
    if (lexer->lookahead != '*' && lexer->lookahead != '-' && lexer->lookahead != '!' && lexer->lookahead != '&') {
        return false;
    }
    advance(lexer);
    lexer->result_symbol = RANGE_UNARY_ENDPOINT_START;
    return true;
}

static bool scan_foreign_declaration_start(TSLexer *lexer) {
    lexer->mark_end(lexer);
    if (lexer->lookahead == 'p') {
        if (!foreign_word(lexer, "pub") || !skip_trivia(lexer)) return false;
        if (lexer->lookahead == '(') {
            advance(lexer);
            if (!foreign_restricted_visibility(lexer) || lexer->lookahead != ')') return false;
            advance(lexer);
        }
        if (!skip_trivia(lexer)) return false;
    }
    if (lexer->lookahead == 'c') {
        if (!foreign_word(lexer, "crate") || !skip_trivia(lexer)) return false;
    }
    bool safe = lexer->lookahead == 's';
    if (!foreign_word(lexer, safe ? "safe" : "unsafe") || !skip_trivia(lexer)) return false;
    bool function = lexer->lookahead == 'f';
    if (function && !safe) return false;
    if (!foreign_word(lexer, function ? "fn" : "static")) return false;
    lexer->result_symbol = FOREIGN_DECLARATION_START;
    return true;
}

static bool foreign_restricted_visibility(TSLexer *lexer) {
    if (!skip_trivia(lexer)) return false;
    if (lexer->lookahead == 'i') {
        if (!foreign_word(lexer, "in") || !skip_trivia(lexer)) return false;
        if (lexer->lookahead == ':') {
            advance(lexer);
            if (lexer->lookahead != ':') return false;
            advance(lexer);
            if (!skip_trivia(lexer)) return false;
        }
        for (;;) {
            if (!foreign_identifier(lexer) || !skip_trivia(lexer)) return false;
            if (lexer->lookahead != ':') return true;
            advance(lexer);
            if (lexer->lookahead != ':') return false;
            advance(lexer);
            if (!skip_trivia(lexer)) return false;
        }
    }
    if (lexer->lookahead == 'c') {
        if (!foreign_word(lexer, "crate")) return false;
    } else if (lexer->lookahead == 's') {
        advance(lexer);
        if (!foreign_word(lexer, lexer->lookahead == 'e' ? "elf" : "uper")) return false;
    } else return false;
    return skip_trivia(lexer);
}

static bool foreign_identifier(TSLexer *lexer) {
    if (lexer->lookahead == '$') advance(lexer);
    bool started = false;
    if (lexer->lookahead == 'r') {
        advance(lexer);
        started = true;
        if (lexer->lookahead == '#') { advance(lexer); started = false; }
    }
    if (!started) {
        int32_t c = lexer->lookahead;
        if (!(c == '_' || iswalpha(c) || (c >= 0x80 && !rust_whitespace(c)))) return false;
        advance(lexer);
    }
    while (foreign_identifier_continue(lexer->lookahead)) advance(lexer);
    return true;
}

static bool foreign_word(TSLexer *lexer, const char *word) {
    for (; *word; word++) {
        if (lexer->lookahead != *word) return false;
        advance(lexer);
    }
    return !foreign_identifier_continue(lexer->lookahead);
}

static bool foreign_identifier_continue(int32_t c) {
    return c == '_' || iswalnum(c) || (c >= 0x80 && !rust_whitespace(c));
}

static bool skip_trivia(TSLexer *lexer) {
    for (;;) {
        while (scanner_whitespace(lexer->lookahead)) advance(lexer);
        if (lexer->lookahead != '/') return true;
        advance(lexer);
        if (lexer->lookahead == '/') {
            while (!lexer->eof(lexer) && lexer->lookahead != '\n') advance(lexer);
            continue;
        }
        if (lexer->lookahead != '*' || !skip_block_trivia(lexer)) return false;
    }
}

static bool skip_block_trivia(TSLexer *lexer) {
    advance(lexer);
    unsigned depth = 1;
    while (depth > 0 && !lexer->eof(lexer)) {
        int32_t previous = lexer->lookahead;
        advance(lexer);
        if (previous == '/' && lexer->lookahead == '*') { advance(lexer); depth++; }
        else if (previous == '*' && lexer->lookahead == '/') { advance(lexer); depth--; }
    }
    return depth == 0;
}

static bool scanner_whitespace(int32_t c) { return rust_whitespace(c) || iswspace(c); }

static bool scan_comment_start(TSLexer *lexer, const bool *valid_symbols) {
    advance(lexer);
    bool line = lexer->lookahead == '/';
    if (!line && lexer->lookahead != '*') return false;
    advance(lexer);
    lexer->mark_end(lexer);
    if (line && lexer->lookahead == '!') {
        if (!valid_symbols[INNER_LINE_COMMENT_START]) return false;
        lexer->result_symbol = INNER_LINE_COMMENT_START;
        return true;
    }
    bool outer = false;
    if (lexer->lookahead == (line ? '/' : '*')) {
        advance(lexer);
        outer = line ? lexer->lookahead != '/' : lexer->lookahead != '*' && lexer->lookahead != '/';
    }
    enum TokenType token = line ? ORDINARY_LINE_COMMENT : ORDINARY_BLOCK_COMMENT_START;
    if (outer) token = line ? OUTER_LINE_COMMENT_START : OUTER_BLOCK_COMMENT_START;
    if (!valid_symbols[token]) return false;
    if (token == ORDINARY_LINE_COMMENT) {
        while (!lexer->eof(lexer) && lexer->lookahead != '\n') advance(lexer);
        lexer->mark_end(lexer);
    }
    lexer->result_symbol = token;
    return true;
}

static void skip_token_whitespace(TSLexer *lexer, bool frontmatter_start) {
    while (frontmatter_start ? rust_whitespace(lexer->lookahead) : scanner_whitespace(lexer->lookahead)) {
        skip(lexer);
    }
}
