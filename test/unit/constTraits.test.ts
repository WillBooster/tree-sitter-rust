import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test('preserves const declaration fields', async () => {
  const root = path.join(import.meta.dirname, '../..');
  await Parser.init();
  const language = await Language.load(path.join(root, 'tree-sitter-rust.wasm'));
  const parser = new Parser();
  parser.setLanguage(language);
  const corpus = readFileSync(path.join(root, 'test/corpus/constTraits.txt'), 'utf8');
  const source = corpus.split(/\n={20,}\n/)[1]!.split(/\n-{20,}\n/)[0]!;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const traits = tree.rootNode.descendantsOfType('trait_item');
    const implementations = tree.rootNode.descendantsOfType('impl_item');
    expect(traits.map((node) => node.childForFieldName('name')?.text)).toEqual(['Value', 'Marker']);
    expect(
      implementations.map((node) => [node.childForFieldName('trait')?.text, node.childForFieldName('type')?.text])
    ).toEqual([
      ['Value', 'u8'],
      ['Value', 'Wrapper<T>'],
      ['Marker', 'Wrapper<T>'],
    ]);
    for (const declaration of [...traits, ...implementations]) {
      expect(declaration.childForFieldName('body')?.type).toBe('declaration_list');
    }
    expect(tree.rootNode.descendantsOfType('const_item').map((node) => node.childForFieldName('name')?.text)).toEqual([
      'VALUE',
    ]);
    expect(
      tree.rootNode
        .descendantsOfType('function_item')
        .some((node) => node.childForFieldName('name')?.text === 'unsafe_function')
    ).toBe(true);
  } finally {
    tree.delete();
    parser.delete();
  }
});
