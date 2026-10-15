import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load('tree-sitter-rust.wasm');

test.each([
  ["type Object = dyn Send + for<'a> Trait<'a>;", "<'a>", "Trait<'a>"],
  ["fn make() -> impl Send + for<'a> Trait<'a> { Value }", "<'a>", "Trait<'a>"],
  ["type Object = dyn Send + for<'a, 'b> Trait<'a, 'b> + Sync;", "<'a, 'b>", "Trait<'a, 'b>"],
  ["type Object = dyn Send + for<'a> module::Trait<'a>;", "<'a>", "module::Trait<'a>"],
])('exposes a higher-ranked bound after another trait: %s', (source, binder, trait) => {
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse(source)!;
  const query = new Query(
    language,
    '(higher_ranked_trait_bound type_parameters: (type_parameters) @binder type: (_) @trait)'
  );
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const bound = tree.rootNode.descendantsOfType('higher_ranked_trait_bound')[0]!;
    expect(bound.parent?.type).toBe('bounded_type');
    expect(query.captures(tree.rootNode).map(({ name, node }) => [name, node.text])).toEqual([
      ['binder', binder],
      ['trait', trait],
    ]);
  } finally {
    query.delete();
    tree.delete();
    parser.delete();
  }
});

test.each(['dyn Send', 'impl Send', 'Send'])('preserves the function binder after %s', (prefix) => {
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse(`type Object = ${prefix} + for<'a> Fn(&'a str) -> bool;`)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('higher_ranked_trait_bound')).toHaveLength(0);
    const functionType = tree.rootNode.descendantsOfType('function_type')[0]!;
    expect(functionType.namedChildren.map((node) => node.type)).toEqual([
      'for_lifetimes',
      'type_identifier',
      'parameters',
      'primitive_type',
    ]);
    expect(functionType.namedChildren[0]?.text).toBe("for<'a>");
  } finally {
    tree.delete();
    parser.delete();
  }
});

test('requires a complete higher-ranked bound', () => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const source of ["type Object = dyn Send + for<'a>;", "type Object = dyn Send + for<'a Trait<'a>;"]) {
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError).toBe(true);
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});
