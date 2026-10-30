import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test('exposes trait aliases and declarative macros through public fields', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  const root = path.join(import.meta.dirname, '../..');
  const corpus = readFileSync(path.join(root, 'test/corpus/nightlyDeclarations.txt'), 'utf8');
  const source = corpus.split(/\n={20,}\n/)[1]!.split(/\n-{20,}\n/)[0]!;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const aliases = tree.rootNode.descendantsOfType('trait_alias');
    expect(aliases.map((node) => node.childForFieldName('name')?.text)).toEqual([
      'Displayable',
      'Lending',
      'Empty',
      'WithLifetime',
      'HigherRanked',
      'Trailing',
    ]);
    expect(aliases[1]?.childForFieldName('type_parameters')?.text).toBe("<'a, T>");
    expect(aliases[1]?.childForFieldName('bounds')?.text).toBe("Iterator<Item = &'a T>");
    const macros = tree.rootNode.descendantsOfType('decl_macro');
    expect(macros.map((node) => node.childForFieldName('name')?.text)).toEqual(['identity', 'choose']);
    expect(macros[0]?.childForFieldName('parameters')?.type).toBe('token_tree');
    expect(macros[0]?.childForFieldName('parameters')?.text).toBe('($value:expr)');
    expect(macros[1]?.childForFieldName('parameters')).toBeNull();
    expect(macros.every((node) => node.childForFieldName('body')?.type === 'token_tree')).toBe(true);
    const expansion = parser.parse(macros[0]!.childForFieldName('body')!.text)!;
    try {
      expect(expansion.rootNode.hasError).toBe(false);
    } finally {
      expansion.delete();
    }
  } finally {
    tree.delete();
    parser.delete();
  }
});
