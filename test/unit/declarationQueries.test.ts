import { readFileSync } from 'node:fs';

import { Language, Parser, Query, type Tree } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

import { position } from '../helpers/position.js';

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
  ].flatMap((item) => [item, `#[allow(unused)] /* bridge */ #[cfg(all())] ${item}`]);
  const foreignSource = `unsafe extern "C" { ${items.join('\n')} }`;
  const source = `mod r#outer { ${foreignSource} }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(query.captures(tree.rootNode).map(({ node }) => node.text)).toEqual([source, foreignSource, ...items]);
    for (const invalid of ['safe fn f();', 'safe static X: i32;', 'unsafe static X: i32;'].flatMap((item) => [
      item,
      `#[a] #[b] ${item}`,
    ])) {
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

test('captures attributed struct pattern fields and turbofish', async () => {
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
  } finally {
    highlights?.delete();
    query?.delete();
    tree?.delete();
    parser.delete();
  }
});

test('keeps anonymous free constants and named associated constant fields queryable', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  const source = `const _: u8 = 1;
mod nested { const _: u8 = 2; }
struct S;
impl S {
  #[allow(unused)] pub const VALUE: u8 = { const _: u8 = 3; 4 };
  fn method() { const _: u8 = 5; }
}
trait T {
  const REQUIRED: u8;
  const r#type: u8 = { const _: u8 = 6; 7 };
  fn method() { const _: u8 = 8; }
}
fn following() {}
`;
  const tree = parser.parse(source)!;
  const query = new Query(language, '(const_item name: (identifier) @name type: (_) @type)');
  const declarations = new Query(
    language,
    '(_declaration_statement/const_item name: (identifier) @name) (_declaration_statement/attributed_declaration) @attributed'
  );
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const captures = query.captures(tree.rootNode);
    const names = captures.filter(({ name }) => name === 'name');
    const declarationCaptures = declarations.captures(tree.rootNode);
    expect(declarationCaptures.filter(({ name }) => name === 'name').map(({ node }) => node.text)).toEqual([
      '_',
      '_',
      '_',
      '_',
      'REQUIRED',
      'r#type',
      '_',
      '_',
    ]);
    expect(declarationCaptures.filter(({ name }) => name === 'attributed').map(({ node }) => node.text)).toEqual([
      '#[allow(unused)] pub const VALUE: u8 = { const _: u8 = 3; 4 };',
    ]);
    expect(names.map(({ node }) => node.text)).toEqual(['_', '_', 'VALUE', '_', '_', 'REQUIRED', 'r#type', '_', '_']);
    const expected = [...source.matchAll(/\bconst ([A-Za-z_][A-Za-z_0-9#]*):/g)].map((match) => {
      const start = match.index + 'const '.length;
      return [
        match[1],
        start,
        start + match[1]!.length,
        position(source, start),
        position(source, start + match[1]!.length),
      ];
    });
    expect(
      names.map(({ node }) => [node.text, node.startIndex, node.endIndex, node.startPosition, node.endPosition])
    ).toEqual(expected);
    expect(captures.filter(({ name }) => name === 'type').map(({ node }) => node.text)).toEqual(
      Array.from({ length: 9 }, () => 'u8')
    );
    const associated = tree.rootNode
      .descendantsOfType('const_item')
      .find((node) => node.childForFieldName('name')?.text === 'VALUE')!;
    expect(associated.childForFieldName('value')?.text).toBe('{ const _: u8 = 3; 4 }');
    const lists = tree.rootNode
      .descendantsOfType(['impl_item', 'trait_item'])
      .map((node) => node.childForFieldName('body'));
    expect(lists.map((node) => node?.type)).toEqual(['declaration_list', 'declaration_list']);
  } finally {
    query.delete();
    declarations.delete();
    tree.delete();
    parser.delete();
  }
});

const associatedConstantSources = [
  'struct S; impl S { const VALUE: u8 = 1; fn retained() {} }',
  'struct S; impl S { pub const VALUE: u8 = 1; fn retained() {} }',
  'struct S; impl S { #[allow(unused)] const VALUE: u8 = 1; fn retained() {} }',
  'trait T { const VALUE: u8; fn retained() {} }',
  'trait T { const VALUE: u8 = 1; fn retained() {} }',
  'trait T { #[allow(unused)] const VALUE: u8; fn retained() {} }',
  'trait T { const VALUE: u8; fn retained() {} } struct S; impl T for S { const VALUE: u8 = 1; fn retained() {} }',
];

test.each(associatedConstantSources)(
  'captures the associated constant and neighboring declarations in %s',
  async (declaration) => {
    await Parser.init();
    const language = await Language.load('tree-sitter-rust.wasm');
    const parser = new Parser().setLanguage(language);
    const query = new Query(
      language,
      '(const_item name: (identifier) @constant) (function_item name: (identifier) @function)'
    );
    const source = declaration + '\nfn following() {}\n';
    const start = source.lastIndexOf('VALUE');
    const tree = parser.parse(source)!;
    try {
      checkTree(tree);
    } finally {
      tree.delete();
      query.delete();
      parser.delete();
    }

    function checkTree(current: Tree): void {
      expect(current.rootNode.hasError, source).toBe(false);
      const functions = query.captures(current.rootNode).filter(({ name: captureName }) => captureName === 'function');
      for (const expected of ['retained', 'following']) {
        const nameStart = source.lastIndexOf(expected);
        expect(
          functions.some(
            ({ node }) =>
              node.text === expected && node.startIndex === nameStart && node.endIndex === nameStart + expected.length
          )
        ).toBe(true);
      }
      expect(
        query
          .captures(current.rootNode)
          .some(
            ({ name: captureName, node }) =>
              captureName === 'constant' && node.text === 'VALUE' && node.startIndex === start
          )
      ).toBe(true);
    }
  }
);
