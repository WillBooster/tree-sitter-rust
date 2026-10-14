#ifndef TREE_SITTER_RUST_FRONTMATTER_H_
#define TREE_SITTER_RUST_FRONTMATTER_H_

#include <ctype.h>
#include <stdint.h>

typedef struct {
    uint32_t fence_length;
    bool allowed;
} Frontmatter;

static bool frontmatter_space(int32_t c);
static bool frontmatter_header_valid(TSLexer *lexer);

typedef struct {
    bool after_first_line;
    int32_t next_line_start;
} ShebangProbe;

static bool frontmatter_shebang_prefix(TSLexer *lexer);
static bool frontmatter_shebang_attribute(ShebangProbe *probe, TSLexer *lexer);
static bool skip_frontmatter_shebang_block(ShebangProbe *probe, TSLexer *lexer);
static void frontmatter_shebang_advance(ShebangProbe *probe, TSLexer *lexer);

static bool scan_frontmatter_context(Frontmatter *state, TSLexer *lexer) {
    lexer->mark_end(lexer);
    if (lexer->lookahead == '#') {
        state->allowed = frontmatter_shebang_prefix(lexer);
    } else {
        while (iswspace(lexer->lookahead)) lexer->advance(lexer, false);
        state->allowed = lexer->lookahead == '-';
    }
    lexer->result_symbol = FRONTMATTER_CONTEXT;
    return true;
}

static bool frontmatter_shebang_prefix(TSLexer *lexer) {
    lexer->advance(lexer, false);
    if (lexer->lookahead != '!') return false;
    lexer->advance(lexer, false);
    ShebangProbe probe = {.after_first_line = false, .next_line_start = -1};
    if (frontmatter_shebang_attribute(&probe, lexer)) return false;
    while (probe.next_line_start < 0 && !lexer->eof(lexer)) frontmatter_shebang_advance(&probe, lexer);
    return probe.next_line_start == '-';
}

static bool frontmatter_shebang_attribute(ShebangProbe *probe, TSLexer *lexer) {
    for (;;) {
        while (iswspace(lexer->lookahead)) frontmatter_shebang_advance(probe, lexer);
        if (lexer->lookahead != '/') return lexer->lookahead == '[';
        frontmatter_shebang_advance(probe, lexer);
        if (lexer->lookahead == '/') {
            while (!lexer->eof(lexer) && lexer->lookahead != '\n') frontmatter_shebang_advance(probe, lexer);
            continue;
        }
        if (lexer->lookahead != '*' || !skip_frontmatter_shebang_block(probe, lexer)) return false;
    }
}

static bool skip_frontmatter_shebang_block(ShebangProbe *probe, TSLexer *lexer) {
    frontmatter_shebang_advance(probe, lexer);
    if (lexer->lookahead == '!') return false;
    int32_t previous = 0;
    if (lexer->lookahead == '*') {
        frontmatter_shebang_advance(probe, lexer);
        if (lexer->lookahead != '*' && lexer->lookahead != '/') return false;
        previous = '*';
    }
    unsigned depth = 1;
    while (depth && !lexer->eof(lexer)) {
        int32_t current = lexer->lookahead;
        frontmatter_shebang_advance(probe, lexer);
        if (previous == '/' && current == '*') { depth++; current = 0; }
        else if (previous == '*' && current == '/') { depth--; current = 0; }
        previous = current;
    }
    return true;
}

static void frontmatter_shebang_advance(ShebangProbe *probe, TSLexer *lexer) {
    int32_t current = lexer->lookahead;
    if (probe->after_first_line && probe->next_line_start < 0 && !iswspace(current)) probe->next_line_start = current;
    if (current == '\n') probe->after_first_line = true;
    lexer->advance(lexer, false);
}

static bool scan_frontmatter_start(Frontmatter *state, TSLexer *lexer) {
    if (!state->allowed || lexer->get_column(lexer) != 0) return false;
    uint32_t length = 0;
    while (lexer->lookahead == '-') {
        if (length == 255) return false;
        length++;
        lexer->advance(lexer, false);
    }
    if (length < 3) return false;
    while (frontmatter_space(lexer->lookahead)) lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    if (!frontmatter_header_valid(lexer)) return false;
    state->fence_length = length;
    lexer->result_symbol = FRONTMATTER_START;
    return true;
}

static bool scan_frontmatter_header_end(TSLexer *lexer) {
    while (frontmatter_space(lexer->lookahead)) lexer->advance(lexer, false);
    if (lexer->lookahead == '\r') lexer->advance(lexer, false);
    if (lexer->lookahead != '\n') return false;
    lexer->advance(lexer, false);
    lexer->result_symbol = FRONTMATTER_HEADER_END;
    return true;
}

static bool scan_frontmatter_content(Frontmatter *state, TSLexer *lexer) {
    while (!lexer->eof(lexer)) {
        if (lexer->get_column(lexer) == 0 && lexer->lookahead == '-') {
            lexer->mark_end(lexer);
            uint32_t length = 0;
            while (lexer->lookahead == '-' && length < state->fence_length) {
                length++;
                lexer->advance(lexer, false);
            }
            if (length == state->fence_length) {
                lexer->result_symbol = FRONTMATTER_CONTENT;
                return true;
            }
        } else {
            lexer->advance(lexer, false);
        }
    }
    return false;
}

static bool scan_frontmatter_end(Frontmatter *state, TSLexer *lexer) {
    if (lexer->get_column(lexer) != 0) return false;
    for (uint32_t i = 0; i < state->fence_length; i++) {
        if (lexer->lookahead != '-') return false;
        lexer->advance(lexer, false);
    }
    while (frontmatter_space(lexer->lookahead)) lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    if (lexer->lookahead == '\r') {
        lexer->advance(lexer, false);
        if (lexer->lookahead != '\n') return false;
    } else if (lexer->lookahead != '\n' && !lexer->eof(lexer)) return false;
    lexer->result_symbol = FRONTMATTER_END;
    return true;
}

// The grammar token checks Unicode identifiers; this preflight prevents comment extras inside the header.
static bool frontmatter_header_valid(TSLexer *lexer) {
    bool trailing_space = false;
    bool first = true;
    while (lexer->lookahead != '\n' && lexer->lookahead != '\r' && !lexer->eof(lexer)) {
        int32_t c = lexer->lookahead;
        lexer->advance(lexer, false);
        if (frontmatter_space(c)) {
            trailing_space = true;
            continue;
        }
        if (trailing_space) return false;
        bool identifier = c >= 0x80 || c == '_' || isalpha(c);
        if (!identifier && (first || !(isdigit(c) || c == '-' || c == '.'))) return false;
        first = false;
    }
    if (lexer->lookahead == '\r') lexer->advance(lexer, false);
    return lexer->lookahead == '\n';
}

static bool frontmatter_space(int32_t c) { return c == ' ' || c == '\t'; }

#endif
