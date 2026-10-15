import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load('tree-sitter-rust.wasm');
const contextualNames = ['default', 'union', 'raw', 'gen'];

test.each(contextualNames)('preserves %s as a type identifier across type positions', (name) => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, '(type_identifier) @type');
  const source = `
    type Alias = ${name};
    struct Holder { value: ${name} }
    fn identity(value: ${name}) -> ${name} { value }
    impl ${name} {}
    type Nested = Vec<${name}>;
  `;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const captures = query.captures(tree.rootNode).filter(({ node }) => node.text === name);
    expect(captures.map(({ node }) => node.parent?.type)).toEqual([
      'type_item',
      'field_declaration',
      'parameter',
      'function_item',
      'impl_item',
      'type_arguments',
    ]);
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});

test.each(contextualNames)('preserves %s in bounds and trait type positions', (name) => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, '(type_identifier) @type');
  const tree = parser.parse(`
    fn f<T>() where ${name}: Trait {}
    impl ${name} for Holder {}
    fn object(_: &dyn ${name}) {}
    fn opaque() -> impl ${name} { loop {} }
    type Associated = Trait<${name} = u8>;
    type Callable = ${name}(u8) -> u8;
  `)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const captures = query.captures(tree.rootNode).filter(({ node }) => node.text === name);
    expect(captures.map(({ node }) => node.parent?.type)).toEqual([
      'where_predicate',
      'impl_item',
      'dynamic_type',
      'abstract_type',
      'type_binding',
      'function_type',
    ]);
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});

test('keeps existing contextual generic type names as identifier nodes', () => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const name of contextualNames) {
      const tree = parser.parse(`type Applied = ${name}<u8>; type Turbofish = ${name}::<u8>;`)!;
      try {
        expect(tree.rootNode.hasError, name).toBe(false);
        expect(
          tree.rootNode
            .descendantsOfType('generic_type')
            .map((node) => [node.childForFieldName('type')?.type, node.childForFieldName('type')?.text])
        ).toEqual([
          ['identifier', name],
          ['identifier', name],
        ]);
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});

test('keeps contextual macro names as identifiers in type and expression positions', () => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const name of contextualNames) {
      const tree = parser.parse(`type Alias = ${name}!(); fn f() { ${name}!(); }`)!;
      try {
        expect(tree.rootNode.hasError, name).toBe(false);
        expect(
          tree.rootNode
            .descendantsOfType('macro_invocation')
            .map((node) => [node.childForFieldName('macro')?.type, node.childForFieldName('macro')?.text])
        ).toEqual([
          ['identifier', name],
          ['identifier', name],
        ]);
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});
