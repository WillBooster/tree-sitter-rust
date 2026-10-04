import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test('keeps primitive casts in type queries without consuming following arithmetic', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  const query = new Query(language, '(_type/primitive_type) @primitive');
  try {
    for (const primitive of ['i32', 'f16', 'f128']) {
      const source = `fn f(x: ${primitive}, y: ${primitive}) { let z = x as ((${primitive})) + y; }`;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError).toBe(false);
        expect(query.captures(tree.rootNode).map(({ node }) => node.text)).toEqual([primitive, primitive, primitive]);
        expect(tree.rootNode.descendantsOfType('type_cast_expression').map((node) => node.text)).toEqual([
          `x as ((${primitive}))`,
        ]);
        expect(tree.rootNode.descendantsOfType('binary_expression').map((node) => node.text)).toEqual([
          `x as ((${primitive})) + y`,
        ]);
      } finally {
        tree.delete();
      }
    }
  } finally {
    query.delete();
    parser.delete();
  }
});
