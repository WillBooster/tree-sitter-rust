import { Edit, Language, Parser, Query } from '@willbooster/web-tree-sitter';
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
  const source = `tokens!(${literals.join(', ')}, "separate" suffix, 'x' /* gap */ other, "close"/*gap*/suffix2, r"raw"/*gap*/rawSuffix, "raw-id"/*gap*/r#identifier);`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(query.captures(tree.rootNode).map(({ node }) => node.text)).toEqual([
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
    query.delete();
    parser.delete();
  }
});

test('keeps raw-string prefixes in adjacent suffixes through incremental trivia edits', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  const query = new Query(language, '(_literal) @literal');
  try {
    for (const first of ['"a"', 'b"a"', 'c"a"', 'r#"a"#', 'br#"a"#', 'cr#"a"#']) {
      for (const prefix of ['r', 'br', 'cr']) {
        for (const second of ['"b"', '#"b"#']) {
          const source = `tokens!(${first}${prefix}${second});`;
          let tree = parser.parse(source)!;
          const boundary = 8 + first.length;
          try {
            expect(tree.rootNode.hasError, source).toBe(false);
            expect(query.captures(tree.rootNode).map(({ node }) => node.text)).toEqual([first + prefix, '"b"']);
            for (const gap of [' ', '/* gap */', '\n', '\u0085', '\u2028', '\u2029']) {
              tree.edit(
                new Edit({
                  startIndex: boundary,
                  oldEndIndex: boundary,
                  newEndIndex: boundary + gap.length,
                  startPosition: { row: 0, column: boundary },
                  oldEndPosition: { row: 0, column: boundary },
                  newEndPosition: gap === '\n' ? { row: 1, column: 0 } : { row: 0, column: boundary + gap.length },
                })
              );
              const edited = parser.parse(source.slice(0, boundary) + gap + source.slice(boundary), tree)!;
              tree.delete();
              tree = edited;
              expect(tree.rootNode.hasError).toBe(false);
              expect(query.captures(tree.rootNode).map(({ node }) => node.text)).toEqual([first, prefix + second]);
              tree.edit(
                new Edit({
                  startIndex: boundary,
                  oldEndIndex: boundary + gap.length,
                  newEndIndex: boundary,
                  startPosition: { row: 0, column: boundary },
                  oldEndPosition: gap === '\n' ? { row: 1, column: 0 } : { row: 0, column: boundary + gap.length },
                  newEndPosition: { row: 0, column: boundary },
                })
              );
              const restored = parser.parse(source, tree)!;
              tree.delete();
              tree = restored;
              expect(tree.rootNode.hasError).toBe(false);
              expect(query.captures(tree.rootNode).map(({ node }) => node.text)).toEqual([first + prefix, '"b"']);
            }
          } finally {
            tree.delete();
          }
        }
      }
    }
  } finally {
    query.delete();
    parser.delete();
  }
});
