import { Language, Parser, Query, type Tree } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

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

test.each(cases)('retains the import target in $declaration', ({ declaration, kind }) => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(
    language,
    `
    (scoped_identifier name: (identifier) @target (#eq? @target "self"))
    (use_list (self) @target)
    (use_as_clause path: (self) @target)
  `
  );
  const source = `${declaration}\nfn after() {}`;
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
    const captures = query.captures(current.rootNode);
    expect(captures).toHaveLength(1);
    const target = captures[0]!.node;
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
});

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
