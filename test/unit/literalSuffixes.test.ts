import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test('keeps non-numeric suffixes in literal tokens without consuming separated identifiers', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  const query = new Query(language, '(_literal) @literal');
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
  const source = `tokens!(${literals.join(', ')}, "separate" suffix, 'x' /* gap */ other);`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(query.captures(tree.rootNode).map(({ node }) => node.text)).toEqual([
      ...literals.slice(0, -1),
      'r##"raw"##r',
      '"separate"',
      "'x'",
    ]);
    expect(tree.rootNode.descendantsOfType('identifier').map((node) => node.text)).toEqual([
      'tokens',
      'identifier',
      'suffix',
      'other',
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
    ]);
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});
