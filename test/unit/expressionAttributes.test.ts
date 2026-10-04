import path from 'node:path';
import { Edit, Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-rust.wasm'));

test('retains attributed initializers and compiler expression binding', () => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, '(_expression/attributed_expression value: (_) @value) @expression');
  try {
    for (const [expression, value] of [
      ['1 + 2', '1'],
      ['x = 1', 'x'],
      ['|| 1 + 2', '|| 1 + 2'],
      ['move || 1 + 2', 'move || 1 + 2'],
      ['f().x', 'f().x'],
      ['-x + 1', '-x'],
      ['x as i32', 'x'],
      ['&x', '&x'],
      ['1..3', '1'],
      ['return 1 + 2', 'return 1 + 2'],
      ['(1)', '(1)'],
      ['{ 1 }', '{ 1 }'],
      ['if true { 1 } else { 2 }', 'if true { 1 } else { 2 }'],
      ['async { 1 }', 'async { 1 }'],
    ]) {
      const source = `fn f() { let value = #[allow(unused)] ${expression}; after(); }`;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        const values = query.captures(tree.rootNode).filter((capture) => capture.name === 'value');
        expect(
          values.map((capture) => capture.node.text),
          source
        ).toEqual([value]);
        expect(tree.rootNode.descendantsOfType('call_expression').at(-1)?.text).toBe('after()');
      } finally {
        tree.delete();
      }
    }
  } finally {
    query.delete();
    parser.delete();
  }
});

test('retains multiple attributes through prefix edits and unchanged declaration/list paths', () => {
  const parser = new Parser().setLanguage(language);
  try {
    const prefix = '#[allow(unused)] #[allow(dead_code)] ';
    for (const expression of ['1 + 2', 'move || 1', 'f().x', '(1)']) {
      const before = `fn f() { let value = ${expression}; }`;
      const offset = before.indexOf(expression);
      const after = before.slice(0, offset) + prefix + before.slice(offset);
      const tree = parser.parse(before)!;
      tree.edit(
        new Edit({
          startIndex: offset,
          oldEndIndex: offset,
          newEndIndex: offset + prefix.length,
          startPosition: { row: 0, column: offset },
          oldEndPosition: { row: 0, column: offset },
          newEndPosition: { row: 0, column: offset + prefix.length },
        })
      );
      const edited = parser.parse(after, tree)!;
      const fresh = parser.parse(after)!;
      try {
        expect(edited.rootNode.hasError, after).toBe(false);
        expect(edited.rootNode.toString()).toBe(fresh.rootNode.toString());
        expect(edited.rootNode.descendantsOfType('attribute_item').map((node) => node.text)).toEqual([
          '#[allow(unused)]',
          '#[allow(dead_code)]',
        ]);
        edited.edit(
          new Edit({
            startIndex: offset,
            oldEndIndex: offset + prefix.length,
            newEndIndex: offset,
            startPosition: { row: 0, column: offset },
            oldEndPosition: { row: 0, column: offset + prefix.length },
            newEndPosition: { row: 0, column: offset },
          })
        );
        const removed = parser.parse(before, edited)!;
        const original = parser.parse(before)!;
        try {
          expect(removed.rootNode.toString()).toBe(original.rootNode.toString());
        } finally {
          removed.delete();
          original.delete();
        }
      } finally {
        tree.delete();
        edited.delete();
        fresh.delete();
      }
    }
    for (const source of [
      '#[a] struct X { #[b] y: i32 }',
      'fn f(#[a] x: i32) {}',
      'fn f() { #[a] let x = 1; #[b] g(); }',
      'fn f() { let x = [#[a] 1, #[b] 2]; }',
      'fn f() { let x = (#[a] 1, 2); }',
      'fn f() { let x = (#[a] 1, #[b] 2, #[c] 3); }',
      'fn f() { g(#[a] 1); }',
    ]) {
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        expect(tree.rootNode.descendantsOfType('attributed_expression'), source).toHaveLength(0);
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});

test('retains attributes inside parentheses without converting them to tuples', () => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const expression of ['(#[a] 1)', '(#[a] x.y).z', '|| (#[a] 1)', '(#[a] (#[b] 1))']) {
      const source = `fn f() { let value = ${expression}; }`;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        expect(tree.rootNode.descendantsOfType('tuple_expression')).toHaveLength(0);
        expect(tree.rootNode.descendantsOfType('attribute_item').length).toBe(expression.includes('#[b]') ? 2 : 1);
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});

test('retains expression supertype captures for every list operand', () => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(
    language,
    '(arguments (_expression) @argument) (array_expression (_expression) @array) (tuple_expression (_expression) @tuple)'
  );
  const tree = parser.parse('fn f() { g(1, x); let a = [1, 2]; let b = [0; 3]; let c = (1, 2); }')!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const captures = query.captures(tree.rootNode);
    expect(captures.filter((c) => c.name === 'argument').map((c) => c.node.text)).toEqual(['1', 'x']);
    expect(captures.filter((c) => c.name === 'array').map((c) => c.node.text)).toEqual(['1', '2', '0', '3']);
    expect(captures.filter((c) => c.name === 'tuple').map((c) => c.node.text)).toEqual(['1', '2']);
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});
