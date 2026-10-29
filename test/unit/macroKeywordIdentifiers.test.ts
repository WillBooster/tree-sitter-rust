import { Language, Parser, Query, type Tree } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

import { position } from '../helpers/position.js';

await Parser.init();
const language = await Language.load('tree-sitter-rust.wasm');
const words = ['abstract', 'do', 'final', 'override', 'priv', 'typeof', 'unsized', 'virtual'];

test('retains macro keyword identifiers, macro names and metavariables', () => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(
    language,
    `
    (token_tree (identifier) @word)
    (macro_definition name: (identifier) @macro)
    (macro_invocation macro: (identifier) @macro)
    (metavariable) @variable
  `
  );
  const source = `macro_rules! keyword_table { ($keyword:ident) => { ${words.join(' ')} $keyword }; }
macro_rules! consume { ($($word:tt)*) => {}; }
consume!(${words.join(' ')});
fn after() {}`;
  const tree = parser.parse(source)!;
  try {
    checkTree(tree, [...words, ...words]);
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }

  function checkTree(current: Tree, expectedWords: string[]): void {
    expect(current.rootNode.hasError, source).toBe(false);
    const captures = query.captures(current.rootNode);
    const wordCaptures = captures.filter(({ name }) => name === 'word');
    expect(wordCaptures.map(({ node }) => node.text)).toEqual(expectedWords);
    expect(wordCaptures.every(({ node }) => node.isNamed && node.type === 'identifier')).toBe(true);
    expect(captures.filter(({ name }) => name === 'macro').map(({ node }) => node.text)).toEqual([
      'keyword_table',
      'consume',
      'consume',
    ]);
    expect(captures.filter(({ name }) => name === 'variable').map(({ node }) => node.text)).toEqual([
      '$keyword',
      '$keyword',
      '$word',
    ]);
    let offset = 0;
    for (const { node } of captures) {
      const start = source.indexOf(node.text, offset);
      expect(node.startIndex).toBe(start);
      expect(node.endIndex).toBe(start + node.text.length);
      expect(node.startPosition).toEqual(position(source, node.startIndex));
      expect(node.endPosition).toEqual(position(source, node.endIndex));
      offset = node.endIndex;
    }
    expect(current.rootNode.descendantsOfType('function_item').at(-1)!.childForFieldName('name')!.text).toBe('after');
  }
});
