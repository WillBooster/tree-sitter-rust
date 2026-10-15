import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load('tree-sitter-rust.wasm');

test.each([
  ['#[allow(unused)] value', 'value', ['#[allow(unused)]']],
  ['#[allow(unused)] value: u32', 'value: u32', ['#[allow(unused)]']],
  ['#[allow(unused)] (left, right): (u8, u8)', '(left, right): (u8, u8)', ['#[allow(unused)]']],
  [
    '#[allow(unused)] #[allow(unused_mut)] mut value: u32, #[allow(unused)] other: u32,',
    'mut value: u32, other: u32,',
    ['#[allow(unused)]', '#[allow(unused_mut)]', '#[allow(unused)]'],
  ],
] as const)(
  'preserves closure parameters and exposes their outer attributes: %s',
  (parameters, control, attributes) => {
    const parser = new Parser().setLanguage(language);
    const tree = parser.parse(`fn f() { let closure = |${parameters}| { 0 }; }`)!;
    const controlTree = parser.parse(`fn f() { let closure = |${control}| { 0 }; }`)!;
    try {
      expect(controlTree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.hasError).toBe(false);
      const children = tree.rootNode.descendantsOfType('closure_parameters')[0]!.namedChildren;
      expect(children.filter((node) => node.type !== 'attribute_item').map((node) => node.toString())).toEqual(
        controlTree.rootNode.descendantsOfType('closure_parameters')[0]!.namedChildren.map((node) => node.toString())
      );
      const query = new Query(language, '(closure_parameters (attribute_item) @attribute)');
      try {
        expect(query.captures(tree.rootNode).map(({ node }) => node.text)).toEqual(attributes);
      } finally {
        query.delete();
      }
    } finally {
      controlTree.delete();
      tree.delete();
      parser.delete();
    }
  }
);

test('requires a parameter after outer attributes and rejects inner attributes', () => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const parameters of ['#[allow(unused)]', '#[allow(unused)], value', '#![allow(unused)] value']) {
      const tree = parser.parse(`fn f() { let closure = |${parameters}| { 0 }; }`)!;
      try {
        expect(tree.rootNode.hasError, parameters).toBe(true);
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});
