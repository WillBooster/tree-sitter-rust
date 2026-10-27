import { Edit, Language, Parser, Query, type Tree } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

import { position, snapshot } from '../helpers/treeSnapshot.js';

await Parser.init();
const language = await Language.load('tree-sitter-rust.wasm');
const words = ['abstract', 'do', 'final', 'override', 'priv', 'typeof', 'unsized', 'virtual'];

test('retains macro keyword identifiers, macro names and metavariables through edits', () => {
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
  let source = `macro_rules! keyword_table { ($keyword:ident) => { ${words.join(' ')} $keyword }; }
macro_rules! consume { ($($word:tt)*) => {}; }
consume!(${words.join(' ')});
fn after() {}`;
  let tree = parser.parse(source)!;
  const start = source.indexOf('abstract');
  try {
    checkTree(tree, [...words, ...words]);
    for (const [before, after] of [
      ['abstract', 'r#abstract'],
      ['r#abstract', 'abstract'],
    ] as const) {
      const nextSource = source.slice(0, start) + after + source.slice(start + before.length);
      tree.edit(
        new Edit({
          startIndex: start,
          oldEndIndex: start + before.length,
          newEndIndex: start + after.length,
          startPosition: position(source, start),
          oldEndPosition: position(source, start + before.length),
          newEndPosition: position(nextSource, start + after.length),
        })
      );
      const previous = tree;
      tree = parser.parse(nextSource, previous)!;
      previous.delete();
      source = nextSource;
      const fresh = parser.parse(source)!;
      try {
        const expected = [after, ...words.slice(1), ...words];
        checkTree(tree, expected);
        checkTree(fresh, expected);
        expect(snapshot(tree.rootNode)).toEqual(snapshot(fresh.rootNode));
      } finally {
        fresh.delete();
      }
    }
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
