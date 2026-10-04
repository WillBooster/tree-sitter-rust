import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test('preserves const declaration fields and shipped query captures', async () => {
  const root = path.join(import.meta.dirname, '../..');
  await Parser.init();
  const language = await Language.load(path.join(root, 'tree-sitter-rust.wasm'));
  const parser = new Parser();
  parser.setLanguage(language);
  const corpus = readFileSync(path.join(root, 'test/corpus/constTraits.txt'), 'utf8');
  const source = corpus.split(/\n={20,}\n/)[1]!.split(/\n-{20,}\n/)[0]!;
  const tree = parser.parse(source)!;
  const declarations = new Query(language, '(_declaration_statement) @declaration');
  const highlights = new Query(language, readFileSync(path.join(root, 'queries/highlights.scm'), 'utf8'));
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
    const captured = declarations.captures(tree.rootNode).map(({ node }) => node.startIndex);
    for (const declaration of [...traits, ...implementations]) {
      expect(declaration.childForFieldName('body')?.type).toBe('declaration_list');
      expect(captured).toContain(declaration.startIndex);
    }
    const keywords = highlights.captures(tree.rootNode).filter(({ name }) => name === 'keyword');
    expect(
      [...traits, ...implementations].map((declaration) =>
        keywords.filter(({ node }) => node.parent?.id === declaration.id).map(({ node }) => node.text)
      )
    ).toEqual([
      ['const', 'trait'],
      ['const', 'unsafe', 'trait'],
      ['const', 'impl', 'for'],
      ['const', 'impl', 'for'],
      ['const', 'unsafe', 'impl', 'for'],
    ]);
    expect(tree.rootNode.descendantsOfType('const_item').map((node) => node.childForFieldName('name')?.text)).toEqual([
      'VALUE',
    ]);
    expect(
      tree.rootNode
        .descendantsOfType('function_item')
        .some((node) => node.childForFieldName('name')?.text === 'unsafe_function')
    ).toBe(true);
  } finally {
    highlights.delete();
    declarations.delete();
    tree.delete();
    parser.delete();
  }
});
