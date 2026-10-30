import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

const LiteralTypes = [
  'boolean_literal',
  'char_literal',
  'float_literal',
  'integer_literal',
  'raw_string_literal',
  'string_literal',
];

test('keeps non-numeric suffixes in literal tokens without consuming separated identifiers', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  const literals = [
    '"text"custom',
    'r#"raw"#custom',
    "'x'custom",
    "b'x'custom",
    'b"bytes"custom',
    'br"raw bytes"custom',
    'c"cstring"custom',
    'cr"raw c"custom',
    '"text"_unit',
    "'x'类型",
    'r##"raw"##r#identifier',
  ];
  const source = `tokens!(${literals.join(', ')}, "separate" suffix, 'x' /* gap */ other, "close"/*gap*/suffix2, r"raw"/*gap*/rawSuffix, "raw-id"/*gap*/r#identifier);`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType(LiteralTypes).map((node) => node.text)).toEqual([
      ...literals.slice(0, -1),
      'r##"raw"##r',
      '"separate"',
      "'x'",
      '"close"',
      'r"raw"',
      '"raw-id"',
    ]);
    expect(tree.rootNode.descendantsOfType('identifier').map((node) => node.text)).toEqual([
      'tokens',
      'identifier',
      'suffix',
      'other',
      'suffix2',
      'rawSuffix',
      'r#identifier',
    ]);
    expect(tree.rootNode.descendantsOfType('string_content').map((node) => node.text)).toEqual([
      'text',
      'raw',
      'bytes',
      'raw bytes',
      'cstring',
      'raw c',
      'text',
      'raw',
      'separate',
      'close',
      'raw',
      'raw-id',
    ]);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test('keeps raw-string prefixes in adjacent suffixes', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  try {
    for (const first of ['"a"', 'b"a"', 'c"a"', 'r#"a"#', 'br#"a"#', 'cr#"a"#']) {
      for (const prefix of ['r', 'br', 'cr']) {
        for (const second of ['"b"', '#"b"#']) {
          const source = `tokens!(${first}${prefix}${second});`;
          const tree = parser.parse(source)!;
          try {
            expect(tree.rootNode.hasError, source).toBe(false);
            expect(tree.rootNode.descendantsOfType(LiteralTypes).map((node) => node.text)).toEqual([
              first + prefix,
              '"b"',
            ]);
          } finally {
            tree.delete();
          }
        }
      }
    }
  } finally {
    parser.delete();
  }
});
