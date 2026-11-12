import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

import { directChildren, fieldNodes, sortNodes } from '../helpers/ast.js';
import { position } from '../helpers/position.js';

await Parser.init();
const language = await Language.load('tree-sitter-rust.wasm');
const declarationSources = [
  "fn take<'slot>(value: &'slot str) -> &'slot str { value }",
  "fn take<'a, 'slot: 'a>() {}",
  "struct S<'slot>(&'slot str);",
  "enum E<'slot> { Value(&'slot str) }",
  "trait T<'slot> {}",
  "struct S; impl<'slot> S {}",
  "type Alias<'slot> = &'slot str;",
  "type F = for<'slot> fn(&'slot str);",
  "trait T<'a> {} type O = dyn Send + for<'slot> T<'slot>;",
  "fn take<T>() where for<'slot> T: Sized {}",
];

test.each(["'slot", "'static", "'_", "'r#static", "'r#_"])(
  'parses lifetime declaration %s while retaining following items',
  (name) => {
    const parser = new Parser().setLanguage(language);
    const invalid = name !== "'slot";
    try {
      for (const declaration of declarationSources) {
        const start = declaration.indexOf("'slot");
        const source =
          declaration.slice(0, start) + name + declaration.slice(start + "'slot".length) + '\nfn after() {}\n';
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(invalid);
          const after = fieldNodes(tree.rootNode, 'function_item', 'name', 'identifier').find(
            (node) => node.text === 'after'
          )!;
          expect([after.startIndex, after.endIndex]).toEqual([
            source.lastIndexOf('after'),
            source.lastIndexOf('after') + 5,
          ]);
          if (!invalid) {
            const declarations = [
              ...fieldNodes(tree.rootNode, 'lifetime_parameter', 'name', 'lifetime'),
              ...directChildren(tree.rootNode, 'for_lifetimes', 'lifetime'),
            ];
            expect(declarations.some((node) => node.text === "'slot")).toBe(true);
          }
        } finally {
          tree.delete();
        }
      }
    } finally {
      parser.delete();
    }
  }
);

test('preserves raw lifetime references, ordinary raw names and macro captures', () => {
  const source = `macro_rules! names { ($($word:tt)*) => {}; }
names!(r#static r#type r#if);
fn r#static(value: &'r#static str) -> &'_ str { value }
fn named<'r#if>(value: &'r#if str) -> &'r#if str { value }
fn after() {}
`;
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const functions = fieldNodes(tree.rootNode, 'function_item', 'name', 'identifier');
    const tokens = directChildren(tree.rootNode, 'token_tree', 'identifier');
    const lifetimes = directChildren(tree.rootNode, 'lifetime', 'identifier');
    expect(functions.map((node) => node.text)).toEqual(['r#static', 'named', 'after']);
    expect(tokens.map((node) => node.text)).toEqual(['r#static', 'r#type', 'r#if']);
    expect(lifetimes.map((node) => node.text)).toEqual(['r#static', '_', 'r#if', 'r#if', 'r#if']);
    for (const node of sortNodes([...functions, ...tokens, ...lifetimes])) {
      expect(source.slice(node.startIndex, node.endIndex)).toBe(node.text);
      expect(node.startPosition).toEqual(position(source, node.startIndex));
      expect(node.endPosition).toEqual(position(source, node.endIndex));
    }
  } finally {
    tree.delete();
    parser.delete();
  }
});
