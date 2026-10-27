import { readFileSync } from 'node:fs';

import { Edit, Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

import { position, snapshot } from '../helpers/treeSnapshot.js';

test('preserves default associated item fields and queries while editing their modifiers', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  const declarations = new Query(language, '(_declaration_statement) @item');
  const highlights = new Query(language, readFileSync('queries/highlights.scm', 'utf8'));
  let source = 'impl<Ty> T for Ty { #[a] default const X: u8 = 1; #[b] default type A = Vec<u8>; } fn following() {}';
  let tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const implementation = tree.rootNode.descendantsOfType('impl_item')[0]!;
    const body = implementation.childForFieldName('body')!;
    expect(body.namedChildren.map((node) => node.type)).toEqual(['attributed_declaration', 'attributed_declaration']);
    const items = body.namedChildren.map((node) => node.childForFieldName('declaration')!);
    expect(items.map((node) => [node.type, node.text, node.childForFieldName('name')?.text])).toEqual([
      ['const_item', 'default const X: u8 = 1;', 'X'],
      ['type_item', 'default type A = Vec<u8>;', 'A'],
    ]);
    expect(items.map((node) => node.childForFieldName('type')?.text)).toEqual(['u8', 'Vec<u8>']);
    expect(items[0]!.childForFieldName('value')?.text).toBe('1');
    expect(
      declarations
        .captures(tree.rootNode)
        .filter(({ node }) => node.startIndex > 0)
        .map(({ node }) => node.type)
    ).toEqual(['attributed_declaration', 'attributed_declaration', 'function_item']);
    expect(
      highlights.captures(tree.rootNode).filter(({ name, node }) => name === 'keyword' && node.text === 'default')
    ).toHaveLength(2);
    expect(tree.rootNode.descendantsOfType('function_item')[0]!.childForFieldName('name')?.text).toBe('following');

    const modifier = 'default ';
    while (source.includes(modifier)) {
      const start = source.indexOf(modifier);
      const end = start + modifier.length;
      const edited = source.slice(0, start) + source.slice(end);
      tree.edit(
        new Edit({
          startIndex: start,
          oldEndIndex: end,
          newEndIndex: start,
          startPosition: position(source, start),
          oldEndPosition: position(source, end),
          newEndPosition: position(source, start),
        })
      );
      const incremental = parser.parse(edited, tree)!;
      const fresh = parser.parse(edited)!;
      try {
        expect(incremental.rootNode.hasError).toBe(false);
        expect(snapshot(incremental.rootNode)).toEqual(snapshot(fresh.rootNode));
      } finally {
        fresh.delete();
      }
      tree.delete();
      tree = incremental;
      source = edited;
    }

    for (const invalid of ['default const X: u8 = 1;', 'default type A = u8;']) {
      const invalidTree = parser.parse(invalid)!;
      try {
        expect(invalidTree.rootNode.hasError).toBe(true);
      } finally {
        invalidTree.delete();
      }
    }
  } finally {
    tree.delete();
    highlights.delete();
    declarations.delete();
    parser.delete();
  }
});
