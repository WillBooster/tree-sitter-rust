import path from 'node:path';
import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-rust.wasm'));

test('preserves contextual struct construction names and initializer fields', () => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(
    language,
    '(struct_expression name: (_) @name body: (field_initializer_list) @body) @expression'
  );
  try {
    for (const field of ['default', 'union', 'raw', 'gen', 'auto', 'u8']) {
      const source = `fn f() { let value = gen { ${field}: 1 }; let other = Self { ${field} }; }`;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        expect(
          tree.rootNode.descendantsOfType('shorthand_field_initializer').map((node) => node.firstNamedChild?.type)
        ).toEqual(['identifier']);
        expect(
          tree.rootNode.descendantsOfType('field_initializer').map((node) => node.childForFieldName('field')?.text)
        ).toEqual([field]);
      } finally {
        tree.delete();
      }
    }

    for (const name of ['default', 'union', 'raw', 'gen', 'auto', 'Ordinary', 'r#gen']) {
      for (const type of [name, `${name}::<u8>`]) {
        for (const body of [
          '{ a: 1 }',
          '{ a: 1, ..previous }',
          ...(name === 'gen' && type === name ? [] : ['{ a }']),
        ]) {
          const source = `fn f() { let value = ${type} ${body}; after(); }`;
          const tree = parser.parse(source)!;
          try {
            expect(tree.rootNode.hasError, source).toBe(false);
            const captures = query.captures(tree.rootNode);
            expect(
              captures.filter((c) => c.name === 'name').map((c) => c.node.text),
              source
            ).toEqual([type]);
            expect(
              captures.filter((c) => c.name === 'body').map((c) => c.node.text),
              source
            ).toEqual([body]);
            expect(tree.rootNode.descendantsOfType('call_expression').at(-1)?.text).toBe('after()');
          } finally {
            tree.delete();
          }
        }
      }
    }
    for (const body of [
      '{}',
      '{ value }',
      '{ 1 }',
      '{ 0 }',
      '{ 42; }',
      '{ 1_000 + 2 }',
      '{ 1 as u8 }',
      '{ #[cfg(x)] 1 }',
      '{ yield 1; }',
      'move { yield 1; }',
    ]) {
      const source = `fn f() { let value = gen ${body}; }`;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        expect(tree.rootNode.descendantsOfType('gen_block').map((node) => node.text)).toEqual([`gen ${body}`]);
        expect(tree.rootNode.descendantsOfType('struct_expression')).toHaveLength(0);
      } finally {
        tree.delete();
      }
    }
  } finally {
    query.delete();
    parser.delete();
  }
});
