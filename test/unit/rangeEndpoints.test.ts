import { Language, Parser, Query, type Tree } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test('parses unary range endpoints', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(
    'fn ranges(written: &usize, signed: i32) { let _ = ..*written; let _ = ..&written; let _ = ..-signed; }'
  );
  try {
    expect(tree?.rootNode.hasError).toBe(false);
    expect(
      tree!.rootNode
        .descendantsOfType('range_expression')
        .flatMap((node) => node.namedChildren)
        .map((node) => node.text)
    ).toEqual(['*written', '&written', '-signed']);
  } finally {
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

test('keeps bounded unary endpoints and following loop bodies', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, '(for_expression body: (block) @body)');
  let tree: Tree | undefined;
  try {
    tree = parser.parse(BoundedSource)!;
    checkTree(tree);
  } finally {
    tree?.delete();
    query.delete();
    parser.delete();
  }

  function checkTree(current: Tree): void {
    expect(current.rootNode.hasError).toBe(false);
    expect(
      current.rootNode
        .descendantsOfType('range_expression')
        .flatMap((node) => node.namedChildren)
        .map((node) => [node.type, node.text])
    ).toEqual([
      ['integer_literal', '0'],
      ['binary_expression', '-*ptr+5'],
      ['identifier', 'start'],
      ['reference_expression', '&n'],
      ['integer_literal', '0'],
      ['unary_expression', '-*ptr'],
      ['integer_literal', '1'],
    ]);
    expect(query.captures(current.rootNode).map(({ node }) => node.text)).toEqual(['{ if i>3 { break; } }']);
  }
});
