import { readFile } from 'node:fs/promises';

import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test.each([
  ['type Values = Vec::<u8>;', 'Vec', '<u8>'],
  ['type Object = dyn Trait::<u8>;', 'Trait', '<u8>'],
  ['fn make() -> impl Trait::<u8> {}', 'Trait', '<u8>'],
  ['fn bounded<T: Trait::<u8>>() {}', 'Trait', '<u8>'],
  ['type Values = std::vec::Vec::<u8>;', 'std::vec::Vec', '<u8>'],
  ['fn take(value: Vec::<u8>) {}', 'Vec', '<u8>'],
  ['fn make() -> Vec::<u8> { Vec::new() }', 'Vec', '<u8>'],
  ['struct Container(Vec::<u8>);', 'Vec', '<u8>'],
  ['fn main() { let _: Vec::<u8>; }', 'Vec', '<u8>'],
  ['fn main() { let _ = value as Pointer::<u8>; }', 'Pointer', '<u8>'],
  ['fn check<T>() where Vec::<T>: Clone {}', 'Vec', '<T>'],
  ['impl<T> Trait::<T> for Container::<T> {}', 'Trait', '<T>'],
  ["type Value<T> = T::Item::<'static>;", 'T::Item', "<'static>"],
])('parses turbofish types and their public fields in %s', async (source, name, argumentsText) => {
  await Parser.init();
  const parser = new Parser();
  const language = await Language.load('tree-sitter-rust.wasm');
  parser.setLanguage(language);
  const tree = parser.parse(source)!;
  const query = new Query(language, '(generic_type type: (_) @type type_arguments: (type_arguments) @arguments)');
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const match = query.matches(tree.rootNode)[0]!;
    expect(match.captures.map(({ name: capture, node }) => [capture, node.text])).toEqual([
      ['type', name],
      ['arguments', argumentsText],
    ]);
  } finally {
    query.delete();
    tree.delete();
    parser.delete();
  }
});

test.each([
  ['type A = union::<u8>::Item;', 'type_identifier', 'union', 'type'],
  ['type B = std::vec::Vec::<u8>::Item;', 'scoped_identifier', 'Vec', 'constructor'],
])('preserves existing turbofish prefix nodes and highlights in %s', async (source, kind, name, captureName) => {
  await Parser.init();
  const parser = new Parser();
  const language = await Language.load('tree-sitter-rust.wasm');
  parser.setLanguage(language);
  const tree = parser.parse(source)!;
  const query = new Query(language, await readFile('queries/highlights.scm', 'utf8'));
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const type = tree.rootNode.descendantsOfType('generic_type')[0]?.childForFieldName('type');
    expect(type?.type).toBe(kind);
    expect(
      query
        .captures(tree.rootNode)
        .filter(({ node }) => node.text === name)
        .map(({ name: capture, node }) => [capture, node.type])
    ).toEqual([[captureName, kind === 'scoped_identifier' ? 'identifier' : 'type_identifier']]);
  } finally {
    query.delete();
    tree.delete();
    parser.delete();
  }
});
