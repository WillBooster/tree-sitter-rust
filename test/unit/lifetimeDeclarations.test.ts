import { Edit, Language, Parser, Query, type Tree } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

import { position, snapshot } from '../helpers/treeSnapshot.js';

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

test.each(["'static", "'_", "'r#static", "'r#_"])(
  'rejects reserved lifetime declaration %s while retaining following items and edit parity',
  (reservedName) => {
    const parser = new Parser().setLanguage(language);
    const query = new Query(
      language,
      '(lifetime_parameter name: (lifetime) @declaration) (for_lifetimes (lifetime) @declaration) (function_item name: (identifier) @function)'
    );
    try {
      for (const declaration of declarationSources) {
        let source = declaration + '\nfn after() {}\n';
        let tree = parser.parse(source)!;
        const start = source.indexOf("'slot");
        try {
          checkTree(tree, false);
          expect(
            query.captures(tree.rootNode).some(({ name, node }) => name === 'declaration' && node.text === "'slot")
          ).toBe(true);
          for (const [before, after, invalid] of [
            ["'slot", reservedName, true],
            [reservedName, "'slot", false],
          ] as const) {
            const next = source.slice(0, start) + after + source.slice(start + before.length);
            tree.edit(
              new Edit({
                startIndex: start,
                oldEndIndex: start + before.length,
                newEndIndex: start + after.length,
                startPosition: position(source, start),
                oldEndPosition: position(source, start + before.length),
                newEndPosition: position(next, start + after.length),
              })
            );
            const previous = tree;
            tree = parser.parse(next, previous)!;
            previous.delete();
            source = next;
            const fresh = parser.parse(source)!;
            try {
              checkTree(tree, invalid);
              checkTree(fresh, invalid);
              expect(snapshot(tree.rootNode)).toEqual(snapshot(fresh.rootNode));
              expect(captures(tree)).toEqual(captures(fresh));
            } finally {
              fresh.delete();
            }
          }
        } finally {
          tree.delete();
        }

        function checkTree(current: Tree, invalid: boolean): void {
          expect(current.rootNode.hasError, source).toBe(invalid);
          const after = query
            .captures(current.rootNode)
            .find(({ name, node }) => name === 'function' && node.text === 'after')!.node;
          expect([after.startIndex, after.endIndex]).toEqual([
            source.lastIndexOf('after'),
            source.lastIndexOf('after') + 5,
          ]);
        }
      }
    } finally {
      query.delete();
      parser.delete();
    }

    function captures(tree: Tree): Array<[string, string, string, number, number]> {
      return query
        .captures(tree.rootNode)
        .map(({ name, node }) => [name, node.type, node.text, node.startIndex, node.endIndex]);
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
  const query = new Query(
    language,
    '(function_item name: (identifier) @function) (lifetime (identifier) @lifetime) (token_tree (identifier) @token)'
  );
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const captures = query.captures(tree.rootNode);
    expect(captures.filter(({ name }) => name === 'function').map(({ node }) => node.text)).toEqual([
      'r#static',
      'named',
      'after',
    ]);
    expect(captures.filter(({ name }) => name === 'token').map(({ node }) => node.text)).toEqual([
      'r#static',
      'r#type',
      'r#if',
    ]);
    expect(captures.filter(({ name }) => name === 'lifetime').map(({ node }) => node.text)).toEqual([
      'r#static',
      '_',
      'r#if',
      'r#if',
      'r#if',
    ]);
    for (const { node } of captures) {
      expect(source.slice(node.startIndex, node.endIndex)).toBe(node.text);
      expect(node.startPosition).toEqual(position(source, node.startIndex));
      expect(node.endPosition).toEqual(position(source, node.endIndex));
    }
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});
