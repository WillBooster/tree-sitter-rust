import { Language, Parser, Query, type Tree } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

import { position } from '../helpers/position.js';

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

  {
    name: 'self-turbofish-return-type',
    source: 'struct S; impl S { fn f() -> Self::<> { Self } }\nfn after() {}\n',
    query: '(function_item return_type: (generic_type type: (type_identifier) @special))',
    expected: ['Self'],
    genericSuffix: '::<>',
  },
  {
    name: 'self-turbofish-parameter-type',
    source: 'struct S; impl S { fn f(_: Self::<>) {} }\nfn after() {}\n',
    query: '(parameter type: (generic_type type: (type_identifier) @special))',
    expected: ['Self'],
    genericSuffix: '::<>',
  },
  {
    name: 'self-turbofish-local-type',
    source: 'struct S; impl S { fn f() { let _: Self::<> = Self; } }\nfn after() {}\n',
    query: '(let_declaration type: (generic_type type: (type_identifier) @special))',
    expected: ['Self'],
    genericSuffix: '::<>',
  },
];

test.each(cases)('preserves valid keyword context $name', ({ source, query: pattern, expected, genericSuffix }) => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, pattern);
  const functions = new Query(language, '(function_item name: (identifier) @name)');
  const tree = parser.parse(source)!;
  try {
    checkTree(tree);
  } finally {
    tree.delete();
    functions.delete();
    query.delete();
    parser.delete();
  }

  function checkTree(current: Tree): void {
    expect(current.rootNode.hasError, source).toBe(false);
    const captures = query.captures(current.rootNode);
    expect(captures.map(({ node }) => node.text)).toEqual(expected);
    for (const { node } of captures) {
      expect(source.slice(node.startIndex, node.endIndex)).toBe(node.text);
      expect(node.startPosition).toEqual(position(source, node.startIndex));
      expect(node.endPosition).toEqual(position(source, node.endIndex));
      if (genericSuffix) {
        const type = node.parent!;
        expect(type.type).toBe('generic_type');
        expect(type.text).toBe(node.text + genericSuffix);
        expect(type.startIndex).toBe(node.startIndex);
        expect(type.endIndex).toBe(node.endIndex + genericSuffix.length);
        expect(type.childForFieldName('type_arguments')!.text).toBe('<>');
      }
    }
    const after = functions.captures(current.rootNode).find(({ node }) => node.text === 'after')!.node;
    expect(after.startIndex).toBe(source.lastIndexOf('after'));
    expect(after.endIndex).toBe(after.startIndex + 5);
    expect(current.rootNode.descendantsOfType('range_pattern')).toHaveLength(0);
  }
});

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
