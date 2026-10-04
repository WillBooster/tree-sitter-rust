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
