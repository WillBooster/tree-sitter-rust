import path from 'node:path';

import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test('keeps primitive casts in type queries without consuming following arithmetic', async () => {
  await Parser.init();
  const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-rust.wasm'));
  const parser = new Parser();
  parser.setLanguage(language);
  const query = new Query(language, '(_type/primitive_type) @primitive');
  try {
    for (const primitive of ['i32', 'f16', 'f128']) {
      const source = `fn f(x: ${primitive}, y: ${primitive}) { let z = x as ((${primitive})) + y; }`;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError).toBe(false);
        expect(query.captures(tree.rootNode).map(({ node }) => node.text)).toEqual([primitive, primitive, primitive]);
        expect(tree.rootNode.descendantsOfType('type_cast_expression').map((node) => node.text)).toEqual([
          `x as ((${primitive}))`,
        ]);
        expect(tree.rootNode.descendantsOfType('binary_expression').map((node) => node.text)).toEqual([
          `x as ((${primitive})) + y`,
        ]);
      } finally {
        tree.delete();
      }
    }
  } finally {
    query.delete();
    parser.delete();
  }
});

test('preserves higher-ranked type operands, parenthesized type queries and macro identifiers', async () => {
  await Parser.init();
  const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-rust.wasm'));
  const parser = new Parser();
  parser.setLanguage(language);
  const query = new Query(language, '(_type/tuple_type) @tuple (_type/primitive_type) @primitive');
  try {
    for (const primitive of ['u8', 'f16', 'f128']) {
      const tree = parser.parse(`fn f<T: (Send)>() where for<'a> (${primitive}): Send {}`)!;
      try {
        expect(tree.rootNode.hasError).toBe(false);
        expect(query.captures(tree.rootNode).map(({ name, node }) => [name, node.text])).toEqual([
          ['tuple', '(Send)'],
          ['tuple', `(${primitive})`],
          ['primitive', primitive],
        ]);
      } finally {
        tree.delete();
      }
    }
    const macros = parser.parse('macro_rules! m { ($x:ident) => {} } m!(f16); m!(f128);')!;
    try {
      expect(macros.rootNode.hasError).toBe(false);
      expect(
        macros.rootNode
          .descendantsOfType('macro_invocation')
          .flatMap((node) => node.descendantsOfType('token_tree'))
          .flatMap((node) => node.namedChildren)
          .map((node) => [node.type, node.text])
      ).toEqual([
        ['identifier', 'f16'],
        ['identifier', 'f128'],
      ]);
    } finally {
      macros.delete();
    }
  } finally {
    query.delete();
    parser.delete();
  }
});
