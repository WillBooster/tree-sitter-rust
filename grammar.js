/**
 * @file Rust grammar for tree-sitter
 * @author Maxim Sokolov <maxim0xff@gmail.com>
 * @author Max Brunsfeld <maxbrunsfeld@gmail.com>
 * @author Amaan Qureshi <amaanq12@gmail.com>
 * @license MIT
 */

// @ts-check

const { alias, choice, field, grammar, optional, prec, repeat, repeat1, reserved, seq, sym, token } =
  /** @type {typeof globalThis & import('@willbooster/web-tree-sitter/dsl').DSL} */ (globalThis);

// https://doc.rust-lang.org/reference/expressions.html#expression-precedence
const PREC = {
  call: 15,
  field: 14,
  try: 13,
  unary: 12,
  cast: 11,
  multiplicative: 10,
  additive: 9,
  shift: 8,
  bitand: 7,
  bitxor: 6,
  bitor: 5,
  comparative: 4,
  and: 3,
  or: 2,
  range: 1,
  assign: 0,
  closure: -1,
};

const literalSuffix = /[_\p{XID_Start}][_\p{XID_Continue}]*/u;

const numericSuffixWithoutExponent = new RegExp(String.raw`[\p{XID_Start}--[eE]][_\p{XID_Continue}]*`, 'v');
const zeroNumericSuffix = new RegExp(String.raw`[\p{XID_Start}--[eEbox]][_\p{XID_Continue}]*`, 'v');
const hexadecimalSuffix = new RegExp(String.raw`[\p{XID_Start}--[a-fA-F]][_\p{XID_Continue}]*`, 'v');

const nonAsciiOrRawMacroName = new RegExp(
  String.raw`(?:[\p{XID_Start}--[\x00-\x7f]][_\p{XID_Continue}]*|[_a-zA-Z][_\p{XID_Continue}]*[\p{XID_Continue}--[\x00-\x7f]][_\p{XID_Continue}]*|r#[_\p{XID_Start}][_\p{XID_Continue}]*)`,
  'v'
);

const extendedFloatTypes = ['f16', 'f128'];

const numericTypes = [
  'u8',
  'i8',
  'u16',
  'i16',
  'u32',
  'i32',
  'u64',
  'i64',
  'u128',
  'i128',
  'isize',
  'usize',
  'f32',
  'f64',
  ...extendedFloatTypes,
];

// https://doc.rust-lang.org/reference/tokens.html#punctuation
const TOKEN_TREE_NON_SPECIAL_PUNCTUATION = [
  '+',
  '-',
  '*',
  '/',
  '%',
  '^',
  '!',
  '&',
  '|',
  '&&',
  '||',
  '<<',
  '>>',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '^=',
  '&=',
  '|=',
  '<<=',
  '>>=',
  '=',
  '==',
  '!=',
  '>',
  '<',
  '>=',
  '<=',
  '@',
  '_',
  '.',
  '..',
  '...',
  '..=',
  ',',
  ';',
  ':',
  '::',
  '->',
  '=>',
  '#',
  '?',
  '~',
];

const primitiveTypes = [...numericTypes, 'bool', 'str', 'char'];
const reservedIdentifiers = ['default', 'union', 'gen', 'raw'];
const globalKeywords = [
  '_',
  'as',
  'break',
  'const',
  'continue',
  'crate',
  'else',
  'enum',
  'extern',
  'false',
  'fn',
  'for',
  'if',
  'impl',
  'in',
  'let',
  'loop',
  'match',
  'mod',
  'move',
  'mut',
  'pub',
  'ref',
  'return',
  'self',
  'Self',
  'static',
  'struct',
  'super',
  'trait',
  'true',
  'type',
  'unsafe',
  'use',
  'where',
  'while',
  'abstract',
  'become',
  'box',
  'do',
  'final',
  'macro',
  'override',
  'priv',
  'typeof',
  'unsized',
  'virtual',
  'yield',
];
const fieldIdentifierKeywords = [...reservedIdentifiers, ...primitiveTypes, 'auto'];

