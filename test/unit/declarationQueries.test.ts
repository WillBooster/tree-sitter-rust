import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test('captures concrete declarations through their public supertype', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  const source = 'const VALUE: i32 = 1; struct S; enum E { A } fn f() { let x = VALUE; x; } mod nested { fn g() {} }';
  const tree = parser.parse(source)!;
  const query = new Query(language, '(_declaration_statement) @declaration');
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(query.captures(tree.rootNode).map(({ node }) => [node.type, node.text])).toEqual([
      ['const_item', 'const VALUE: i32 = 1;'],
      ['struct_item', 'struct S;'],
      ['enum_item', 'enum E { A }'],
      ['function_item', 'fn f() { let x = VALUE; x; }'],
      ['let_declaration', 'let x = VALUE;'],
      ['mod_item', 'mod nested { fn g() {} }'],
      ['function_item', 'fn g() {}'],
    ]);
  } finally {
    query.delete();
    tree.delete();
    parser.delete();
  }
});

test('captures qualified extern declarations without accepting their qualifiers elsewhere', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  const query = new Query(language, '(_declaration_statement) @declaration');
  const items = [
    'fn ordinary();',
    'pub /* before */ safe /* after */ fn safe_function();',
    'static ORDINARY: i32;',
    'pub(crate) safe static SAFE: i32;',
    'pub(in /* outer /* inner */ comment */ crate) unsafe static UNSAFE: i32;',
  ];
  const source = `unsafe extern "C" { ${items.join('\n')} }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(query.captures(tree.rootNode).map(({ node }) => node.text)).toEqual([source, ...items]);
    for (const invalid of ['safe fn f();', 'safe static X: i32;', 'unsafe static X: i32;']) {
      const invalidTree = parser.parse(invalid)!;
      try {
        expect(invalidTree.rootNode.hasError, invalid).toBe(true);
      } finally {
        invalidTree.delete();
      }
    }
  } finally {
    query.delete();
    tree.delete();
    parser.delete();
  }
});
