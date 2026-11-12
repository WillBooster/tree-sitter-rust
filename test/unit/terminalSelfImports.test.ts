import { Language, Parser, type Tree } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

import { directChildren, fieldNodes, sortNodes } from '../helpers/ast.js';
import { position } from '../helpers/position.js';

await Parser.init();
const language = await Language.load('tree-sitter-rust.wasm');
const cases = [
  { declaration: 'use std::io::self;', kind: 'identifier' },
  { declaration: 'use std::io::self as io2;', kind: 'identifier' },
  { declaration: 'use std::io::{self};', kind: 'self' },
  { declaration: 'use std::io::{self as io2};', kind: 'self' },
  { declaration: 'mod foo {} use foo::self as bar;', kind: 'identifier' },
  { declaration: 'mod foo {} use foo::{self as bar};', kind: 'self' },
];

test.each(cases)(
  'retains the import target in $declaration with and without a raw path prefix',
  ({ declaration, kind }) => {
    const parser = new Parser().setLanguage(language);
    const initial = `${declaration}\nfn after() {}`;
    const pathStart = initial.includes('std') ? initial.indexOf('std') : initial.lastIndexOf('foo');
    try {
      for (const source of [initial, `${initial.slice(0, pathStart)}r#${initial.slice(pathStart)}`]) {
        const tree = parser.parse(source)!;
        try {
          checkTree(tree, source);
        } finally {
          tree.delete();
        }
      }
    } finally {
      parser.delete();
    }

    function checkTree(current: Tree, source: string): void {
      expect(current.rootNode.hasError, source).toBe(false);
      const captures = sortNodes([
        ...fieldNodes(current.rootNode, 'scoped_identifier', 'name', 'identifier').filter(
          (node) => node.text === 'self'
        ),
        ...directChildren(current.rootNode, 'use_list', 'self'),
        ...fieldNodes(current.rootNode, 'use_as_clause', 'path', 'self'),
      ]);
      expect(captures).toHaveLength(1);
      const target = captures[0]!;
      expect(target.type).toBe(kind);
      expect(target.text).toBe('self');
      expect(target.startIndex).toBe(source.indexOf('self'));
      expect(target.endIndex).toBe(target.startIndex + 4);
      expect(target.startPosition).toEqual(position(source, target.startIndex));
      expect(target.endPosition).toEqual(position(source, target.endIndex));
      const following = current.rootNode.descendantsOfType('function_item').at(-1)!;
      expect(following.childForFieldName('name')!.text).toBe('after');
      expect(following.startIndex).toBe(source.indexOf('fn after'));
    }
  }
);

test('does not admit keyword declaration names or other keyword path terminals', () => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const source of [
      'fn self() {}',
      'struct self;',
      'use std::io::if;',
      'use std::io::Self;',
      'use std::io::self as self;',
      'use std::io::self as while;',
    ]) {
      const tree = parser.parse(`${source}\nfn after() {}`)!;
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
