import path from 'node:path';
import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-rust.wasm'));

test('preserves contextual constructor names in generic tuple patterns', () => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(
    language,
    '(tuple_struct_pattern type: (generic_type type: (_) @constructor type_arguments: (type_arguments) @arguments)) @pattern'
  );
  try {
    for (const name of ['default', 'union', 'raw', 'gen', 'auto', 'Ordinary', 'r#gen']) {
      for (const statement of [`let ${name}::<u8>(n) = value;`, `match value { ${name}::<u8>(n) => n };`]) {
        const source = `fn f() { ${statement} after(); }`;
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(false);
          const captures = query.captures(tree.rootNode);
          expect(
            captures.filter((c) => c.name === 'constructor').map((c) => c.node.text),
            source
          ).toEqual([name]);
          expect(
            captures.filter((c) => c.name === 'arguments').map((c) => c.node.text),
            source
          ).toEqual(['<u8>']);
          expect(
            captures.filter((c) => c.name === 'pattern').map((c) => c.node.text),
            source
          ).toEqual([`${name}::<u8>(n)`]);
          expect(
            tree.rootNode.descendantsOfType('call_expression').map((n) => n.text),
            source
          ).toEqual(['after()']);
        } finally {
          tree.delete();
        }
      }
    }
  } finally {
    query.delete();
    parser.delete();
  }
});
