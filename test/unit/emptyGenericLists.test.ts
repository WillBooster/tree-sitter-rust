import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test.each([
  ['struct S<>;', 'type_parameters'],
  ['trait T<> {}', 'type_parameters'],
  ['enum E<> { V }', 'type_parameters'],
  ['impl<> S {}', 'type_parameters'],
  ['fn function<>() {}', 'type_parameters'],
  ['type Callback = for<> fn();', 'for_lifetimes'],
  ['fn main() { function::<>(); }', 'type_arguments'],
  ['fn main() { let _ = E::<>::V; }', 'type_arguments'],
  ['fn main() { let _: i32<>; }', 'type_arguments'],
])('parses an empty generic list in %s', async (source, kind) => {
  await Parser.init();
  const parser = new Parser();
  parser.setLanguage(await Language.load('tree-sitter-rust.wasm'));
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const lists = tree.rootNode.descendantsOfType(kind);
    expect(lists).toHaveLength(1);
    expect(lists[0]?.namedChildCount).toBe(0);
    expect(lists[0]?.text).toBe(kind === 'for_lifetimes' ? 'for<>' : '<>');
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(['struct S<,>;', 'type Callback = for<,> fn();', 'fn main() { function::<,>(); }'])(
  'rejects a comma without a generic element in %s',
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
