import { Edit, Language, Parser, Query, type Tree } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

import { position, snapshot } from '../helpers/treeSnapshot.js';

test('preserves struct rest assignees and functional update bases through incremental edits', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  const query = new Query(
    language,
    '(assignment_expression left: (struct_expression body: (field_initializer_list (remaining_field_pattern) @rest)))'
  );
  let source = `struct S { a: i32, b: i32 }
    fn assignment() {
      let mut a = 0;
      S { a, .. } = S { a: 1, b: 2 };
      S { a: a, .. } = S { a: 3, b: 4 };
      S { .. } = S { a: 5, b: 6 };
      S { a: _, .. } = S { a: 7, b: 8 };
      let _ = S { a: 9, ..S { a: 10, b: 11 } };
    }
    fn following() {}`;
  let tree: Tree | undefined;
  try {
    tree = parser.parse(source)!;
    checkTree(tree);
    for (const [before, after] of [
      ['S { a, .. } = S { a: 1, b: 2 };', 'let _ = S { a, ..S { a: 12, b: 13 } };'],
      ['let _ = S { a, ..S { a: 12, b: 13 } };', 'S { a, .. } = S { a: 1, b: 2 };'],
      ['a, ..', 'a, /* gap */ ..'],
      ['a, /* gap */ ..', 'a, ..'],
    ] as const) {
      const start = source.indexOf(before);
      const next = source.slice(0, start) + after + source.slice(start + before.length);
      tree.edit(
        new Edit({
          startIndex: start,
          oldEndIndex: start + before.length,
          newEndIndex: start + after.length,
          startPosition: position(source, start),
          oldEndPosition: position(source, start + before.length),
          newEndPosition: position(next, start + after.length),
        })
      );
      const previous: Tree = tree;
      tree = parser.parse(next, previous)!;
      previous.delete();
      source = next;
      const fresh = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError).toBe(false);
        expect(snapshot(tree.rootNode)).toEqual(snapshot(fresh.rootNode));
        if (!after.includes('12')) checkTree(tree);
        else {
          expect(query.captures(tree.rootNode)).toHaveLength(3);
          expect(tree.rootNode.descendantsOfType('base_field_initializer')).toHaveLength(2);
        }
      } finally {
        fresh.delete();
      }
    }
  } finally {
    tree?.delete();
    query.delete();
    parser.delete();
  }

  function checkTree(current: Tree): void {
    expect(current.rootNode.hasError).toBe(false);
    expect(query.captures(current.rootNode).map(({ node }) => node.text)).toEqual(['..', '..', '..', '..']);
    expect(current.rootNode.descendantsOfType('base_field_initializer').map((node) => node.text)).toEqual([
      '..S { a: 10, b: 11 }',
    ]);
    expect(
      current.rootNode.descendantsOfType('assignment_expression').map((node) => node.childForFieldName('left')!.text)
    ).toEqual([
      source.includes('/* gap */') ? 'S { a, /* gap */ .. }' : 'S { a, .. }',
      'S { a: a, .. }',
      'S { .. }',
      'S { a: _, .. }',
    ]);
    expect(
      current.rootNode.descendantsOfType('function_item').map((node) => node.childForFieldName('name')!.text)
    ).toEqual(['assignment', 'following']);
  }
});