// oxlint-disable-next-line unicorn/prefer-module -- This package is CommonJS, so tree-sitter loads grammar.js as CommonJS.
module.exports = grammar({
  name: 'rust',

  extras: ($) => [/[\s\u0085\u200E\u200F\u2028\u2029]/, $.line_comment, $.block_comment],

  externals: () => [
    sym('string_content'),
    sym('string_close'),
    sym('_raw_string_literal_start'),
    sym('_raw_string_literal_content'),
    sym('_raw_string_literal_end'),
    sym('_trailing_dot_float_literal'),
    sym('_outer_block_doc_comment_marker'),
    sym('_inner_block_doc_comment_marker'),
    sym('_block_comment_content'),
    sym('_line_doc_content'),
    sym('_range_unary_endpoint_start'),
    sym('_error_sentinel'),
    sym('_foreign_declaration_context'),
    sym('_foreign_declaration_start'),
    sym('_macro_metavariable_name'),
    sym('_literal_suffix_start'),
    sym('_frontmatter_start'),
    sym('_frontmatter_header_end'),
    sym('frontmatter_content'),
    sym('_frontmatter_end'),
    sym('_frontmatter_context'),
    sym('_ordinary_line_comment'),
    sym('_extra_line_doc_comment_start'),
    sym('_outer_line_comment_start'),
    sym('_ordinary_block_comment_start'),
    sym('_outer_block_comment_start'),
    sym('_outer_line_doc_comment_marker'),
    sym('_inner_line_doc_comment_marker'),
    sym('_orphan_line_doc_comment_start'),
    sym('_orphan_block_doc_comment_start'),
    sym('_orphan_doc_missing_owner'),
    sym('_trailing_type_bound_plus'),
    sym('shebang'),
  ],

  supertypes: ($) => [
    $._declaration_statement,
    $._foreign_declaration_statement,
    $._block_statement_expression,
    $._expression,
    $._type,
    $._literal,
    $._literal_pattern,
    $._pattern,
  ],

  inline: ($) => [
    $._path,
    $._struct_expression_name,
    $._field_initializer_name,
    $._assignee_expression,
    $._rest_assignee_expression,
    $._type_identifier,
    $._type_identifier_in_type_position,
    $._tokens,
    $._field_identifier,
    $._non_special_token,
    $._reserved_identifier,
    $._expression_ending_with_block,
  ],

  conflicts: ($) => [
    [$.array_expression, $._array_assignee_expression],
    [$.tuple_expression, $._tuple_assignee_expression],
    [$.arguments, $._assignee_arguments],
    [$._attributed_block_statement, $._expression_except_range],
    [$.type_parameters, $.for_lifetimes],
    [$.lifetime_parameter, $.for_lifetimes],
    [$._token_pattern, $.token_repetition_pattern],
    [$.token_tree, $.token_repetition],
    [$.field_initializer_list, $.block],
    [$._expression_except_range, $.shorthand_field_initializer],
    [$.function_modifiers, $.modified_trait_bound],
    [$.function_modifiers, $.impl_item, $.modified_trait_bound],
    [$.const_item, $.function_modifiers],
    // Local ambiguity due to anonymous types:
    // See https://internals.rust-lang.org/t/pre-rfc-deprecating-anonymous-parameters/3710
    [$._type, $._pattern],
    [$._type, $._trailing_bounded_type],
    [$.unit_type, $.tuple_pattern],
    [$.scoped_identifier, $.scoped_type_identifier],
    [$.parameters, $.tuple_struct_pattern],
    [$.visibility_modifier],
    [$.visibility_modifier, $.scoped_identifier, $.scoped_type_identifier],
    [$.foreign_mod_item, $.function_modifiers],
    [$.function_modifiers, $.impl_item, $.trait_item],
    [$.function_modifiers, $.trait_item],
  ],

  reserved: {
    global: () => globalKeywords,
    token_tree: () => [],
  },

  word: ($) => $.identifier,

  rules: {
    source_file: ($) =>
      seq(sym('_frontmatter_context'), optional(sym('shebang')), optional($.frontmatter), repeat($._statement)),

    _statement: ($) => choice($.expression_statement, $._declaration_statement),

    empty_statement: () => ';',

    expression_statement: ($) =>
      choice(
        seq($._expression, ';'),
        prec(1, $._expression_ending_with_block),
        prec(1, alias($._block_statement_expression, $._expression))
      ),

    _block_statement_expression: ($) => alias($._attributed_block_statement, $.attributed_expression),

    _outer_attributes: ($) => prec.right(seq($.attribute_item, repeat($.attribute_item))),

    _attributed_block_statement: ($) => seq($._outer_attributes, field('value', $._expression_ending_with_block)),

    _declaration_statement: ($) =>
      choice($.empty_statement, $.inner_attribute_item, $._attributable_declaration, $.attributed_declaration),

    attributed_declaration: ($) => seq($._outer_attributes, field('declaration', $._attributable_declaration)),

    _attributable_declaration: ($) =>
      choice(
        $.const_item,
        $.macro_invocation,
        $.macro_definition,
        $.decl_macro,
        $.mod_item,
        $.foreign_mod_item,
        $.struct_item,
        $.union_item,
        $.enum_item,
        $.type_item,
        $.function_item,
        $.function_signature_item,
        $.impl_item,
        $.trait_item,
        $.trait_alias,
        $.associated_type,
        $.let_declaration,
        $.use_declaration,
        $.extern_crate_declaration,
        $.static_item,
        alias($._safe_function_signature_item, $.function_signature_item),
        alias($._qualified_static_item, $.static_item)
      ),

    macro_definition: ($) => {
      const rules = seq(repeat(seq($.macro_rule, ';')), optional($.macro_rule));

      return seq(
        alias('macro_rules', 'macro_rules!'),
        '!',
        field('name', choice($.identifier, $._reserved_identifier)),
        choice(seq('(', rules, ')', ';'), seq('[', rules, ']', ';'), seq('{', rules, '}'))
      );
    },

    decl_macro: ($) =>
      seq(
        optional($.visibility_modifier),
        'macro',
        field('name', choice($.identifier, $._reserved_identifier)),
        field('parameters', optional(alias($._parenthesized_token_tree, $.token_tree))),
        field('body', alias($._braced_token_tree, $.token_tree))
      ),

    macro_rule: ($) => seq(field('left', $.token_tree_pattern), '=>', field('right', $.token_tree)),

    _token_pattern: ($) =>
      choice(
        $.token_tree_pattern,
        $.token_repetition_pattern,
        $.token_binding_pattern,
        $._macro_metavariable,
        '$',
        $._non_special_token
      ),

    token_tree_pattern: ($) =>
      choice(
        seq('(', repeat($._token_pattern), ')'),
        seq('[', repeat($._token_pattern), ']'),
        seq('{', repeat($._token_pattern), '}')
      ),

    token_binding_pattern: ($) =>
      prec(1, seq(field('name', $._macro_metavariable), ':', field('type', $.fragment_specifier))),

    token_repetition_pattern: ($) =>
      prec.dynamic(
        2,
        seq(
          '$',
          '(',
          repeat($._token_pattern),
          ')',
          optional(
            macroRepetitionSeparator(
              sym('_raw_string_literal_start'),
              sym('_raw_string_literal_content'),
              sym('_raw_string_literal_end')
            )
          ),
          choice('+', '*', '?')
        )
      ),

    fragment_specifier: () =>
      choice(
        'block',
        'expr',
        'expr_2021',
        'ident',
        'item',
        'lifetime',
        'literal',
        'meta',
        'pat',
        'pat_param',
        'path',
        'stmt',
        'tt',
        'ty',
        'vis'
      ),

    _tokens: ($) => choice($.token_tree, $.token_repetition, $._macro_metavariable, '$', $._non_special_token),

    token_tree: ($) =>
      choice(seq('(', repeat($._tokens), ')'), seq('[', repeat($._tokens), ']'), seq('{', repeat($._tokens), '}')),

    token_repetition: ($) =>
      prec.dynamic(
        2,
        seq(
          '$',
          '(',
          repeat($._tokens),
          ')',
          optional(
            macroRepetitionSeparator(
              sym('_raw_string_literal_start'),
              sym('_raw_string_literal_content'),
              sym('_raw_string_literal_end')
            )
          ),
          choice('+', '*', '?')
        )
      ),

    _non_special_token: ($) =>
      choice(
        alias($._outer_line_comment, $.line_comment),
        alias($._outer_block_comment, $.block_comment),
        $._literal,
        reserved('token_tree', $.identifier),
        $.mutable_specifier,
        $.self,
        $.super,
        $.crate,
        alias(choice(...primitiveTypes.filter((type) => !extendedFloatTypes.includes(type))), sym('primitive_type')),
        alias(choice(...extendedFloatTypes), $.identifier),
        prec.right(repeat1(choice(...TOKEN_TREE_NON_SPECIAL_PUNCTUATION))),
        "'",
        'abstract',
        'do',
        'final',
        'override',
        'priv',
        'typeof',
        'unsized',
        'virtual',
        'as',
        'async',
        'await',
        'become',
        'box',
        'break',
        'const',
        'continue',
        'default',
        'enum',
        'fn',
        'for',
        'gen',
        'if',
        'impl',
        'let',
        'loop',
        'match',
        'mod',
        'pub',
        'return',
        'static',
        'struct',
        'trait',
        'type',
        'union',
        'unsafe',
        'use',
        'where',
        'while'
      ),

    attribute_item: ($) =>
      choice(
        seq('#', '[', $.attribute, ']'),
        alias($._outer_line_comment, $.line_comment),
        alias($._outer_block_comment, $.block_comment)
      ),

    _orphan_doc_expression: ($) =>
      seq(
        alias($._orphan_doc_attribute, $.attribute_item),
        field('value', alias(sym('_orphan_doc_missing_owner'), $.identifier))
      ),

    _orphan_doc_attribute: ($) =>
      choice(alias($._orphan_line_comment, $.line_comment), alias($._orphan_block_comment, $.block_comment)),

    inner_attribute_item: ($) => seq('#', '!', '[', $.attribute, ']'),

    attribute: ($) =>
      choice(
        seq(
          $._path,
          optional(
            choice(seq('=', field('value', $._expression)), field('arguments', alias($.delim_token_tree, $.token_tree)))
          )
        ),
        seq(alias('unsafe', $.identifier), field('arguments', alias($._parenthesized_token_tree, $.token_tree)))
      ),

    mod_item: ($) =>
      seq(
        optional($.visibility_modifier),
        'mod',
        field('name', $.identifier),
        choice(';', field('body', $.declaration_list))
      ),

    foreign_mod_item: ($) =>
      seq(
        optional('unsafe'),
        $.extern_modifier,
        choice(';', field('body', alias($._foreign_declaration_list, $.declaration_list)))
      ),

    declaration_list: ($) => seq('{', repeat($._declaration_statement), '}'),

    // The scanner never emits `_foreign_declaration_context`: its validity enables the zero-width
    // `_foreign_declaration_start` required by qualified extern items. Keep this context marker so `safe` remains
    // an identifier outside extern blocks while qualified items still participate in declaration supertype queries.
    _foreign_declaration_list: ($) =>
      seq(
        '{',
        repeat(
          seq(
            optional(sym('_foreign_declaration_context')),
            alias($._foreign_declaration_statement, $._declaration_statement)
          )
        ),
        '}'
      ),

    _foreign_declaration_statement: ($) =>
      choice(
        $.empty_statement,
        $.inner_attribute_item,
        $._attributable_declaration,
        alias($._foreign_attributed_declaration, $.attributed_declaration)
      ),

    _foreign_attributed_declaration: ($) =>
      seq(
        $._outer_attributes,
        optional(sym('_foreign_declaration_context')),
        field('declaration', $._attributable_declaration)
      ),

    _safe_function_signature_item: ($) =>
      seq(
        sym('_foreign_declaration_start'),
        optional($.visibility_modifier),
        alias($._safe_modifier, $.function_modifiers),
        $._function_signature
      ),

    // Aliasing the bare token instead would make `function_modifiers` a leaf without the `safe` child that other
    // modifiers have.
    _safe_modifier: () => 'safe',

    _qualified_static_item: ($) =>
      seq(
        sym('_foreign_declaration_start'),
        optional($.visibility_modifier),
        choice('safe', 'unsafe'),
        $._static_declaration
      ),

    struct_item: ($) =>
      seq(
        optional($.visibility_modifier),
        'struct',
        field('name', $._type_identifier),
        field('type_parameters', optional($.type_parameters)),
        choice(
          seq(optional($.where_clause), choice(field('body', $.field_declaration_list), ';')),
          seq(field('body', $.ordered_field_declaration_list), optional($.where_clause), ';')
        )
      ),

    union_item: ($) =>
      seq(
        optional($.visibility_modifier),
        'union',
        field('name', $._type_identifier),
        field('type_parameters', optional($.type_parameters)),
        optional($.where_clause),
        field('body', $.field_declaration_list)
      ),

    enum_item: ($) =>
      seq(
        optional($.visibility_modifier),
        'enum',
        field('name', $._type_identifier),
        field('type_parameters', optional($.type_parameters)),
        optional($.where_clause),
        field('body', $.enum_variant_list)
      ),

    enum_variant_list: ($) => seq('{', sepBy(',', seq(repeat($.attribute_item), $.enum_variant)), optional(','), '}'),

    enum_variant: ($) =>
      seq(
        optional($.visibility_modifier),
        field('name', $.identifier),
        field('body', optional(choice($.field_declaration_list, $.ordered_field_declaration_list))),
        optional(seq('=', field('value', $._expression)))
      ),

    field_declaration_list: ($) =>
      seq('{', sepBy(',', seq(repeat($.attribute_item), $.field_declaration)), optional(','), '}'),

    field_declaration: ($) =>
      seq(optional($.visibility_modifier), field('name', $._field_identifier), ':', field('type', $._type)),

    ordered_field_declaration_list: ($) =>
      seq(
        '(',
        sepBy(',', seq(repeat($.attribute_item), optional($.visibility_modifier), field('type', $._type))),
        optional(','),
        ')'
      ),

    extern_crate_declaration: ($) =>
      seq(
        optional($.visibility_modifier),
        'extern',
        $.crate,
        field('name', choice($.identifier, alias($.self, $.identifier))),
        optional(seq('as', field('alias', choice($.identifier, alias('_', $.identifier))))),
        ';'
      ),

    const_item: ($) =>
      seq(
        optional($.visibility_modifier),
        'const',
        field('name', choice($.identifier, $._reserved_identifier, alias('_', $.identifier))),
        ':',
        field('type', $._type),
        optional(seq('=', field('value', $._expression))),
        ';'
      ),

    static_item: ($) => seq(optional($.visibility_modifier), $._static_declaration),

    _static_declaration: ($) =>
      seq(
        'static',

        // Not actual rust syntax, but made popular by the lazy_static crate.
        optional('ref'),

        optional($.mutable_specifier),
        field('name', $.identifier),
        ':',
        field('type', $._type),
        optional(seq('=', field('value', $._expression))),
        ';'
      ),

    type_item: ($) =>
      seq(
        optional($.visibility_modifier),
        'type',
        field('name', $._type_identifier),
        field('type_parameters', optional($.type_parameters)),
        optional($.where_clause),
        '=',
        field('type', $._type),
        optional($.where_clause),
        ';'
      ),

    function_item: ($) =>
      seq(
        optional($.visibility_modifier),
        optional($.function_modifiers),
        'fn',
        field('name', choice($.identifier, $.metavariable)),
        field('type_parameters', optional($.type_parameters)),
        field('parameters', $.parameters),
        optional(seq('->', field('return_type', $._type))),
        optional($.where_clause),
        field('body', $.block)
      ),

    function_signature_item: ($) =>
      seq(optional($.visibility_modifier), optional($.function_modifiers), $._function_signature),

    _function_signature: ($) =>
      seq(
        'fn',
        field('name', choice($.identifier, $.metavariable)),
        field('type_parameters', optional($.type_parameters)),
        field('parameters', $.parameters),
        optional(seq('->', field('return_type', $._type))),
        optional($.where_clause),
        ';'
      ),

    function_modifiers: ($) => repeat1(choice('async', 'default', 'const', 'unsafe', 'gen', $.extern_modifier)),

    where_clause: ($) => prec.right(seq('where', optional(seq(sepBy1(',', $.where_predicate), optional(','))))),

    where_predicate: ($) =>
      seq(
        field(
          'left',
          choice(
            $.lifetime,
            $._type_identifier_in_type_position,
            $.scoped_type_identifier,
            $.generic_type,
            alias($._generic_type_turbofish, $.generic_type),
            $.reference_type,
            $.pointer_type,
            $.tuple_type,
            $.unit_type,
            $.function_type,
            $.dynamic_type,
            $.bounded_type,
            alias($._trailing_bounded_type, $.bounded_type),
            $.macro_invocation,
            $.never_type,
            $.array_type,
            $.higher_ranked_trait_bound,
            alias(choice(...primitiveTypes), sym('primitive_type'))
          )
        ),
        field('bounds', $.trait_bounds)
      ),

    impl_item: ($) =>
      seq(
        optional('const'),
        optional('unsafe'),
        'impl',
        field('type_parameters', optional($.type_parameters)),
        optional(
          seq(
            optional(choice('!', 'const', seq('~', 'const'))),
            field(
              'trait',
              choice(
                $._type_identifier_in_type_position,
                alias(choice(...primitiveTypes), sym('type_identifier')),
                $.scoped_type_identifier,
                $.generic_type,
                alias($._generic_type_turbofish, $.generic_type)
              )
            ),
            'for'
          )
        ),
        field('type', $._type),
        optional($.where_clause),
        choice(field('body', $.declaration_list), ';')
      ),

    trait_item: ($) =>
      seq(
        optional($.visibility_modifier),
        optional('const'),
        optional('unsafe'),
        optional('auto'),
        'trait',
        field('name', $._type_identifier),
        field('type_parameters', optional($.type_parameters)),
        field('bounds', optional($.trait_bounds)),
        optional($.where_clause),
        field('body', $.declaration_list)
      ),

    trait_alias: ($) =>
      seq(
        optional($.visibility_modifier),
        optional('const'),
        'trait',
        field('name', $._type_identifier),
        field('type_parameters', optional($.type_parameters)),
        '=',
        field('bounds', optional($.trait_alias_bounds)),
        optional($.where_clause),
        ';'
      ),

    trait_alias_bounds: ($) =>
      seq(sepBy1('+', choice($._type, $.lifetime, $.higher_ranked_trait_bound)), optional('+')),

    associated_type: ($) =>
      seq(
        optional($.visibility_modifier),
        'type',
        field('name', $._type_identifier),
        field('type_parameters', optional($.type_parameters)),
        field('bounds', optional($.trait_bounds)),
        optional($.where_clause),
        ';'
      ),

    trait_bounds: ($) =>
      prec.right(
        seq(':', optional(seq(sepBy1('+', choice($._type, $.lifetime, $.higher_ranked_trait_bound)), optional('+'))))
      ),

    higher_ranked_trait_bound: ($) =>
      prec.dynamic(1, seq('for', field('type_parameters', $.type_parameters), field('type', $._type))),

    removed_trait_bound: ($) => seq('?', $._type),

    modified_trait_bound: ($) =>
      prec.dynamic(
        -1,
        seq(choice('const', seq('~', 'const'), seq('[', 'const', ']'), 'async'), field('type', $._type))
      ),

    type_parameters: ($) =>
      prec(
        1,
        seq(
          '<',
          optional(
            seq(
              sepBy1(
                ',',
                seq(
                  repeat($.attribute_item),
                  choice($.metavariable, $.type_parameter, $.lifetime_parameter, $.const_parameter)
                )
              ),
              optional(',')
            )
          ),
          '>'
        )
      ),

    const_parameter: ($) =>
      seq(
        'const',
        field('name', $.identifier),
        ':',
        field('type', $._type),
        optional(seq('=', field('value', choice($.block, $.identifier, $._literal, $.negative_literal))))
      ),

    type_parameter: ($) =>
      prec(
        1,
        seq(
          field('name', choice($._type_identifier, alias(choice(...primitiveTypes), sym('type_identifier')))),
          optional(field('bounds', $.trait_bounds)),
          optional(seq('=', field('default_type', $._type)))
        )
      ),

    lifetime_parameter: ($) => prec(1, seq(field('name', $.lifetime), optional(field('bounds', $.trait_bounds)))),

    let_declaration: ($) =>
      seq(
        'let',
        optional($.mutable_specifier),
        field('pattern', $._pattern),
        optional(seq(':', field('type', $._type))),
        optional(seq('=', field('value', $._expression))),
        optional(seq('else', field('alternative', $.block))),
        ';'
      ),

    use_declaration: ($) => seq(optional($.visibility_modifier), 'use', field('argument', $._use_clause), ';'),

    _use_clause: ($) => choice($._path, $.use_as_clause, $.use_list, $.scoped_use_list, $.use_wildcard),

    scoped_use_list: ($) => seq(field('path', optional($._path)), '::', field('list', $.use_list)),

    use_list: ($) => seq('{', sepBy(',', choice($._use_clause)), optional(','), '}'),

    use_as_clause: ($) =>
      seq(field('path', $._path), 'as', field('alias', choice($.identifier, alias('_', $.identifier)))),

    use_wildcard: ($) => seq(optional(seq(optional($._path), '::')), '*'),

    parameters: ($) =>
      seq(
        '(',
        sepBy(',', seq(repeat($.attribute_item), choice($.parameter, $.self_parameter, $.variadic_parameter, $._type))),
        optional(','),
        optional(alias($._orphan_doc_expression, $.attributed_expression)),
        ')'
      ),

    self_parameter: ($) => seq(optional('&'), optional($.lifetime), optional($.mutable_specifier), $.self),

    variadic_parameter: ($) =>
      seq(optional($.mutable_specifier), optional(seq(field('pattern', $._pattern), ':')), '...'),

    parameter: ($) =>
      seq(optional($.mutable_specifier), field('pattern', choice($._pattern, $.self)), ':', field('type', $._type)),

    extern_modifier: ($) => seq('extern', optional(choice($.string_literal, $.raw_string_literal))),

    visibility_modifier: ($) =>
      choice($.crate, seq('pub', optional(seq('(', choice($.self, $.super, $.crate, seq('in', $._path)), ')')))),

    _type: ($) =>
      choice(
        $.abstract_type,
        $.reference_type,
        $.metavariable,
        $.pointer_type,
        $.generic_type,
        alias($._generic_type_turbofish, $.generic_type),
        $.scoped_type_identifier,
        $.tuple_type,
        $.unit_type,
        $.array_type,
        $.function_type,
        $._type_identifier_in_type_position,
        alias('_', sym('type_identifier')),
        $.macro_invocation,
        $.never_type,
        $.dynamic_type,
        $.bounded_type,
        alias($._trailing_bounded_type, $.bounded_type),
        $.removed_trait_bound,
        $.modified_trait_bound,
        alias(choice(...primitiveTypes), sym('primitive_type'))
      ),

    bracketed_type: ($) => seq('<', choice($._type, $.qualified_type), '>'),

    qualified_type: ($) => seq(field('type', $._type), 'as', field('alias', $._type)),

    lifetime: ($) => prec(1, seq("'", choice($.identifier, alias(choice('static', '_'), $.identifier)))),

    array_type: ($) => seq('[', field('element', $._type), optional(seq(';', field('length', $._expression))), ']'),

    for_lifetimes: ($) => prec(1, seq('for', '<', optional(seq(sepBy1(',', prec(1, $.lifetime)), optional(','))), '>')),

    function_type: ($) =>
      seq(
        optional($.for_lifetimes),
        prec(
          PREC.call,
          seq(
            choice(
              field(
                'trait',
                choice(
                  $._type_identifier_in_type_position,
                  $.scoped_type_identifier,
                  alias(choice(...primitiveTypes), sym('type_identifier'))
                )
              ),
              seq(optional($.function_modifiers), 'fn')
            ),
            field('parameters', $.parameters)
          )
        ),
        optional(seq('->', field('return_type', $._type)))
      ),

    tuple_type: ($) => seq('(', sepBy1(',', $._type), optional(','), ')'),

    unit_type: () => seq('(', ')'),

    generic_function: ($) =>
      prec(
        1,
        seq(
          field(
            'function',
            choice(
              $.identifier,
              alias('Self', $.identifier),
              $._reserved_identifier,
              alias(choice(...primitiveTypes), $.identifier),
              $.scoped_identifier,
              $.field_expression
            )
          ),
          '::',
          field('type_arguments', $.type_arguments)
        )
      ),

    generic_type: ($) =>
      prec(
        1,
        seq(
          field(
            'type',
            choice(
              $._type_identifier,
              alias('Self', sym('type_identifier')),
              alias(choice(...primitiveTypes), sym('type_identifier')),
              alias(choice(...reservedIdentifiers), $.identifier),
              $.scoped_type_identifier
            )
          ),
          field('type_arguments', $.type_arguments)
        )
      ),

    generic_type_with_turbofish: ($) =>
      seq(
        field(
          'type',
          choice(
            $._type_identifier,
            alias('Self', sym('type_identifier')),
            alias(choice(...primitiveTypes, ...reservedIdentifiers), sym('type_identifier')),
            $.scoped_identifier
          )
        ),
        '::',
        field('type_arguments', $.type_arguments)
      ),

    bounded_type: ($) =>
      prec.left(
        -1,
        seq(
          choice($.lifetime, $._type, $.use_bounds),
          '+',
          choice($.lifetime, $._type, $.use_bounds, prec.dynamic(-2, $.higher_ranked_trait_bound))
        )
      ),

    _trailing_bounded_type: ($) =>
      seq(
        choice($.dynamic_type, $.abstract_type),
        repeat(seq('+', choice($.lifetime, $._type, $.use_bounds, prec.dynamic(-2, $.higher_ranked_trait_bound)))),
        alias(sym('_trailing_type_bound_plus'), '+')
      ),

    use_bounds: ($) =>
      seq(
        'use',
        token(prec(1, '<')),
        sepBy(',', choice($.lifetime, $._type_identifier, alias('Self', sym('type_identifier')))),
        optional(','),
        '>'
      ),

    type_arguments: ($) =>
      seq(
        token(prec(1, '<')),
        optional(
          seq(
            sepBy1(
              ',',
              choice(
                seq(choice($._type, $.type_binding, $.lifetime, $._literal, $.block), optional($.trait_bounds)),
                prec(1, seq(alias(choice(...primitiveTypes), sym('type_identifier')), $.trait_bounds))
              )
            ),
            optional(',')
          )
        ),
        '>'
      ),

    type_binding: ($) =>
      seq(
        field(
          'name',
          choice($._type_identifier_in_type_position, alias(choice(...primitiveTypes), sym('type_identifier')))
        ),
        field('type_arguments', optional($.type_arguments)),
        '=',
        field('type', $._type)
      ),

    reference_type: ($) =>
      seq(choice('&', '&&'), optional($.lifetime), optional($.mutable_specifier), field('type', $._type)),

    pointer_type: ($) => seq('*', choice('const', $.mutable_specifier), field('type', $._type)),

    never_type: () => '!',

    abstract_type: ($) =>
      seq(
        'impl',
        optional(prec.dynamic(1, seq('for', $.type_parameters))),
        field(
          'trait',
          prec(
            1,
            choice(
              $._type_identifier_in_type_position,
              alias(choice(...primitiveTypes), sym('type_identifier')),
              $.scoped_type_identifier,
              $.removed_trait_bound,
              $.modified_trait_bound,
              $.generic_type,
              alias($._generic_type_turbofish, $.generic_type),
              $.function_type,
              $.tuple_type,
              $.bounded_type
            )
          )
        )
      ),

    dynamic_type: ($) =>
      seq(
        'dyn',
        repeat(seq($.lifetime, '+')),
        field(
          'trait',
          choice(
            $.higher_ranked_trait_bound,
            $.modified_trait_bound,
            $._type_identifier_in_type_position,
            alias(choice(...primitiveTypes), sym('type_identifier')),
            $.scoped_type_identifier,
            $.generic_type,
            alias($._generic_type_turbofish, $.generic_type),
            $.function_type,
            $.tuple_type
          )
        )
      ),

    mutable_specifier: () => 'mut',

    _expression_except_range: ($) =>
      choice(
        $.unary_expression,
        $.reference_expression,
        $.try_expression,
        $.binary_expression,
        $.assignment_expression,
        $.compound_assignment_expr,
        $.type_cast_expression,
        $.call_expression,
        $.return_expression,
        $.become_expression,
        $.yield_expression,
        $._literal,
        prec.left($.identifier),
        alias(choice('_', 'Self'), $.identifier),
        alias(choice(...primitiveTypes), $.identifier),
        prec.left($._reserved_identifier),
        $.self,
        $.scoped_identifier,
        $.generic_function,
        $.await_expression,
        $.field_expression,
        $.array_expression,
        $.tuple_expression,
        prec(1, $.macro_invocation),
        $.unit_expression,
        $.break_expression,
        $.continue_expression,
        $.index_expression,
        $.metavariable,
        $.closure_expression,
        $.parenthesized_expression,
        $.struct_expression,
        $._expression_ending_with_block
      ),

    _expression: ($) => choice($._expression_except_range, $.range_expression, $.attributed_expression),

    attributed_expression: ($) =>
      prec.dynamic(-1, seq($._outer_attributes, prec.right(PREC.unary, field('value', $._expression)))),

    _expression_ending_with_block: ($) =>
      choice(
        $.unsafe_block,
        $.async_block,
        $.gen_block,
        $.try_block,
        $.block,
        $.if_expression,
        $.match_expression,
        $.while_expression,
        $.loop_expression,
        $.for_expression,
        $.const_block
      ),

    macro_invocation: ($) =>
      seq(
        field(
          'macro',
          choice(
            $.scoped_identifier,
            $.identifier,
            alias(choice(...primitiveTypes), $.identifier),
            $._reserved_identifier
          )
        ),
        '!',
        alias($.delim_token_tree, $.token_tree)
      ),

    delim_token_tree: ($) =>
      choice($._parenthesized_token_tree, seq('[', repeat($._delim_tokens), ']'), $._braced_token_tree),

    _parenthesized_token_tree: ($) => seq('(', repeat($._delim_tokens), ')'),

    _braced_token_tree: ($) => seq('{', repeat($._delim_tokens), '}'),

    _delim_tokens: ($) => choice($._non_delim_token, alias($.delim_token_tree, $.token_tree)),

    _non_delim_token: ($) => choice($._non_special_token, '$'),

    scoped_identifier: ($) =>
      seq(
        field(
          'path',
          optional(choice($._path, $.bracketed_type, alias($.generic_type_with_turbofish, $.generic_type)))
        ),
        '::',
        field('name', choice($.identifier, $._reserved_identifier, $.super))
      ),

    scoped_type_identifier_in_expression_position: ($) =>
      prec(
        -2,
        seq(
          field('path', optional(choice($._path, alias($.generic_type_with_turbofish, $.generic_type)))),
          '::',
          field('name', choice($._type_identifier, alias(choice(...reservedIdentifiers), sym('type_identifier'))))
        )
      ),

    scoped_type_identifier: ($) =>
      seq(
        field(
          'path',
          optional(
            choice($._path, alias($.generic_type_with_turbofish, $.generic_type), $.bracketed_type, $.generic_type)
          )
        ),
        '::',
        field('name', choice($._type_identifier, alias(choice(...reservedIdentifiers), sym('type_identifier'))))
      ),

    range_expression: ($) =>
      choice(
        prec.left(PREC.range, seq($._expression, choice('..', '...', '..='), $._expression)),
        prec.left(PREC.range, seq($._expression, '..')),
        prec.left(PREC.range, seq(choice('..', '..='), $._expression)),
        prec.right(
          PREC.range + 1,
          seq($._expression, choice('..', '..='), sym('_range_unary_endpoint_start'), $._expression)
        ),
        prec.right(PREC.range + 1, seq(choice('..', '..='), sym('_range_unary_endpoint_start'), $._expression)),
        prec.left(PREC.range, '..')
      ),

    unary_expression: ($) => prec(PREC.unary, seq(choice('-', '*', '!'), $._expression)),

    try_expression: ($) => prec(PREC.try, seq($._expression, '?')),

    reference_expression: ($) =>
      prec(
        PREC.unary,
        seq(
          '&',
          choice(seq('raw', choice('const', $.mutable_specifier)), optional($.mutable_specifier)),
          field('value', $._expression)
        )
      ),

    binary_expression: ($) => {
      /** @type {[number, import('@willbooster/web-tree-sitter/dsl').RuleOrLiteral][]} */
      const table = [
        [PREC.and, '&&'],
        [PREC.or, '||'],
        [PREC.bitand, '&'],
        [PREC.bitor, '|'],
        [PREC.bitxor, '^'],
        [PREC.comparative, choice('==', '!=', '<', token(prec(2, '<=')), '>', '>=')],
        [PREC.shift, choice('<<', '>>')],
        [PREC.additive, choice('+', '-')],
        [PREC.multiplicative, choice('*', '/', '%')],
      ];

      return choice(
        ...table.map(([precedence, operator]) =>
          prec.left(
            precedence,
            seq(field('left', $._expression), field('operator', operator), field('right', $._expression))
          )
        )
      );
    },

    assignment_expression: ($) =>
      prec.left(PREC.assign, seq(field('left', $._assignee_expression), '=', field('right', $._expression))),

    compound_assignment_expr: ($) =>
      prec.left(
        PREC.assign,
        seq(
          field('left', $._expression),
          field('operator', choice('+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=')),
          field('right', $._expression)
        )
      ),

    type_cast_expression: ($) => prec.left(PREC.cast, seq(field('value', $._expression), 'as', field('type', $._type))),

    return_expression: ($) => choice(prec.left(seq('return', $._expression)), prec(-1, 'return')),

    become_expression: ($) => prec.left(seq('become', $._expression)),

    yield_expression: ($) => choice(prec.left(seq('yield', $._expression)), prec(-1, 'yield')),

    call_expression: ($) =>
      prec(PREC.call, seq(field('function', $._expression_except_range), field('arguments', $.arguments))),

    arguments: ($) =>
      seq('(', sepBy(',', seq(repeat(prec(PREC.call, $.attribute_item)), $._expression)), optional(','), ')'),

    array_expression: ($) =>
      seq(
        '[',
        choice(
          seq(repeat(prec(PREC.call, $.attribute_item)), $._expression, ';', field('length', $._expression)),
          seq(sepBy(',', seq(repeat(prec(PREC.call, $.attribute_item)), $._expression)), optional(','))
        ),
        optional(alias($._orphan_doc_expression, $.attributed_expression)),
        ']'
      ),

    parenthesized_expression: ($) =>
      seq(
        '(',
        repeat(prec(PREC.call, $.attribute_item)),
        $._expression,
        optional(alias($._orphan_doc_expression, $.attributed_expression)),
        ')'
      ),

    tuple_expression: ($) =>
      seq(
        '(',
        repeat(prec(PREC.call, $.attribute_item)),
        seq($._expression, ','),
        repeat(seq(repeat(prec(PREC.call, $.attribute_item)), $._expression, ',')),
        optional(seq(repeat(prec(PREC.call, $.attribute_item)), $._expression)),
        ')'
      ),

    unit_expression: () => seq('(', ')'),

    _assignee_expression: ($) => choice($._expression, $._rest_assignee_expression),

    _rest_assignee_expression: ($) =>
      choice(
        alias($._struct_assignee_expression, $.struct_expression),
        alias($._parenthesized_assignee_expression, $.parenthesized_expression),
        alias($._tuple_assignee_expression, $.tuple_expression),
        alias($._array_assignee_expression, $.array_expression),
        alias($._call_assignee_expression, $.call_expression)
      ),

    _struct_assignee_expression: ($) =>
      prec(
        -1,
        seq(
          field('name', $._struct_expression_name),
          field('body', alias($._assignee_field_initializer_list, $.field_initializer_list))
        )
      ),

    _parenthesized_assignee_expression: ($) =>
      prec(-1, seq('(', repeat(prec(PREC.call, $.attribute_item)), $._rest_assignee_expression, ')')),

    _tuple_assignee_expression: ($) => {
      const ordinary = seq(repeat(prec(PREC.call, $.attribute_item)), $._expression);
      const rest = seq(repeat(prec(PREC.call, $.attribute_item)), $._rest_assignee_expression);
      const assignee = seq(repeat(prec(PREC.call, $.attribute_item)), $._assignee_expression);
      return prec(
        -1,
        seq(
          '(',
          choice(
            seq(rest, ',', repeat(seq(assignee, ',')), optional(assignee)),
            seq(repeat1(seq(ordinary, ',')), rest, repeat(seq(',', assignee)), optional(','))
          ),
          ')'
        )
      );
    },

    _array_assignee_expression: ($) =>
      prec(
        -1,
        seq(
          '[',
          commaListWithRest(
            seq(repeat(prec(PREC.call, $.attribute_item)), $._expression),
            seq(repeat(prec(PREC.call, $.attribute_item)), $._rest_assignee_expression)
          ),
          ']'
        )
      ),

    _call_assignee_expression: ($) =>
      prec(
        PREC.call - 1,
        seq(
          field('function', $._expression_except_range),
          field('arguments', alias($._assignee_arguments, $.arguments))
        )
      ),

    _assignee_arguments: ($) =>
      prec(
        -1,
        seq(
          '(',
          commaListWithRest(
            seq(repeat(prec(PREC.call, $.attribute_item)), $._expression),
            seq(repeat(prec(PREC.call, $.attribute_item)), $._rest_assignee_expression)
          ),
          ')'
        )
      ),

    struct_expression: ($) => seq(field('name', $._struct_expression_name), field('body', $.field_initializer_list)),

    _struct_expression_name: ($) =>
      choice(
        $._type_identifier,
        alias('Self', sym('type_identifier')),
        prec.dynamic(-1, alias(choice(...primitiveTypes, ...reservedIdentifiers), sym('type_identifier'))),
        alias($.scoped_type_identifier_in_expression_position, $.scoped_type_identifier),
        $.generic_type_with_turbofish
      ),

    field_initializer_list: ($) => {
      const ordinary = choice($.shorthand_field_initializer, $.field_initializer);
      return seq(
        '{',
        choice(
          seq(optional($._ordinary_field_initializer_prefix), optional(ordinary)),
          seq(
            optional($._ordinary_field_initializer_prefix),
            $.base_field_initializer,
            repeat(seq(',', choice(ordinary, $.base_field_initializer))),
            optional(',')
          )
        ),
        '}'
      );
    },

    _ordinary_field_initializer_prefix: ($) =>
      repeat1(seq(choice($.shorthand_field_initializer, $.field_initializer), ',')),

    _assignee_field_initializer_list: ($) => {
      const ordinary = choice($.shorthand_field_initializer, $.field_initializer);
      const rest = alias($._assignee_field_initializer, $.field_initializer);
      return seq(
        '{',
        optional($._ordinary_field_initializer_prefix),
        choice(
          $.remaining_field_pattern,
          seq(rest, repeat(seq(',', choice(ordinary, rest))), optional(seq(',', optional($.remaining_field_pattern))))
        ),
        '}'
      );
    },

    _assignee_field_initializer: ($) =>
      prec(
        -1,
        seq(
          optional($._outer_attributes),
          field('field', $._field_initializer_name),
          ':',
          field('value', $._rest_assignee_expression)
        )
      ),

    shorthand_field_initializer: ($) =>
      seq(optional($._outer_attributes), choice($.identifier, alias(choice(...fieldIdentifierKeywords), $.identifier))),

    field_initializer: ($) =>
      seq(optional($._outer_attributes), field('field', $._field_initializer_name), ':', field('value', $._expression)),

    _field_initializer_name: ($) =>
      choice(
        $._field_identifier,
        alias(choice(...fieldIdentifierKeywords), sym('field_identifier')),
        alias(/[0-9][0-9_]*/, $.integer_literal)
      ),

    base_field_initializer: ($) => seq('..', $._expression),

    if_expression: ($) =>
      prec.right(
        seq(
          'if',
          field('condition', $._condition),
          field('consequence', $.block),
          repeat(field('alternative', alias($._else_if_clause, $.else_clause))),
          optional(field('alternative', $.else_clause))
        )
      ),

    let_condition: ($) =>
      seq(
        optional($._outer_attributes),
        'let',
        field('pattern', $._pattern),
        '=',
        field('value', prec.left(PREC.and, $._expression))
      ),

    _let_chain: ($) =>
      prec.left(
        PREC.and,
        choice(
          seq($._let_chain, '&&', $.let_condition),
          seq($._let_chain, '&&', $._expression),
          seq($.let_condition, '&&', $._expression),
          seq($.let_condition, '&&', $.let_condition),
          seq($._expression, '&&', $.let_condition)
        )
      ),

    _condition: ($) => choice($._expression, $.let_condition, alias($._let_chain, sym('let_chain'))),

    _else_if_clause: ($) => seq('else', 'if', field('condition', $._condition), field('consequence', $.block)),

    else_clause: ($) => seq('else', field('consequence', $.block)),

    match_expression: ($) => seq('match', field('value', $._expression), field('body', $.match_block)),

    match_block: ($) => seq('{', optional(seq(repeat($.match_arm), alias($.last_match_arm, $.match_arm))), '}'),

    match_arm: ($) =>
      prec.right(
        seq(
          repeat(choice($.attribute_item, $.inner_attribute_item)),
          field('pattern', $.match_pattern),
          '=>',
          choice(seq(field('value', $._expression), ','), field('value', prec(1, $._expression_ending_with_block)))
        )
      ),

    last_match_arm: ($) =>
      seq(
        repeat(choice($.attribute_item, $.inner_attribute_item)),
        field('pattern', $.match_pattern),
        '=>',
        field('value', $._expression),
        optional(',')
      ),

    match_pattern: ($) => seq($._pattern, optional(seq('if', field('condition', $._condition)))),

    while_expression: ($) =>
      seq(optional(seq($.label, ':')), 'while', field('condition', $._condition), field('body', $.block)),

    loop_expression: ($) => seq(optional(seq($.label, ':')), 'loop', field('body', $.block)),

    for_expression: ($) =>
      seq(
        optional(seq($.label, ':')),
        'for',
        field('pattern', $._pattern),
        'in',
        field('value', $._expression),
        field('body', $.block)
      ),

    const_block: ($) => seq('const', field('body', $.block)),

    closure_expression: ($) =>
      prec(
        PREC.closure,
        seq(
          optional('static'),
          optional('async'),
          optional('move'),
          field('parameters', $.closure_parameters),
          choice(
            seq(optional(seq('->', field('return_type', $._type))), field('body', $.block)),
            field('body', choice($._expression, '_'))
          )
        )
      ),

    closure_parameters: ($) =>
      seq(
        '|',
        optional(seq(sepBy1(',', seq(repeat($.attribute_item), choice($._pattern, $.parameter))), optional(','))),
        '|'
      ),

    label: ($) => seq("'", $.identifier),

    break_expression: ($) => prec.left(seq($._break_expression_head, optional($._expression))),

    _break_expression_head: ($) => prec.right(seq('break', optional($.label))),

    continue_expression: ($) => prec.right(seq('continue', optional($.label))),

    index_expression: ($) => prec(PREC.call, seq($._expression, '[', $._expression, ']')),

    await_expression: ($) => prec(PREC.field, seq($._expression, '.', 'await')),

    field_expression: ($) =>
      prec(
        PREC.field,
        seq(
          field('value', $._expression),
          '.',
          field('field', choice($._field_identifier, alias(/[0-9][0-9_]*/, $.integer_literal)))
        )
      ),

    unsafe_block: ($) => seq('unsafe', $.block),

    async_block: ($) => seq('async', optional('move'), $.block),

    gen_block: ($) => seq('gen', optional('move'), $.block),

    try_block: ($) => seq('try', $.block),

    block: ($) =>
      seq(
        optional(seq($.label, ':')),
        '{',
        repeat($._statement),
        optional($._expression),
        optional(alias($._orphan_doc_expression, $.attributed_expression)),
        '}'
      ),

    _pattern: ($) =>
      choice(
        $._literal_pattern,
        alias(choice(...primitiveTypes), $.identifier),
        $.identifier,
        alias('Self', $.identifier),
        $.scoped_identifier,
        $.generic_pattern,
        $.tuple_pattern,
        $.tuple_struct_pattern,
        $.struct_pattern,
        $._reserved_identifier,
        $.ref_pattern,
        $.box_pattern,
        $.slice_pattern,
        $.captured_pattern,
        $.reference_pattern,
        $.remaining_field_pattern,
        $.mut_pattern,
        $.range_pattern,
        $.or_pattern,
        $.const_block,
        $.macro_invocation,
        '_'
      ),

    generic_pattern: ($) =>
      seq(
        choice(
          $.identifier,
          alias('Self', $.identifier),
          $._reserved_identifier,
          alias(choice(...primitiveTypes), $.identifier),
          $.scoped_identifier
        ),

        '::',
        field('type_arguments', $.type_arguments)
      ),

    tuple_pattern: ($) => seq('(', sepBy(',', choice($._pattern, $.closure_expression)), optional(','), ')'),

    slice_pattern: ($) => seq('[', sepBy(',', $._pattern), optional(','), ']'),

    tuple_struct_pattern: ($) =>
      seq(
        field(
          'type',
          choice(
            $.identifier,
            alias('Self', $.identifier),
            $._reserved_identifier,
            alias(choice(...primitiveTypes), $.identifier),
            $.scoped_identifier,
            alias($.generic_type_with_turbofish, $.generic_type)
          )
        ),
        '(',
        sepBy(',', $._pattern),
        optional(','),
        ')'
      ),

    struct_pattern: ($) =>
      seq(
        field(
          'type',
          choice(
            $._type_identifier,
            alias('Self', sym('type_identifier')),
            alias(choice(...primitiveTypes, ...reservedIdentifiers), sym('type_identifier')),
            $.scoped_type_identifier,
            alias($._generic_struct_pattern_type, $.generic_type)
          )
        ),
        '{',
        sepBy(',', choice($.field_pattern, $.remaining_field_pattern)),
        optional(','),
        '}'
      ),

    _generic_struct_pattern_type: ($) =>
      seq(
        field(
          'type',
          choice(
            $._type_identifier,
            alias('Self', sym('type_identifier')),
            alias(choice(...primitiveTypes, ...reservedIdentifiers), sym('type_identifier')),
            $.scoped_type_identifier
          )
        ),
        '::',
        field('type_arguments', $.type_arguments)
      ),

    field_pattern: ($) =>
      seq(
        repeat($.attribute_item),
        choice(
          seq(
            optional('ref'),
            optional($.mutable_specifier),
            choice(
              field('name', alias($.identifier, sym('shorthand_field_identifier'))),
              seq(field('name', $._field_identifier), ':', field('pattern', $._pattern))
            )
          ),
          seq(
            field(
              'name',
              alias(/([0-9][0-9_]*|0b_*[01][01_]*|0o_*[0-7][0-7_]*|0x_*[0-9a-fA-F][0-9a-fA-F_]*)/, $.integer_literal)
            ),
            ':',
            field('pattern', $._pattern)
          )
        )
      ),

    remaining_field_pattern: () => '..',

    mut_pattern: ($) => prec(-1, seq($.mutable_specifier, $._pattern)),

    range_pattern: ($) =>
      choice(
        seq(
          field('left', choice($._literal_pattern, $._path)),
          choice(seq(choice('...', '..=', '..'), field('right', choice($._literal_pattern, $._path))), '..')
        ),
        seq(choice('..=', '..'), field('right', choice($._literal_pattern, $._path)))
      ),

    ref_pattern: ($) => seq('ref', $._pattern),

    box_pattern: ($) => seq('box', field('pattern', $._pattern)),

    captured_pattern: ($) =>
      seq(
        choice($.identifier, $._reserved_identifier, alias(choice(...primitiveTypes), $.identifier)),
        '@',
        $._pattern
      ),

    reference_pattern: ($) => seq(choice('&', '&&'), optional($.mutable_specifier), $._pattern),

    or_pattern: ($) => prec.left(-2, choice(seq($._pattern, '|', $._pattern), seq('|', $._pattern))),

    _literal: ($) =>
      choice(
        $.string_literal,
        $.raw_string_literal,
        $.char_literal,
        $.boolean_literal,
        $.integer_literal,
        $.float_literal
      ),

    _literal_pattern: ($) =>
      choice(
        $.string_literal,
        $.raw_string_literal,
        $.char_literal,
        $.boolean_literal,
        $.integer_literal,
        $.float_literal,
        $.negative_literal
      ),

    negative_literal: ($) => seq('-', choice($.integer_literal, $.float_literal)),

    integer_literal: () =>
      choice(
        /[0-9][0-9_]*/,
        token(
          choice(
            seq(
              choice(/[1-9][0-9_]*/, /0[0-9_]+/, /0b_*[01][01_]*/, /0o_*[0-7][0-7_]*/),
              optional(numericSuffixWithoutExponent)
            ),
            /0[box]_+/,
            seq('0', optional(zeroNumericSuffix)),
            seq(/0x_*[0-9a-fA-F][0-9a-fA-F_]*/, optional(hexadecimalSuffix))
          )
        )
      ),

    float_literal: () =>
      choice(
        sym('_trailing_dot_float_literal'),
        token(
          prec(
            1,
            choice(
              seq(
                /[0-9][0-9_]*/,
                optional(seq('.', /[0-9][0-9_]*/)),
                /[eE][+-]?_*[0-9][0-9_]*/,
                optional(/\p{XID_Start}[_\p{XID_Continue}]*/u)
              ),
              seq(/[0-9][0-9_]*/, optional(seq('.', /[0-9][0-9_]*/)), /[eE][+-]?_+/),
              seq(/[0-9][0-9_]*/, '.', /[0-9][0-9_]*/, optional(numericSuffixWithoutExponent))
            )
          )
        )
      ),

    string_literal: ($) =>
      seq(
        alias(/[bc]?"/, '"'),
        repeat(choice($.escape_sequence, sym('string_content'))),
        alias(sym('string_close'), '"'),
        optional(seq(sym('_literal_suffix_start'), token.immediate(prec(1, literalSuffix))))
      ),

    raw_string_literal: () =>
      seq(
        sym('_raw_string_literal_start'),
        alias(sym('_raw_string_literal_content'), sym('string_content')),
        sym('_raw_string_literal_end'),
        optional(seq(sym('_literal_suffix_start'), token.immediate(prec(1, literalSuffix))))
      ),

    char_literal: () =>
      token(
        seq(
          optional('b'),
          "'",
          optional(
            choice(
              seq('\\', choice(/[^xu]/, /u[0-9a-fA-F]{4}/, /u\{[0-9a-fA-F][0-9a-fA-F_]*\}/, /x[0-9a-fA-F]{2}/)),
              /[^\\']/
            )
          ),
          "'",
          optional(literalSuffix)
        )
      ),

    escape_sequence: () =>
      token.immediate(
        seq('\\', choice(/[^xu]/, /u[0-9a-fA-F]{4}/, /u\{[0-9a-fA-F][0-9a-fA-F_]*\}/, /x[0-9a-fA-F]{2}/))
      ),

    boolean_literal: () => choice('true', 'false'),

    comment: ($) => choice($.line_comment, $.block_comment),

    line_comment: () =>
      choice(
        sym('_ordinary_line_comment'),
        seq(
          alias(sym('_extra_line_doc_comment_start'), '//'),
          choice(
            field('inner', alias(sym('_inner_line_doc_comment_marker'), sym('inner_doc_comment_marker'))),
            field('outer', alias(sym('_outer_line_doc_comment_marker'), sym('outer_doc_comment_marker')))
          ),
          field('doc', alias(sym('_line_doc_content'), sym('doc_comment')))
        )
      ),

    _outer_line_comment: () => outerLineComment('_outer_line_comment_start'),

    _orphan_line_comment: () => outerLineComment('_orphan_line_doc_comment_start'),

    block_comment: () =>
      seq(
        alias(sym('_ordinary_block_comment_start'), '/*'),
        optional(
          choice(
            seq(
              choice(
                field('inner', alias(sym('_inner_block_doc_comment_marker'), sym('inner_doc_comment_marker'))),
                field('outer', alias(sym('_outer_block_doc_comment_marker'), sym('outer_doc_comment_marker')))
              ),
              optional(field('doc', alias(sym('_block_comment_content'), sym('doc_comment'))))
            ),
            sym('_block_comment_content')
          )
        ),
        '*/'
      ),

    _outer_block_comment: () => outerBlockComment('_outer_block_comment_start'),

    _orphan_block_comment: () => outerBlockComment('_orphan_block_doc_comment_start'),

    _path: ($) =>
      choice(
        $.self,
        alias('Self', $.identifier),
        alias(choice(...primitiveTypes), $.identifier),
        $.metavariable,
        $.super,
        $.crate,
        $.identifier,
        $.scoped_identifier,
        $._reserved_identifier
      ),

    identifier: () => /(r#)?[_\p{XID_Start}][_\p{XID_Continue}]*/u,

    _reserved_identifier: ($) => alias(choice(...reservedIdentifiers, 'auto', 'macro_rules'), $.identifier),

    _type_identifier: ($) => alias(choice($.identifier, 'auto', 'macro_rules'), sym('type_identifier')),
    _type_identifier_in_type_position: ($) =>
      choice($._type_identifier, alias(choice(...reservedIdentifiers, 'Self'), sym('type_identifier'))),
    _field_identifier: ($) => alias($.identifier, sym('field_identifier')),

    self: () => 'self',
    super: () => 'super',
    crate: () => 'crate',

    _macro_metavariable: ($) => choice($.metavariable, alias($._spaced_metavariable, $.metavariable)),
    _spaced_metavariable: () =>
      prec.dynamic(1, seq('$', choice(sym('_macro_metavariable_name'), token(prec(1, nonAsciiOrRawMacroName))))),
    metavariable: () => /\$(r#)?[_\p{XID_Start}][_\p{XID_Continue}]*/u,

    frontmatter: ($) =>
      seq(
        sym('_frontmatter_start'),
        optional($.frontmatter_info_string),
        sym('_frontmatter_header_end'),
        sym('frontmatter_content'),
        sym('_frontmatter_end')
      ),

    frontmatter_info_string: () => token.immediate(/[_\p{XID_Start}][_.\p{XID_Continue}-]*/u),
    _generic_type_turbofish: ($) =>
      prec(
        1,
        seq(
          field(
            'type',
            choice(
              $._type_identifier,
              alias(choice(...primitiveTypes), sym('type_identifier')),
              alias(choice(...reservedIdentifiers), $.identifier),
              $.scoped_type_identifier
            )
          ),
          '::',
          field('type_arguments', $.type_arguments)
        )
      ),
  },
});

/**
 * @param {import('@willbooster/web-tree-sitter/dsl').RuleOrLiteral} start
 * @param {import('@willbooster/web-tree-sitter/dsl').RuleOrLiteral} content
 * @param {import('@willbooster/web-tree-sitter/dsl').RuleOrLiteral} end
 */
function macroRepetitionSeparator(start, content, end) {
  return choice(
    /[^\s\u0085\u200E\u200F\u2028\u2029/+*?$"][^/+*?$"]*|\/(?:[^/*+*?$"][^/+*?$"]*)?|\$/,
    /[bc]?"(?:[^"\\]|\\[\s\S])*"/,
    /b?'(?:\\(?:[^xu]|u[0-9a-fA-F]{4}|u\{[0-9a-fA-F][0-9a-fA-F_]*\}|x[0-9a-fA-F]{2})|[^\\'])'/,
    seq(start, content, end)
  );
}

/**
 * @param {import('@willbooster/web-tree-sitter/dsl').RuleOrLiteral} ordinary
 * @param {import('@willbooster/web-tree-sitter/dsl').RuleOrLiteral} rest
 */
function commaListWithRest(ordinary, rest) {
  return seq(repeat(seq(ordinary, ',')), rest, repeat(seq(',', choice(ordinary, rest))), optional(','));
}

/**
 * @param {import('@willbooster/web-tree-sitter/dsl').RuleOrLiteral} sep
 * @param {import('@willbooster/web-tree-sitter/dsl').RuleOrLiteral} rule
 *
 * @returns {import('@willbooster/web-tree-sitter/dsl').SeqRule}
 */
function sepBy1(sep, rule) {
  return seq(rule, repeat(seq(sep, rule)));
}

/**
 * @param {import('@willbooster/web-tree-sitter/dsl').RuleOrLiteral} sep
 * @param {import('@willbooster/web-tree-sitter/dsl').RuleOrLiteral} rule
 *
 * @returns {import('@willbooster/web-tree-sitter/dsl').ChoiceRule}
 */
function sepBy(sep, rule) {
  return optional(sepBy1(sep, rule));
}

/** @param {string} start */
function outerLineComment(start) {
  return seq(
    alias(sym(start), '//'),
    field('outer', alias(sym('_outer_line_doc_comment_marker'), sym('outer_doc_comment_marker'))),
    field('doc', alias(sym('_line_doc_content'), sym('doc_comment')))
  );
}

/** @param {string} start */
function outerBlockComment(start) {
  return seq(
    alias(sym(start), '/*'),
    field('outer', alias(sym('_outer_block_doc_comment_marker'), sym('outer_doc_comment_marker'))),
    optional(field('doc', alias(sym('_block_comment_content'), sym('doc_comment')))),
    '*/'
  );
}
