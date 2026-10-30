import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test('preserves trailing bounds as types without consuming addition operators', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  const source = `type Object = dyn Send + Sync +;
fn use_types(value: u8, addend: u32) {
  let _: Box<dyn Send +> = Box::new(value) as Box<dyn Send +>;
  let _ = value as u32 + addend;
  let _ = value as u32 + { addend };
}`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(
      tree.rootNode
        .descendantsOfType('type_item')
        .map((node) => [node.childForFieldName('type')?.type, node.childForFieldName('type')?.text])
    ).toEqual([['bounded_type', 'dyn Send + Sync +']]);
    const cast = tree.rootNode.descendantsOfType('type_cast_expression')[0]!;
    expect(cast.childForFieldName('type')?.text).toBe('Box<dyn Send +>');
    expect(
      tree.rootNode
        .descendantsOfType('binary_expression')
        .map((node) => [
          node.childForFieldName('left')?.type,
          node.childForFieldName('operator')?.text,
          node.childForFieldName('right')?.text,
        ])
    ).toEqual([
      ['type_cast_expression', '+', 'addend'],
      ['type_cast_expression', '+', '{ addend }'],
    ]);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each([
  'type Object = dyn Send + ::core::marker::Sync;',
  'type Object = dyn Send + ::core::marker::Sync +;',
  'fn result() -> impl Send + ::core::marker::Sync { 1u8 }',
  'fn result() -> impl Send + ::core::marker::Sync + { 1u8 }',
  'type Object = dyn Send + /* path */ ::core::marker::Sync;',
  'fn result() -> impl Send +\n// path\n::core::marker::Sync + { 1u8 }',
])('keeps a global path after the preceding bound separator in %s', async (source) => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse(source)!;
  const query = new Query(language, '(bounded_type (scoped_type_identifier) @trait)');
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(query.captures(tree.rootNode).map(({ node }) => node.text)).toEqual(['::core::marker::Sync']);
  } finally {
    query.delete();
    tree.delete();
    parser.delete();
  }
});

test.each([
  'type Object = dyn Send ++;',
  'type Object = dyn Send + Sync ++;',
  'type Object = dyn Send + /* nested /* comment */ */ + Sync;',
  'type Object = dyn Send +\n// comment\n+ Sync;',
  'fn invalid() -> impl Send ++ { 1u8 }',
  'fn invalid<T: ?Sized ++>() {}',
  'fn invalid<T: ~const Copy ++>() {}',
  'type Object = dyn Send\u00A0+;',
  'type Object = dyn Send +\u00A0;',
  'trait Trait { type Assoc; } type Object = <dyn Trait<Assoc = u8> + as Trait>::Assoc;',
  'type Object = dyn Send + : :core::marker::Sync;',
  'type Object = dyn Send + : /* path */ :core::marker::Sync;',
])('rejects invalid bound separators in %s', async (source) => {
  await Parser.init();
  const parser = new Parser().setLanguage(await Language.load('tree-sitter-rust.wasm'));
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(true);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each([
  'fn bound<T: Send + Sync>() {}',
  'fn bound<T: Send + Sync +>() {}',
  'fn bound<T>() where T: Send + Sync {}',
  'fn bound<T>() where T: Send + Sync + {}',
  'trait Bound: Send + Sync {}',
  'trait Bound: Send + Sync + {}',
  'trait Bound = Send + Sync;',
  'trait Bound = Send + Sync +;',
])('preserves direct bound-list children in %s', async (source) => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const lists = tree.rootNode.descendantsOfType(['trait_bounds', 'trait_alias_bounds']);
    expect(lists).toHaveLength(1);
    expect(lists[0]!.namedChildren.map((node) => [node.type, node.text])).toEqual([
      ['type_identifier', 'Send'],
      ['type_identifier', 'Sync'],
    ]);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each([
  'type Object = dyn Send + /* nested /* comment */ */;',
  'type Object = dyn Send +\n// comment\n;',
  'type Object = dyn Send +\u200E\u2029;',
  "type Object = dyn Send + for<'a> Fn(&'a str) +;",
  'trait Trait { type Assoc; } type Object = <(dyn Trait<Assoc = u8> +) as Trait>::Assoc;',
  'fn bound() where dyn Send +: Send {}',
  'fn result<T>() -> impl Send + where T: Send { 1u8 }',
])('ends the type at its final separator in %s', async (source) => {
  await Parser.init();
  const parser = new Parser().setLanguage(await Language.load('tree-sitter-rust.wasm'));
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const bounds = tree.rootNode.descendantsOfType('bounded_type');
    const terminal = bounds.find((node) => node.children.at(-1)?.text === '+');
    expect(terminal).toBeDefined();
    const separator = terminal!.children.at(-1)!;
    expect(separator.isNamed).toBe(false);
    expect(separator.endIndex - separator.startIndex).toBe(1);
    expect(separator.text).toBe('+');
  } finally {
    tree.delete();
    parser.delete();
  }
});
