import { readFileSync } from 'node:fs';
import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test('injects Markdown into documentation content without comment delimiters or ordinary comments', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  const query = new Query(language, readFileSync('queries/injections.scm', 'utf8'));
  const source = [
    '//! Module documentation',
    '// ordinary line',
    '/// ```rust',
    '/// let value = 1;',
    '/// ```',
    'fn example() {}',
    '/** **Outer block** */',
    'struct Example;',
    'mod inner { /*! **Inner block** */ }',
    '/**\n * ```rust\n * let value = 1;\n * ```\n */',
    'fn guttered() {}',
    '/* ordinary block */',
    '/*** also ordinary */',
    '//// also ordinary',
    'example!(value);',
  ].join('\n');
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const matches = query.matches(tree.rootNode);
    expect(
      matches
        .filter(({ setProperties }) => setProperties?.['injection.language'] === 'markdown')
        .map(({ captures }) => captures.map(({ node }) => node.text).join(''))
    ).toEqual([
      ' Module documentation\n',
      ' ```rust\n',
      ' let value = 1;\n',
      ' ```\n',
      ' **Outer block** ',
      ' **Inner block** ',
      '\n * ```rust\n * let value = 1;\n * ```\n ',
    ]);
    expect(
      matches
        .filter(({ setProperties }) => setProperties?.['injection.language'] === 'rust')
        .flatMap(({ captures }) => captures.map(({ node }) => node.text))
    ).toEqual(['(value)']);
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});
