import { Edit, Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

import { position, snapshot } from '../helpers/treeSnapshot.js';

test('preserves trailing bounds as queryable types without consuming addition operators', async () => {
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
  const types = new Query(language, '(type_item type: (_type) @type)');
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(types.captures(tree.rootNode).map(({ node }) => [node.type, node.text])).toEqual([
      ['bounded_type', 'dyn Send + Sync +'],
    ]);
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
    types.delete();
    tree.delete();
    parser.delete();
  }
});

test('reclassifies trailing and continuing bounds across incremental edits', async () => {
  await Parser.init();
  const parser = new Parser().setLanguage(await Language.load('tree-sitter-rust.wasm'));
  let source = 'type Object = dyn Send;';
  let tree = parser.parse(source)!;
  try {
    for (const replacement of [' + /* bound */', ' + /* bound */ Sync', ' + /* bound */ Sync +', '']) {
      const start = source.indexOf('Send') + 'Send'.length;
      const oldEnd = source.indexOf(';');
      const next = source.slice(0, start) + replacement + source.slice(oldEnd);
      tree.edit(
        new Edit({
          startIndex: start,
          oldEndIndex: oldEnd,
          newEndIndex: start + replacement.length,
          startPosition: position(source, start),
          oldEndPosition: position(source, oldEnd),
          newEndPosition: position(next, start + replacement.length),
        })
      );
      const edited = parser.parse(next, tree)!;
      tree.delete();
      tree = edited;
      source = next;
      const fresh = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError).toBe(false);
        expect(snapshot(tree.rootNode)).toEqual(snapshot(fresh.rootNode));
      } finally {
        fresh.delete();
      }
    }
    expect(source).toBe('type Object = dyn Send;');
  } finally {
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
