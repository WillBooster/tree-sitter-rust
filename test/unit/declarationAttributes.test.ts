import { readFileSync } from 'node:fs';
import { Edit, Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test('associates outer attributes with declarations and rejects orphan attributes', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  const query = new Query(language, '(attributed_declaration (attribute_item) @attribute declaration: (_) @item)');
  const tags = new Query(language, readFileSync('queries/tags.scm', 'utf8'));
  try {
    for (const item of [
      'pub fn f() {}',
      'struct S;',
      'enum E { V }',
      'mod m {}',
      'use std::fmt;',
      'const VALUE: u8 = 1;',
      'static VALUE: u8 = 1;',
      'type Alias = u8;',
      'trait T {}',
      'impl S {}',
      'extern "C" { fn f(); }',
      'macro_rules! m { () => {} }',
      'let value = 1;',
    ]) {
      const source = `fn outer() { #[allow(unused)] /* bridge */ #[cfg(all())] ${item} }`;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        const wrapper = tree.rootNode.descendantsOfType('attributed_declaration')[0];
        expect(wrapper?.childForFieldName('declaration')?.text, source).toBe(item);
        expect(
          query
            .captures(tree.rootNode)
            .filter(({ name }) => name === 'attribute')
            .map(({ node }) => node.text)
        ).toEqual(['#[allow(unused)]', '#[cfg(all())]']);
        if (item === 'pub fn f() {}') {
          expect(
            tags
              .captures(tree.rootNode)
              .filter(({ name }) => name === 'name')
              .map(({ node }) => node.text)
          ).toContain('f');
        }
      } finally {
        tree.delete();
      }
    }
    const macroTree = parser.parse('mod m { #[a] #[b] m!{} }')!;
    try {
      expect(macroTree.rootNode.hasError).toBe(false);
      expect(
        macroTree.rootNode.descendantsOfType('attributed_declaration')[0]?.childForFieldName('declaration')?.text
      ).toBe('m!{}');
    } finally {
      macroTree.delete();
    }
    const methodTree = parser.parse('impl S { #[inline] fn f() {} }')!;
    try {
      expect(
        tags
          .captures(methodTree.rootNode)
          .filter(({ name }) => name === 'definition.method')
          .map(({ node }) => node.text)
      ).toEqual(['fn f() {}']);
    } finally {
      methodTree.delete();
    }
    const statements = parser.parse('fn f() { #[a] let x = 1; #[b] g(); }')!;
    try {
      expect(statements.rootNode.hasError).toBe(false);
      expect(
        statements.rootNode.descendantsOfType('attributed_declaration')[0]?.childForFieldName('declaration')?.text
      ).toBe('let x = 1;');
      expect(statements.rootNode.descendantsOfType('attributed_expression')[0]?.childForFieldName('value')?.text).toBe(
        'g()'
      );
    } finally {
      statements.delete();
    }
    for (const source of ['#[cfg(all())]', 'mod m { #[cfg(all())] }', 'fn f() { #[cfg(all())] }']) {
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(true);
      } finally {
        tree.delete();
      }
    }
  } finally {
    query.delete();
    tags.delete();
    parser.delete();
  }
});

test('reassigns attributes when declarations are inserted and removed incrementally', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  const prefix = 'mod m { #[allow(unused)] ';
  let source = `${prefix}fn second() {} }`;
  let tree = parser.parse(source)!;
  try {
    for (const insertion of ['fn first() {} ', '']) {
      const next = `${prefix}${insertion}fn second() {} }`;
      const oldEnd = source.indexOf('fn second()');
      tree.edit(
        new Edit({
          startIndex: prefix.length,
          oldEndIndex: oldEnd,
          newEndIndex: prefix.length + insertion.length,
          startPosition: { row: 0, column: prefix.length },
          oldEndPosition: { row: 0, column: oldEnd },
          newEndPosition: { row: 0, column: prefix.length + insertion.length },
        })
      );
      const old = tree;
      tree = parser.parse(next, old)!;
      old.delete();
      const fresh = parser.parse(next)!;
      try {
        expect(tree.rootNode.hasError).toBe(false);
        expect(tree.rootNode.toString()).toEqual(fresh.rootNode.toString());
        expect(
          tree.rootNode.descendantsOfType('attributed_declaration')[0]?.childForFieldName('declaration')?.text
        ).toBe(insertion ? 'fn first() {}' : 'fn second() {}');
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

test('ends attributed block statements before the following statement without a semicolon', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, '(_expression/attributed_expression) @expression');
  try {
    for (const expression of [
      '{ first(); }',
      'if true { first(); }',
      'unsafe { first(); }',
      'loop { break; }',
      'match x { _ => () }',
    ]) {
      const source = `fn f() { #[allow(unused)] #[cfg(all())] ${expression} after(); }`;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        const statements = tree.rootNode
          .descendantsOfType('function_item')[0]!
          .childForFieldName('body')!.namedChildren;
        expect(
          statements.map((node) => node.text),
          source
        ).toEqual([`#[allow(unused)] #[cfg(all())] ${expression}`, 'after();']);
        expect(statements[0]?.namedChildren[0]?.childForFieldName('value')?.text).toBe(expression);
        expect(query.captures(tree.rootNode).map(({ node }) => node.text)).toEqual([
          `#[allow(unused)] #[cfg(all())] ${expression}`,
        ]);
      } finally {
        tree.delete();
      }
    }
    const invalid = parser.parse('fn f() { #[allow(unused)] first() after(); }')!;
    try {
      expect(invalid.rootNode.hasError).toBe(true);
    } finally {
      invalid.delete();
    }
  } finally {
    query.delete();
    parser.delete();
  }
});
