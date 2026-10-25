import { readFileSync } from 'node:fs';

import { Edit, Language, Parser, Query, type Tree } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

import { position, snapshot } from '../helpers/treeSnapshot.js';

test.each([
  ['array', '[1, 2, ]', '];', 'array_expression', ']'],
  ['call', 'foo(1, 2, )', ')', 'call_expression', ')'],
  ['tuple', '(1, 2, )', ')', 'tuple_expression', ')'],
])(
  'retains ordinary %s initializers while their closing delimiter is typed',
  async (_, expression, removed, kind, closer) => {
    await Parser.init();
    const language = await Language.load('tree-sitter-rust.wasm');
    const parser = new Parser().setLanguage(language);
    const query = new Query(language, '(let_declaration pattern: (identifier) @binding value: (_) @value)');
    const highlights = new Query(
      language,
      readFileSync(new URL('../../queries/highlights.scm', import.meta.url), 'utf8')
    );
    let source = `fn f() {\n    let y = ${expression};\n    next();\n}\nfn h() {}`;
    let tree: Tree | undefined;
    try {
      tree = parser.parse(source)!;
      checkTree(tree, false);
      const close = source.indexOf(removed, source.indexOf('let y'));
      for (const [before, after, incomplete] of [
        [removed, '', true],
        ['', removed, false],
      ] as const) {
        const next = source.slice(0, close) + after + source.slice(close + before.length);
        tree.edit(
          new Edit({
            startIndex: close,
            oldEndIndex: close + before.length,
            newEndIndex: close + after.length,
            startPosition: position(source, close),
            oldEndPosition: position(source, close + before.length),
            newEndPosition: position(next, close + after.length),
          })
        );
        const previous: Tree = tree;
        tree = parser.parse(next, previous)!;
        previous.delete();
        source = next;
        const fresh = parser.parse(source)!;
        try {
          checkTree(tree, incomplete);
          checkTree(fresh, incomplete);
          expect(snapshot(tree.rootNode)).toEqual(snapshot(fresh.rootNode));
        } finally {
          fresh.delete();
        }
      }
    } finally {
      tree?.delete();
      highlights.delete();
      query.delete();
      parser.delete();
    }

    function checkTree(current: Tree, incomplete: boolean): void {
      expect(current.rootNode.hasError).toBe(incomplete);
      const captures = query.captures(current.rootNode);
      expect(captures.filter(({ name }) => name === 'binding').map(({ node }) => node.text)).toEqual(['y']);
      const values = captures.filter(({ name }) => name === 'value').map(({ node }) => node);
      expect(values).toHaveLength(1);
      const value = values[0]!;
      expect(value.type).toBe(kind);
      expect(value.startIndex).toBe(source.indexOf('= ') + 2);
      expect(value.endIndex).toBe(source.slice(0, source.indexOf(';', value.startIndex)).trimEnd().length);
      expect(value.descendantsOfType('integer_literal').map((node) => node.text)).toEqual(['1', '2']);
      expect(current.rootNode.descendantsOfType(closer).filter((node) => node.isMissing)).toHaveLength(
        incomplete ? 1 : 0
      );
      expect(
        current.rootNode.descendantsOfType('call_expression').map((node) => node.childForFieldName('function')!.text)
      ).toEqual(kind === 'call_expression' ? ['foo', 'next'] : ['next']);
      expect(
        current.rootNode.descendantsOfType('function_item').map((node) => node.childForFieldName('name')!.text)
      ).toEqual(['f', 'h']);
      expect(
        highlights
          .captures(current.rootNode)
          .filter(({ name }) => name === 'function')
          .map(({ node }) => node.text)
      ).toEqual(kind === 'call_expression' ? ['f', 'foo', 'next', 'h'] : ['f', 'next', 'h']);
    }
  }
);

