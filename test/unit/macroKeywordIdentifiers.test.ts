import { Language, Parser, type Tree } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

import { directChildren, fieldNodes, sortNodes } from '../helpers/ast.js';
import { position } from '../helpers/position.js';

await Parser.init();
const language = await Language.load('tree-sitter-rust.wasm');
const words = ['abstract', 'do', 'final', 'override', 'priv', 'typeof', 'unsized', 'virtual'];

test('retains macro keyword identifiers, macro names and metavariables', () => {
  const parser = new Parser().setLanguage(language);
  const source = `macro_rules! keyword_table { ($keyword:ident) => { ${words.join(' ')} $keyword }; }
macro_rules! consume { ($($word:tt)*) => {}; }
consume!(${words.join(' ')});
fn after() {}`;
  try {
    for (const word of ['abstract', 'r#abstract']) {
      const text = source.replace('abstract', word);
      const tree = parser.parse(text)!;
      try {
        checkTree(tree, text, [word, ...words.slice(1), ...words]);
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});

function checkTree(current: Tree, source: string, expectedWords: string[]): void {
  expect(current.rootNode.hasError, source).toBe(false);
  const wordNodes = directChildren(current.rootNode, 'token_tree', 'identifier');
  const macroNodes = sortNodes([
    ...fieldNodes(current.rootNode, 'macro_definition', 'name', 'identifier'),
    ...fieldNodes(current.rootNode, 'macro_invocation', 'macro', 'identifier'),
  ]);
  const variableNodes = current.rootNode.descendantsOfType('metavariable');
  expect(wordNodes.map((node) => node.text)).toEqual(expectedWords);
  expect(wordNodes.every((node) => node.isNamed && node.type === 'identifier')).toBe(true);
  expect(macroNodes.map((node) => node.text)).toEqual(['keyword_table', 'consume', 'consume']);
  expect(variableNodes.map((node) => node.text)).toEqual(['$keyword', '$keyword', '$word']);
  let offset = 0;
  for (const node of sortNodes([...wordNodes, ...macroNodes, ...variableNodes])) {
    const start = source.indexOf(node.text, offset);
    expect(node.startIndex).toBe(start);
    expect(node.endIndex).toBe(start + node.text.length);
    expect(node.startPosition).toEqual(position(source, node.startIndex));
    expect(node.endPosition).toEqual(position(source, node.endIndex));
    offset = node.endIndex;
  }
  expect(current.rootNode.descendantsOfType('function_item').at(-1)!.childForFieldName('name')!.text).toBe('after');
}
