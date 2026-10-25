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
