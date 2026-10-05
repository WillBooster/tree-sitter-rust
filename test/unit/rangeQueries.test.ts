import { Edit, Language, Parser, Query, type Tree } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

import { position, snapshot } from '../helpers/treeSnapshot.js';

test('preserves expression supertype captures for unary range endpoints', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(
    'fn ranges(written: &usize, signed: i32) { let _ = ..*written; let _ = ..&written; let _ = ..-signed; }'
  );
  const query = new Query(language, '(range_expression (_expression) @endpoint)');
  try {
    expect(tree?.rootNode.hasError).toBe(false);
    expect(query.captures(tree!.rootNode).map(({ node }) => node.text)).toEqual(['*written', '&written', '-signed']);
  } finally {
    query.delete();
    tree?.delete();
    parser.delete();
  }
});

const BoundedSource = `fn main() {
 let n=3i32;
 let ptr=&n;
 let zero=0i32;
 let start=&zero;
 let bounded=0..-*ptr+5;
 let borrowed=start..&n;
 let inclusive=0..=-*ptr;
 for i in 1.. { if i>3 { break; } }
 assert_eq!(bounded.end,2);
 assert_eq!(*borrowed.end,3);
 assert_eq!(*inclusive.end(),-3);
}
`;

test('keeps bounded unary endpoints and following loop bodies through comment edits', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, '(range_expression (_expression) @endpoint) (for_expression body: (block) @body)');
  let source = BoundedSource;
  let tree: Tree | undefined;
  try {
    tree = parser.parse(source)!;
    checkTree(tree);
    for (const comment of ['/* endpoint */', '// endpoint\n', '/* outer /* nested */ end */']) {
      for (const [before, after] of [
        ['..-*ptr', `..${comment}-*ptr`],
        [`..${comment}-*ptr`, '..-*ptr'],
      ] as const) {
        const start = source.indexOf(before);
        expect(start).toBeGreaterThanOrEqual(0);
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
        const nextTree: Tree = parser.parse(next, tree)!;
        tree.delete();
        tree = nextTree;
        source = next;
        const fresh = parser.parse(source)!;
        try {
          expect(snapshot(tree.rootNode)).toEqual(snapshot(fresh.rootNode));
          expect(captures(tree)).toEqual(captures(fresh));
          checkTree(tree);
        } finally {
          fresh.delete();
        }
      }
    }
    expect(source).toBe(BoundedSource);
  } finally {
    tree?.delete();
    query.delete();
    parser.delete();
  }

  function captures(current: Tree): unknown {
    return query
      .captures(current.rootNode)
      .map(({ name, node }) => [
        name,
        node.type,
        node.text,
        node.startIndex,
        node.endIndex,
        node.startPosition,
        node.endPosition,
      ]);
  }

  function checkTree(current: Tree): void {
    expect(current.rootNode.hasError).toBe(false);
    const nodes = query.captures(current.rootNode);
    expect(nodes.filter(({ name }) => name === 'endpoint').map(({ node }) => [node.type, node.text])).toEqual([
      ['integer_literal', '0'],
      ['binary_expression', '-*ptr+5'],
      ['identifier', 'start'],
      ['reference_expression', '&n'],
      ['integer_literal', '0'],
      ['unary_expression', '-*ptr'],
      ['integer_literal', '1'],
    ]);
    expect(nodes.filter(({ name }) => name === 'body').map(({ node }) => node.text)).toEqual(['{ if i>3 { break; } }']);
  }
});
