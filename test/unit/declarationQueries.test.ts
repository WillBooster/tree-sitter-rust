import { readFileSync } from 'node:fs';
import { Edit, Language, Parser, Query, type Node, type Tree } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test('captures concrete declarations through their public supertype', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  const source = 'const VALUE: i32 = 1; struct S; enum E { A } fn f() { let x = VALUE; x; } mod nested { fn g() {} }';
  const tree = parser.parse(source)!;
  const query = new Query(language, '(_declaration_statement) @declaration');
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(query.captures(tree.rootNode).map(({ node }) => [node.type, node.text])).toEqual([
      ['const_item', 'const VALUE: i32 = 1;'],
      ['struct_item', 'struct S;'],
      ['enum_item', 'enum E { A }'],
      ['function_item', 'fn f() { let x = VALUE; x; }'],
      ['let_declaration', 'let x = VALUE;'],
      ['mod_item', 'mod nested { fn g() {} }'],
      ['function_item', 'fn g() {}'],
    ]);
  } finally {
    query.delete();
    tree.delete();
    parser.delete();
  }
});

test('captures qualified extern declarations without accepting their qualifiers elsewhere', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  const query = new Query(language, '(_declaration_statement) @declaration');
  const items = [
    'fn ordinary();',
    'pub /* before */ safe /* after */ fn safe_function();',
    'static ORDINARY: i32;',
    'crate /* visibility */ safe fn legacy_function();',
    'crate safe static LEGACY_SAFE: i32;',
    'crate unsafe static LEGACY_UNSAFE: i32;',
    'pub(self) safe fn local();',
    'pub(super) safe fn parent();',
    'pub(in crate /* path */ :: r#outer) safe fn raw_path();',
    'pub(crate) safe static SAFE: i32;',
    'pub(in /* outer /* inner */ comment */ crate) unsafe static UNSAFE: i32;',
  ];
  const foreignSource = `unsafe extern "C" { ${items.join('\n')} }`;
  const source = `mod r#outer { ${foreignSource} }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(query.captures(tree.rootNode).map(({ node }) => node.text)).toEqual([source, foreignSource, ...items]);
    for (const invalid of ['safe fn f();', 'safe static X: i32;', 'unsafe static X: i32;']) {
      const invalidTree = parser.parse(invalid)!;
      try {
        expect(invalidTree.rootNode.hasError, invalid).toBe(true);
      } finally {
        invalidTree.delete();
      }
    }
  } finally {
    query.delete();
    tree.delete();
    parser.delete();
  }
});

test('preserves attributed struct pattern fields and turbofish through role edits', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  let tree: Tree | undefined;
  let query: Query | undefined;
  let highlights: Query | undefined;
  const source =
    'enum Record<T> { Item { key: T, value: T } } fn read(value: Record<i32>) { let Record::Item::<i32> { #[allow(unused)] key, value: result } = value; }';
  try {
    tree = parser.parse(source)!;
    expect(tree.rootNode.hasError).toBe(false);
    query = new Query(
      language,
      '(struct_pattern type: (generic_type) @type) (field_pattern (attribute_item) @attribute name: (shorthand_field_identifier) @name) (_pattern/struct_pattern) @pattern'
    );
    const captures = query.captures(tree.rootNode);
    expect(captures.filter(({ name }) => name === 'type').map(({ node }) => node.text)).toEqual([
      'Record::Item::<i32>',
    ]);
    expect(captures.filter(({ name }) => name === 'attribute').map(({ node }) => node.text)).toEqual([
      '#[allow(unused)]',
    ]);
    expect(captures.filter(({ name }) => name === 'name').map(({ node }) => node.text)).toEqual(['key']);
    expect(captures.filter(({ name }) => name === 'pattern')).toHaveLength(1);
    highlights = new Query(language, readFileSync(new URL('../../queries/highlights.scm', import.meta.url), 'utf8'));
    expect(
      highlights
        .captures(tree.rootNode.descendantsOfType('struct_pattern')[0]!)
        .filter(({ name }) => name === 'constructor')
        .map(({ node }) => node.text)
    ).toEqual(['Record', 'Item']);
    let current = source;
    for (const replacement of ['#[allow(unused)] /* field */', '', '#[allow(unused)]']) {
      const start = current.indexOf('{ ', current.indexOf('let Record')) + 2;
      const end = current.indexOf('key,', start);
      const next = current.slice(0, start) + (replacement ? replacement + ' ' : '') + current.slice(end);
      const newEnd = next.indexOf('key,', start);
      tree.edit(
        new Edit({
          startIndex: start,
          oldEndIndex: end,
          newEndIndex: newEnd,
          startPosition: { row: 0, column: start },
          oldEndPosition: { row: 0, column: end },
          newEndPosition: { row: 0, column: newEnd },
        })
      );
      const old: Tree = tree;
      tree = parser.parse(next, old)!;
      old.delete();
      const fresh = parser.parse(next)!;
      try {
        expect(tree.rootNode.hasError).toBe(false);
        expect(patternSnapshot(tree.rootNode)).toEqual(patternSnapshot(fresh.rootNode));
        expect(
          query.captures(tree.rootNode).map(({ name, node }) => [name, node.text, node.startIndex, node.endIndex])
        ).toEqual(
          query.captures(fresh.rootNode).map(({ name, node }) => [name, node.text, node.startIndex, node.endIndex])
        );
        expect(
          highlights.captures(tree.rootNode).map(({ name, node }) => [name, node.text, node.startIndex, node.endIndex])
        ).toEqual(
          highlights.captures(fresh.rootNode).map(({ name, node }) => [name, node.text, node.startIndex, node.endIndex])
        );
      } finally {
        fresh.delete();
      }
      current = next;
    }
  } finally {
    highlights?.delete();
    query?.delete();
    tree?.delete();
    parser.delete();
  }
});

function patternSnapshot(node: Node): unknown {
  return {
    type: node.type,
    named: node.isNamed,
    missing: node.isMissing,
    start: node.startIndex,
    end: node.endIndex,
    fields: node.children.map((_, index) => node.fieldNameForChild(index)),
    children: node.children.map(patternSnapshot),
  };
}
