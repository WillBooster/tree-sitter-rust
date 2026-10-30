import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test('retains ordinary macro identifiers named auto', async () => {
  await Parser.init();
  const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-rust.wasm'));
  const parser = new Parser();
  parser.setLanguage(language);
  const source =
    'auto trait Top {}\nmacro_rules! m { () => { auto trait Inside {} }; }\ndeclare! { unsafe auto trait Generated {} }\nident!(auto);\nkinds! { auto, trait, impl }\nkinds! { auto; trait }';
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(
      tree.rootNode
        .descendantsOfType('identifier')
        .filter((node) => node.text === 'auto')
        .map((node) => node.startPosition.row)
    ).toEqual([1, 2, 3, 4, 5]);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(['auto', 'default', 'union', 'raw', 'gen'])(
  'preserves contextual name %s in generic unit-struct patterns',
  async (name) => {
    await Parser.init();
    const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-rust.wasm'));
    const parser = new Parser();
    parser.setLanguage(language);
    try {
      const tree = parser.parse(
        `struct ${name}<const N: usize>; fn f(value: ${name}<1>) { let ${name}::<1> = value; match value { ${name}::<1> => () } }`
      )!;
      try {
        expect(tree.rootNode.hasError).toBe(false);
        expect(
          tree.rootNode
            .descendantsOfType('generic_pattern')
            .map((node) => [
              node.firstNamedChild?.type,
              node.firstNamedChild?.text,
              node.childForFieldName('type_arguments')?.text,
            ])
        ).toEqual([
          ['identifier', name, '<1>'],
          ['identifier', name, '<1>'],
        ]);
      } finally {
        tree.delete();
      }
    } finally {
      parser.delete();
    }
  }
);