test.each(['S { a, .., }', 'S { .., a }', 'S { a .. }'])(
  'rejects a misplaced struct rest marker in %s',
  async (assignee) => {
    await Parser.init();
    const parser = new Parser().setLanguage(await Language.load('tree-sitter-rust.wasm'));
    const tree = parser.parse(`fn assignment() { ${assignee} = value; } fn following() {}`)!;
    try {
      expect(tree.rootNode.hasError).toBe(true);
      expect(tree.rootNode.descendantsOfType('function_item').at(-1)!.childForFieldName('name')!.text).toBe(
        'following'
      );
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);

test.each([
  ['(S { a, .. }, _)', 'tuple_expression', 1],
  ['(first, S { a, .. }, last)', 'tuple_expression', 1],
  ['[S { a, .. }]', 'array_expression', 1],
  ['[first, S { a, .. }, last]', 'array_expression', 1],
  ['(S { a, .. })', 'parenthesized_expression', 1],
  ['Pair(S { a, .. })', 'call_expression', 1],
  ['Triple(first, S { a, .. }, last)', 'call_expression', 1],
  ['Outer { inner: S { a, .. }, .. }', 'struct_expression', 2],
  ['Outer { before: first, inner: S { a, .. }, after: last }', 'struct_expression', 1],
])('preserves nested rest assignees in %s', async (assignee, kind, rests) => {
  await Parser.init();
  const parser = new Parser().setLanguage(await Language.load('tree-sitter-rust.wasm'));
  const tree = parser.parse(`fn assignment() { ${assignee} = value; }`)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('assignment_expression')[0]!.childForFieldName('left')!.type).toBe(kind);
    expect(tree.rootNode.descendantsOfType('remaining_field_pattern')).toHaveLength(rests);
    expect(tree.rootNode.descendantsOfType('base_field_initializer')).toHaveLength(0);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each([
  'let _ = S { .. };',
  'let _ = S { a, .. };',
  'let _ = [S { .. }];',
  'let _ = (S { .. },);',
  'consume(S { .. });',
  'S { a, .. } += value;',
])('rejects bare struct rest outside an assignee in %s', async (statement) => {
  await Parser.init();
  const parser = new Parser().setLanguage(await Language.load('tree-sitter-rust.wasm'));
  const tree = parser.parse(`fn assignment() { ${statement} }`)!;
  try {
    expect(tree.rootNode.hasError).toBe(true);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test('retains tuple assignee boundaries while extra trailing commas are inserted and undone', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, '(assignment_expression left: (_) @left)');
  let source = `struct S { a: i32 }
    fn assignment() {
      let mut a = 0;
      (a,) = (1,);
      (a) = 1;
      () = ();
      (S { a, .. },) = (S { a: 2 },);
      ((S { a, .. },),) = ((S { a: 3 },),);
      (a, S { a, .. }) = (4, S { a: 5 });
    }
    fn following() {}`;
  const assignees = [
    ['tuple_expression', '(a,)'],
    ['parenthesized_expression', '(a)'],
    ['unit_expression', '()'],
    ['tuple_expression', '(S { a, .. },)'],
    ['tuple_expression', '((S { a, .. },),)'],
    ['tuple_expression', '(a, S { a, .. })'],
  ];
  let tree: Tree | undefined;
  try {
    tree = parser.parse(source)!;
    checkValidTree(tree);
    for (const [before, after, invalid] of [
      ['(a,)', '(a,,)', true],
      ['(a,,)', '(a,)', false],
      ['(S { a, .. },)', '(S { a, .. },,)', true],
      ['(S { a, .. },,)', '(S { a, .. },)', false],
      ['(a, S { a, .. })', '(a, S { a, .. },,)', true],
      ['(a, S { a, .. },,)', '(a, S { a, .. })', false],
    ] as const) {
      const start = source.indexOf(before);
      const next = source.slice(0, start) + after + source.slice(start + before.length);
      tree.edit(
        new Edit({
          startIndex: start,
          oldEndIndex: start + before.length,
          newEndIndex: start + after.length,
          startPosition: position(source, start),
          oldEndPosition: position(source, start + before.length),
          newEndPosition: position(next, start + after.length),
        })
      );
      const previous: Tree = tree;
      tree = parser.parse(next, previous)!;
      previous.delete();
      source = next;
      const fresh = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError).toBe(invalid);
        expect(snapshot(tree.rootNode)).toEqual(snapshot(fresh.rootNode));
        expect(tree.rootNode.descendantsOfType('function_item').at(-1)!.childForFieldName('name')!.text).toBe(
          'following'
        );
        if (!invalid) checkValidTree(tree);
      } finally {
        fresh.delete();
      }
    }
  } finally {
    tree?.delete();
    query.delete();
    parser.delete();
  }

  function checkValidTree(current: Tree): void {
    expect(current.rootNode.hasError).toBe(false);
    expect(query.captures(current.rootNode).map(({ node }) => [node.type, node.text])).toEqual(assignees);
    expect(current.rootNode.descendantsOfType('remaining_field_pattern')).toHaveLength(3);
  }
});
