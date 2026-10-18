import { readFileSync } from 'node:fs';
import { Edit, Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test('attaches outer documentation to its declaration and rejects orphan documentation', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  const highlights = new Query(language, readFileSync('queries/highlights.scm', 'utf8'));
  try {
    for (const doc of ['/// documentation\n', '/** documentation */', '///\n', '/** */']) {
      for (const item of ['pub fn f() {}', 'struct S;', 'enum E { V }', 'mod inner {}', 'type T = u8;', 'm!{}']) {
        const source = `mod m { ${doc} /* bridge */ #[allow(unused)] ${item} }`;
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(false);
          const wrapper = tree.rootNode.descendantsOfType('attributed_declaration')[0];
          expect(wrapper?.childForFieldName('declaration')?.text, source).toBe(item);
          expect(wrapper?.namedChildren[0]?.text, source).toBe(doc);
          expect(
            highlights
              .captures(tree.rootNode)
              .filter(({ name }) => name === 'attribute')
              .map(({ node }) => node.text)
          ).toEqual(['#[allow(unused)]']);
          expect(
            highlights
              .captures(tree.rootNode)
              .filter(({ name }) => name === 'comment')
              .map(({ node }) => node.text)
          ).toContain(doc);
          expect(wrapper?.namedChildren[0]?.namedChildren[0]?.childForFieldName('outer')?.text).toBe(
            doc.startsWith('///') ? '/' : '*'
          );
        } finally {
          tree.delete();
        }
      }
      for (const source of [doc, `mod m { fn f() {} ${doc} }`, `fn f() { ${doc} }`, `struct S { ${doc} }`]) {
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(true);
        } finally {
          tree.delete();
        }
      }
    }
    for (const source of [
      '//// ordinary\n',
      '/**/',
      '/***/',
      '/****/',
      '/* nested /** text */ comment */',
      '//! inner\n',
      '/*! inner */',
      'mod m { //! inner\n }',
      'struct S { /// field\n field: u8 }',
      'enum E { /** variant */ V }',
      'm! { /// arbitrary\n }',
      'macro_rules! m { () => { /** arbitrary */ } }',
    ]) {
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
      } finally {
        tree.delete();
      }
    }
  } finally {
    highlights.delete();
    parser.delete();
  }
});

test('reclassifies ordinary and outer comments across incremental prefix edits', async () => {
  await Parser.init();
  const parser = new Parser().setLanguage(await Language.load('tree-sitter-rust.wasm'));
  let source = '//// docs\nfn f() {}';
  let tree = parser.parse(source)!;
  try {
    for (const slashCount of [3, 4, 3, 4]) {
      const oldCount = source.indexOf(' ');
      const next = `${'/'.repeat(slashCount)} docs\nfn f() {}`;
      tree.edit(
        new Edit({
          startIndex: 0,
          oldEndIndex: oldCount,
          newEndIndex: slashCount,
          startPosition: { row: 0, column: 0 },
          oldEndPosition: { row: 0, column: oldCount },
          newEndPosition: { row: 0, column: slashCount },
        })
      );
      const old = tree;
      tree = parser.parse(next, old)!;
      old.delete();
      const fresh = parser.parse(next)!;
      try {
        expect(tree.rootNode.hasError).toBe(false);
        expect(tree.rootNode.toString()).toBe(fresh.rootNode.toString());
        expect(tree.rootNode.descendantsOfType('attributed_declaration')).toHaveLength(slashCount === 3 ? 1 : 0);
        expect(tree.rootNode.descendantsOfType('function_item')[0]?.startPosition).toEqual({ row: 1, column: 0 });
      } finally {
        fresh.delete();
      }
      source = next;
    }
  } finally {
    tree.delete();
    parser.delete();
  }
});
