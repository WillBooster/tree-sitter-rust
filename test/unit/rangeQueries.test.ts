import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

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