test.each(['next()', 'foo.bar()'])(
  'retains ordinary struct names and fields while the closing brace before %s is typed',
  async (following) => {
    await Parser.init();
    const language = await Language.load('tree-sitter-rust.wasm');
    const parser = new Parser().setLanguage(language);
    const query = new Query(
      language,
      `
      (let_declaration pattern: (identifier) @binding value: (_) @value)
      (struct_expression name: (type_identifier) @type body: (field_initializer_list) @fields) @structure
    `
    );
    const highlights = new Query(
      language,
      readFileSync(new URL('../../queries/highlights.scm', import.meta.url), 'utf8')
    );
    let source = `fn f() {\n    let y = S { a: 1, b: 2, };\n    ${following};\n}\nfn h() {}`;
    let tree: Tree | undefined;
    try {
      tree = parser.parse(source)!;
      checkTree(tree, false);
      const close = source.indexOf('};');
      for (const [before, after, incomplete] of [
        ['};', '', true],
        ['', '};', false],
      ] as const) {
        const next = source.slice(0, close) + after + source.slice(close + before.length);
        tree.edit(
          new Edit({
            startIndex: close,
            oldEndIndex: close + before.length,
            newEndIndex: close + after.length,
            startPosition: position(source, close),
            oldEndPosition: position(source, close + before.length),
            newEndPosition: position(next, close + after.length),
          })
        );
        const previous: Tree = tree;
        tree = parser.parse(next, previous)!;
        previous.delete();
        source = next;
        const fresh = parser.parse(source)!;
        try {
          checkTree(tree, incomplete);
          checkTree(fresh, incomplete);
          expect(snapshot(tree.rootNode)).toEqual(snapshot(fresh.rootNode));
        } finally {
          fresh.delete();
        }
      }
    } finally {
      tree?.delete();
      highlights.delete();
      query.delete();
      parser.delete();
    }

    function checkTree(current: Tree, incomplete: boolean): void {
      expect(current.rootNode.hasError).toBe(incomplete);
      const captures = query.captures(current.rootNode);
      expect(captures.filter(({ name }) => name === 'binding').map(({ node }) => node.text)).toEqual(['y']);
      const types = captures.filter(({ name }) => name === 'type').map(({ node }) => node);
      expect(types.map((node) => node.text)).toEqual(['S']);
      const structures = captures.filter(({ name }) => name === 'structure').map(({ node }) => node);
      expect(structures).toHaveLength(1);
      const structure = structures[0]!;
      const value = captures.find(({ name }) => name === 'value')!.node;
      expect(structure.startIndex).toBe(source.indexOf('S {'));
      expect(types[0]!.startIndex).toBe(structure.startIndex);
      expect(types[0]!.endIndex).toBe(structure.startIndex + 1);
      const fields = captures.find(({ name }) => name === 'fields')!.node;
      expect(fields.startIndex).toBe(source.indexOf('{', structure.startIndex));
      expect(fields.endIndex).toBe(structure.endIndex);
      expect(structure.endIndex).toBeLessThanOrEqual(value.endIndex);
      expect(
        structure
          .descendantsOfType('field_initializer')
          .map((node) => [node.childForFieldName('field')!.text, node.childForFieldName('value')!.text])
      ).toEqual([
        ['a', '1'],
        ['b', '2'],
      ]);
      expect(current.rootNode.descendantsOfType('}').filter((node) => node.isMissing)).toHaveLength(incomplete ? 1 : 0);
      expect(
        current.rootNode.descendantsOfType('function_item').map((node) => node.childForFieldName('name')!.text)
      ).toEqual(['f', 'h']);
      const styles = highlights.captures(current.rootNode);
      expect(styles.filter(({ name, node }) => name === 'type' && node.text === 'S')).toHaveLength(1);
      expect(styles.filter(({ name, node }) => name === 'function' && node.text === 'S')).toHaveLength(0);
      expect(
        styles
          .filter(({ name, node }) => name === 'function' && ['f', 'h'].includes(node.text))
          .map(({ node }) => node.text)
      ).toEqual(['f', 'h']);
    }
  }
);
