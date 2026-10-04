import { readFileSync } from 'node:fs';

import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test('highlights auto trait modifiers while retaining ordinary macro identifiers', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  const query = new Query(language, readFileSync('queries/highlights.scm', 'utf8'));
  const source =
    'auto trait Top {}\nmacro_rules! m { () => { auto trait Inside {} }; }\ndeclare! { unsafe auto trait Generated {} }\nident!(auto);';
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(
      query
        .captures(tree.rootNode)
        .filter(({ name, node }) => name === 'keyword' && node.text === 'auto')
        .map(({ node }) => node.startPosition.row)
    ).toEqual([0, 1, 2]);
    expect(
      tree.rootNode
        .descendantsOfType('identifier')
        .filter((node) => node.text === 'auto')
        .map((node) => node.startPosition.row)
    ).toEqual([1, 2, 3]);
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});
