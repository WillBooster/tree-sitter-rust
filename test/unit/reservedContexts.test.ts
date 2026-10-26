import { Edit, Language, Parser, Query, type Tree } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

import { position, snapshot } from '../helpers/treeSnapshot.js';

await Parser.init();
const language = await Language.load('tree-sitter-rust.wasm');

const cases = [
  {
    name: 'imports',
    source:
      'use std::fmt::Debug as _; use std::fmt::{Display as _, Write as _}; extern crate core as _; extern crate self as current_crate;\nfn after() {}\n',
    query:
      '(use_as_clause alias: (identifier) @special) (extern_crate_declaration alias: (identifier) @special) (extern_crate_declaration name: (identifier) @special (#eq? @special "self"))',
    expected: ['_', '_', '_', '_', 'self', 'current_crate'],
  },
  {
    name: 'struct-pattern',
    source:
      'struct S { value:i32 } impl S { fn take(self)->i32 { let Self { value } = self; value } fn parameter(Self { value }: Self)->i32 { value } fn condition(self) { if let Self { value } = self { let _=value; } } }\nfn after() {}\n',
    query: '(struct_pattern type: (type_identifier) @special)',
    expected: ['Self', 'Self', 'Self'],
  },
  {
    name: 'tuple-pattern',
    source:
      'struct S(i32); impl S { fn take(self)->i32 { let Self(value) = self; value } fn parameter(Self(value): Self)->i32 { value } fn condition(self) { if let Self(value) = self { let _=value; } } }\nfn after() {}\n',
    query: '(tuple_struct_pattern type: (identifier) @special)',
    expected: ['Self', 'Self', 'Self'],
  },
  {
    name: 'unit-pattern',
    source:
      'struct S; impl S { fn take(self) { let Self = self; } fn matches(self)->bool { match self { Self => true } } fn parameter(Self: Self) {} }\nfn after() {}\n',
    query:
      '(let_declaration pattern: (identifier) @special) (match_pattern (identifier) @special) (parameter pattern: (identifier) @special)',
    expected: ['Self', 'Self', 'Self'],
  },
  {
    name: 'capture',
    source: 'trait T { fn f() -> impl Sized + use<Self>; }\nfn after() {}\n',
    query: '(use_bounds (type_identifier) @special)',
    expected: ['Self'],
  },
  {
    name: 'unsafe-attribute',
    source: '#[unsafe(no_mangle)] pub extern "C" fn foo() {}\nfn after() {}\n',
    query: '(attribute (identifier) @special)',
    expected: ['unsafe'],
  },
  {
    name: 'self-empty-struct-pattern',
    source: 'struct S { x:u8 } impl S { fn f(Self::<> {x}: Self)->u8 {x} }\nfn after() {}\n',
    query: '(generic_type type: (type_identifier) @special)',
    expected: ['Self'],
  },
  {
    name: 'self-empty-tuple-pattern',
    source: 'struct S(u8); impl S { fn f(Self::<>(x): Self)->u8 {x} }\nfn after() {}\n',
    query: '(generic_type type: (type_identifier) @special)',
    expected: ['Self'],
  },
  {
    name: 'self-empty-struct-expression',
    source: 'struct S { x:u8 } impl S { fn f()->Self { Self::<> { x:1 } } }\nfn after() {}\n',
    query: '(generic_type_with_turbofish type: (type_identifier) @special)',
    expected: ['Self'],
  },
  {
    name: 'self-empty-tuple-expression',
    source: 'struct S(u8); impl S { fn f()->Self { Self::<>(1) } }\nfn after() {}\n',
    query: '(generic_function function: (identifier) @special)',
    expected: ['Self'],
  },
  {
    name: 'self-empty-unit-expression',
    source: 'struct S; impl S { fn f()->Self { Self::<> } }\nfn after() {}\n',
    query: '(generic_function function: (identifier) @special)',
    expected: ['Self'],
  },
  {
    name: 'self-empty-type',
    source: 'struct S; impl S { fn f()->Self<> { Self } }\nfn after() {}\n',
    query: '(generic_type type: (type_identifier) @special)',
    expected: ['Self'],
  },
];

test.each(cases)(
  'preserves valid keyword context $name and edits its query range',
  ({ source: initial, query: pattern, expected }) => {
    const parser = new Parser().setLanguage(language);
    const query = new Query(language, pattern);
    const functions = new Query(language, '(function_item name: (identifier) @name)');
    let source = initial;
    let tree = parser.parse(source)!;
    try {
      checkTree(tree, expected);
      const target = query.captures(tree.rootNode)[0]!.node;
      const start = target.startIndex;
      const original = target.text;
      const replacement = original === '_' ? 'renamed' : original === 'unsafe' ? 'r#unsafe' : 'S';
      for (const [before, after] of [
        [original, replacement],
        [replacement, original],
      ] as const) {
        const nextSource = source.slice(0, start) + after + source.slice(start + before.length);
        tree.edit(
          new Edit({
            startIndex: start,
            oldEndIndex: start + before.length,
            newEndIndex: start + after.length,
            startPosition: position(source, start),
            oldEndPosition: position(source, start + before.length),
            newEndPosition: position(nextSource, start + after.length),
          })
        );
        const previous = tree;
        tree = parser.parse(nextSource, previous)!;
        previous.delete();
        source = nextSource;
        const fresh = parser.parse(source)!;
        try {
          checkTree(tree, [after, ...expected.slice(1)]);
          checkTree(fresh, [after, ...expected.slice(1)]);
          expect(snapshot(tree.rootNode)).toEqual(snapshot(fresh.rootNode));
        } finally {
          fresh.delete();
        }
      }
    } finally {
      tree.delete();
      functions.delete();
      query.delete();
      parser.delete();
    }

    function checkTree(current: Tree, texts: string[]): void {
      expect(current.rootNode.hasError, source).toBe(false);
      const captures = query.captures(current.rootNode);
      expect(captures.map(({ node }) => node.text)).toEqual(texts);
      for (const { node } of captures) {
        expect(source.slice(node.startIndex, node.endIndex)).toBe(node.text);
        expect(node.startPosition).toEqual(position(source, node.startIndex));
        expect(node.endPosition).toEqual(position(source, node.endIndex));
      }
      const after = functions.captures(current.rootNode).find(({ node }) => node.text === 'after')!.node;
      expect(after.startIndex).toBe(source.lastIndexOf('after'));
      expect(after.endIndex).toBe(after.startIndex + 5);
      expect(current.rootNode.descendantsOfType('range_pattern')).toHaveLength(0);
    }
  }
);

const invalidContexts = [
  'use std::fmt::Debug as self;\nfn after() {}\n',
  'extern crate core as Self;\nfn after() {}\n',
  'extern crate if as name;\nfn after() {}\n',
  'trait T { fn f() -> impl Sized + use<if>; }\nfn after() {}\n',
  '#[unsafe] pub fn f() {}\nfn after() {}\n',
  '#[unsafe {no_mangle}] pub fn f() {}\nfn after() {}\n',
  '#[unsafe = "no_mangle"] pub fn f() {}\nfn after() {}\n',
  '#[if] pub fn f() {}\nfn after() {}\n',
];

test('keeps keywords restricted outside their valid syntax contexts', () => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const source of invalidContexts) {
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(true);
        expect(tree.rootNode.descendantsOfType('function_item').at(-1)!.childForFieldName('name')!.text).toBe('after');
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});
