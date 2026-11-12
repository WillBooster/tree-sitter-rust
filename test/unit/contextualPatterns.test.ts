import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-rust.wasm'));

test('preserves contextual constructor names in generic tuple patterns', () => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const name of ['default', 'union', 'raw', 'gen', 'auto', 'Ordinary', 'r#gen']) {
      for (const statement of [`let ${name}::<u8>(n) = value;`, `match value { ${name}::<u8>(n) => n };`]) {
        const source = `fn f() { ${statement} after(); }`;
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(false);
          const patterns = tree.rootNode.descendantsOfType('tuple_struct_pattern').filter((node) => {
            const genericType = node.childForFieldName('type');
            return (
              genericType?.type === 'generic_type' &&
              genericType.childForFieldName('type')?.isNamed &&
              genericType.childForFieldName('type_arguments')?.type === 'type_arguments'
            );
          });
          expect(
            patterns.map((node) => node.childForFieldName('type')!.childForFieldName('type')!.text),
            source
          ).toEqual([name]);
          expect(
            patterns.map((node) => node.childForFieldName('type')!.childForFieldName('type_arguments')!.text),
            source
          ).toEqual(['<u8>']);
          expect(
            patterns.map((node) => node.text),
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
    parser.delete();
  }
});

test('preserves contextual names and fields in plain and generic struct patterns', () => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const name of ['default', 'union', 'raw', 'gen', 'auto', 'Ordinary', 'r#gen']) {
      for (const type of [name, `${name}::<u8>`]) {
        for (const statement of [`let ${type} { a } = value;`, `match value { ${type} { a } => a };`]) {
          const source = `fn f() { ${statement} after(); }`;
          const tree = parser.parse(source)!;
          try {
            expect(tree.rootNode.hasError, source).toBe(false);
            const matches = tree.rootNode.descendantsOfType('struct_pattern').flatMap((pattern) => {
              const typeNode = pattern.childForFieldName('type');
              if (!typeNode?.isNamed) return [];
              return pattern.children
                .filter((child) => child.type === 'field_pattern' && child.childForFieldName('name')?.isNamed)
                .map((fieldNode) => ({
                  pattern,
                  typeNode,
                  fieldName: fieldNode.childForFieldName('name')!,
                }));
            });
            expect(
              matches.map((m) => m.typeNode.text),
              source
            ).toEqual([type]);
            expect(
              matches.map((m) => m.fieldName.text),
              source
            ).toEqual(['a']);
            expect(
              matches.map((m) => m.pattern.text),
              source
            ).toEqual([`${type} { a }`]);
            expect(
              tree.rootNode.descendantsOfType('call_expression').map((n) => n.text),
              source
            ).toEqual(['after()']);
          } finally {
            tree.delete();
          }
        }
      }
    }
  } finally {
    parser.delete();
  }
});
