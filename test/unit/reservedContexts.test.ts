import { Language, type Node, Parser, type Tree } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

import { directChildren, fieldNodes, sortNodes } from '../helpers/ast.js';
import { position } from '../helpers/position.js';

await Parser.init();
const language = await Language.load('tree-sitter-rust.wasm');

interface ContextCase {
  name: string;
  source: string;
  select: (root: Node) => Node[];
  expected: string[];
  genericSuffix?: string;
}

const cases: ContextCase[] = [
  {
    name: 'imports',
    source:
      'use std::fmt::Debug as _; use std::fmt::{Display as _, Write as _}; extern crate core as _; extern crate self as current_crate;\nfn after() {}\n',
    select: (root) =>
      sortNodes([
        ...fieldNodes(root, ['use_as_clause', 'extern_crate_declaration'], 'alias', 'identifier'),
        ...fieldNodes(root, 'extern_crate_declaration', 'name', 'identifier').filter((node) => node.text === 'self'),
      ]),
    expected: ['_', '_', '_', '_', 'self', 'current_crate'],
  },
  {
    name: 'struct-pattern',
    source:
      'struct S { value:i32 } impl S { fn take(self)->i32 { let Self { value } = self; value } fn parameter(Self { value }: Self)->i32 { value } fn condition(self) { if let Self { value } = self { let _=value; } } }\nfn after() {}\n',
    select: (root) => fieldNodes(root, 'struct_pattern', 'type', 'type_identifier'),
    expected: ['Self', 'Self', 'Self'],
  },
  {
    name: 'tuple-pattern',
    source:
      'struct S(i32); impl S { fn take(self)->i32 { let Self(value) = self; value } fn parameter(Self(value): Self)->i32 { value } fn condition(self) { if let Self(value) = self { let _=value; } } }\nfn after() {}\n',
    select: (root) => fieldNodes(root, 'tuple_struct_pattern', 'type', 'identifier'),
    expected: ['Self', 'Self', 'Self'],
  },
  {
    name: 'unit-pattern',
    source:
      'struct S; impl S { fn take(self) { let Self = self; } fn matches(self)->bool { match self { Self => true } } fn parameter(Self: Self) {} }\nfn after() {}\n',
    select: (root) =>
      sortNodes([
        ...fieldNodes(root, ['let_declaration', 'parameter'], 'pattern', 'identifier'),
        ...directChildren(root, 'match_pattern', 'identifier'),
      ]),
    expected: ['Self', 'Self', 'Self'],
  },
  {
    name: 'capture',
    source: 'trait T { fn f() -> impl Sized + use<Self>; }\nfn after() {}\n',
    select: (root) => directChildren(root, 'use_bounds', 'type_identifier'),
    expected: ['Self'],
  },
  {
    name: 'unsafe-attribute',
    source: '#[unsafe(no_mangle)] pub extern "C" fn foo() {}\nfn after() {}\n',
    select: (root) => directChildren(root, 'attribute', 'identifier'),
    expected: ['unsafe'],
  },
  {
    name: 'self-empty-struct-pattern',
    source: 'struct S { x:u8 } impl S { fn f(Self::<> {x}: Self)->u8 {x} }\nfn after() {}\n',
    select: (root) => fieldNodes(root, 'generic_type', 'type', 'type_identifier'),
    expected: ['Self'],
  },
  {
    name: 'self-empty-tuple-pattern',
    source: 'struct S(u8); impl S { fn f(Self::<>(x): Self)->u8 {x} }\nfn after() {}\n',
    select: (root) => fieldNodes(root, 'generic_type', 'type', 'type_identifier'),
    expected: ['Self'],
  },
  {
    name: 'self-empty-struct-expression',
    source: 'struct S { x:u8 } impl S { fn f()->Self { Self::<> { x:1 } } }\nfn after() {}\n',
    select: (root) => fieldNodes(root, 'generic_type_with_turbofish', 'type', 'type_identifier'),
    expected: ['Self'],
  },
  {
    name: 'self-empty-tuple-expression',
    source: 'struct S(u8); impl S { fn f()->Self { Self::<>(1) } }\nfn after() {}\n',
    select: (root) => fieldNodes(root, 'generic_function', 'function', 'identifier'),
    expected: ['Self'],
  },
  {
    name: 'self-empty-unit-expression',
    source: 'struct S; impl S { fn f()->Self { Self::<> } }\nfn after() {}\n',
    select: (root) => fieldNodes(root, 'generic_function', 'function', 'identifier'),
    expected: ['Self'],
  },
  {
    name: 'self-empty-type',
    source: 'struct S; impl S { fn f()->Self<> { Self } }\nfn after() {}\n',
    select: (root) => fieldNodes(root, 'generic_type', 'type', 'type_identifier'),
    expected: ['Self'],
  },
  {
    name: 'self-turbofish-return-type',
    source: 'struct S; impl S { fn f() -> Self::<> { Self } }\nfn after() {}\n',
    select: (root) => genericTypeFieldNames(root, 'function_item', 'return_type'),
    expected: ['Self'],
    genericSuffix: '::<>',
  },
  {
    name: 'self-turbofish-parameter-type',
    source: 'struct S; impl S { fn f(_: Self::<>) {} }\nfn after() {}\n',
    select: (root) => genericTypeFieldNames(root, 'parameter', 'type'),
    expected: ['Self'],
    genericSuffix: '::<>',
  },
  {
    name: 'self-turbofish-local-type',
    source: 'struct S; impl S { fn f() { let _: Self::<> = Self; } }\nfn after() {}\n',
    select: (root) => genericTypeFieldNames(root, 'let_declaration', 'type'),
    expected: ['Self'],
    genericSuffix: '::<>',
  },
];

test.each(cases)(
  'preserves valid keyword context $name and its replacement',
  ({ source: initial, select, expected, genericSuffix }) => {
    const parser = new Parser().setLanguage(language);
    const tree = parser.parse(initial)!;
    try {
      checkTree(tree, initial, expected);
      const target = select(tree.rootNode)[0]!;
      const replacement = target.text === '_' ? 'renamed' : target.text === 'unsafe' ? 'r#unsafe' : 'S';
      const source = initial.slice(0, target.startIndex) + replacement + initial.slice(target.endIndex);
      const replaced = parser.parse(source)!;
      try {
        checkTree(replaced, source, [replacement, ...expected.slice(1)]);
      } finally {
        replaced.delete();
      }
    } finally {
      tree.delete();
      parser.delete();
    }

    function checkTree(current: Tree, source: string, texts: string[]): void {
      expect(current.rootNode.hasError, source).toBe(false);
      const captures = select(current.rootNode);
      expect(captures.map((node) => node.text)).toEqual(texts);
      for (const node of captures) {
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
      const after = fieldNodes(current.rootNode, 'function_item', 'name', 'identifier').find(
        (node) => node.text === 'after'
      )!;
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

function genericTypeFieldNames(root: Node, parentType: string, fieldName: string): Node[] {
  return fieldNodes(root, parentType, fieldName, 'generic_type').flatMap((genericType) =>
    genericType.childrenForFieldName('type').filter((node) => node.type === 'type_identifier')
  );
}
