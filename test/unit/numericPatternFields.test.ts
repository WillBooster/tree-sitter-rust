import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load('tree-sitter-rust.wasm');

test.each([
  'fn main() { let Pair { 0: first, 1: second } = value; }',
  'fn main() { match value { E::Pair { 0: first, 1: second, .. } => {} } }',
  'fn parameter(Pair { 0: first, 1: second }: Pair) {}',
  'fn main() { let Pair { #[allow(unused)] 0: first, 1: second } = value; }',
  'fn main() { let Pair::<u8> { 0: first, 1: second } = value; }',
])('exposes numbered struct-pattern fields and their bindings: %s', (source) => {
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const fields = tree.rootNode.descendantsOfType('field_pattern');
    expect(
      fields.map((node) => [
        node.childForFieldName('name')?.type,
        node.childForFieldName('name')?.text,
        node.childForFieldName('pattern')?.text,
      ])
    ).toEqual([
      ['integer_literal', '0', 'first'],
      ['integer_literal', '1', 'second'],
    ]);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test('distinguishes numbered field names from nested literal patterns in public queries', () => {
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse('fn main() { match value { Outer { 0: Inner { 1: 42, .. }, .. } => {} } }')!;
  const query = new Query(language, '(field_pattern name: (_) @field) (_literal_pattern) @literal');
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(query.captures(tree.rootNode).map(({ name, node }) => [name, node.type, node.text])).toEqual([
      ['field', 'integer_literal', '0'],
      ['field', 'integer_literal', '1'],
      ['literal', 'integer_literal', '42'],
    ]);
  } finally {
    query.delete();
    tree.delete();
    parser.delete();
  }
});

test('rejects numbered shorthand and non-decimal or suffixed pattern field names', () => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const field of ['0', '0u8: value', '0foo: value', '0.0: value', '0x0: value']) {
      const tree = parser.parse(`fn main() { let Pair { ${field} } = value; }`)!;
      try {
        expect(tree.rootNode.hasError, field).toBe(true);
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});
