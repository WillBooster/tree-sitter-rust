import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test('preserves default associated item fields', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  const source = 'impl<Ty> T for Ty { #[a] default const X: u8 = 1; #[b] default type A = Vec<u8>; } fn following() {}';
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const implementation = tree.rootNode.descendantsOfType('impl_item')[0]!;
    const body = implementation.childForFieldName('body')!;
    expect(body.namedChildren.map((node) => node.type)).toEqual(['attributed_declaration', 'attributed_declaration']);
    const items = body.namedChildren.map((node) => node.childForFieldName('declaration')!);
    expect(items.map((node) => [node.type, node.text, node.childForFieldName('name')?.text])).toEqual([
      ['const_item', 'default const X: u8 = 1;', 'X'],
      ['type_item', 'default type A = Vec<u8>;', 'A'],
    ]);
    expect(items.map((node) => node.childForFieldName('type')?.text)).toEqual(['u8', 'Vec<u8>']);
    expect(items[0]!.childForFieldName('value')?.text).toBe('1');
    expect(tree.rootNode.descendantsOfType('function_item')[0]!.childForFieldName('name')?.text).toBe('following');

    for (const invalid of ['default const X: u8 = 1;', 'default type A = u8;']) {
      const invalidTree = parser.parse(invalid)!;
      try {
        expect(invalidTree.rootNode.hasError).toBe(true);
      } finally {
        invalidTree.delete();
      }
    }
  } finally {
    tree.delete();
    parser.delete();
  }
});
