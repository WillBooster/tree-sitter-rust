import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test.each([
  ["fn empty<'a:, T:>() where 'a:, T: {}", [':', ':', ':', ':']],
  ["trait Empty<'a:, T:>: { type Item:; fn call<U:>(); }", [':', ':', ':', ':', ':']],
  ['struct WithDefault<T: Copy += u8> { value: T }', [': Copy +']],
  [
    "fn trailing<'a: 'static +, T: Copy +>() where T: Copy +, 'a: 'static + {}",
    [": 'static +", ': Copy +', ': Copy +', ": 'static +"],
  ],
] as const)('parses optional and trailing bounds in %s', async (source, bounds) => {
  await Parser.init();
  const parser = new Parser();
  parser.setLanguage(await Language.load('tree-sitter-rust.wasm'));
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('trait_bounds').map((node) => node.text)).toEqual(bounds);
    if (source.startsWith('struct')) {
      expect(tree.rootNode.descendantsOfType('type_parameter')[0]?.childForFieldName('default_type')?.text).toBe('u8');
    }
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each([
  ['(): Copy', 'unit_type'],
  ['fn(): Copy', 'function_type'],
  ['dyn Marker: Marker', 'dynamic_type'],
  ["dyn Marker + 'static: Marker", 'bounded_type'],
  ['selected_type!(): Copy', 'macro_invocation'],
  ['!: Marker', 'never_type'],
])('preserves the type and bounds fields in where %s', async (predicate, type) => {
  await Parser.init();
  const parser = new Parser();
  parser.setLanguage(await Language.load('tree-sitter-rust.wasm'));
  const tree = parser.parse(`fn check() where ${predicate} {}`)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const node = tree.rootNode.descendantsOfType('where_predicate')[0]!;
    expect(node.childForFieldName('left')?.type).toBe(type);
    expect(node.childForFieldName('bounds')?.type).toBe('trait_bounds');
    expect(node.childForFieldName('bounds')?.namedChildren.map((bound) => bound.type)).toEqual(['type_identifier']);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(['fn invalid<T: +>() {}', 'fn invalid<T: Copy ++>() {}', 'fn invalid<T>() where T {}'])(
  'rejects incomplete bounds in %s',
  async (source) => {
    await Parser.init();
    const parser = new Parser();
    parser.setLanguage(await Language.load('tree-sitter-rust.wasm'));
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(true);
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);
