import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Edit, Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

import { position, snapshot } from '../helpers/treeSnapshot.js';

test('exposes trait aliases and declarative macros through public fields and shipped queries', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  const root = path.join(import.meta.dirname, '../..');
  const corpus = readFileSync(path.join(root, 'test/corpus/nightlyDeclarations.txt'), 'utf8');
  const source = corpus.split(/\n={20,}\n/)[1]!.split(/\n-{20,}\n/)[0]!;
  const tree = parser.parse(source)!;
  const queries = ['highlights', 'tags', 'injections'].map(
    (name) => new Query(language, readFileSync(path.join(root, `queries/${name}.scm`), 'utf8'))
  );
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const aliases = tree.rootNode.descendantsOfType('trait_alias');
    expect(aliases.map((node) => node.childForFieldName('name')?.text)).toEqual([
      'Displayable',
      'Lending',
      'Empty',
      'WithLifetime',
      'HigherRanked',
      'Trailing',
    ]);
    expect(aliases[1]?.childForFieldName('type_parameters')?.text).toBe("<'a, T>");
    expect(aliases[1]?.childForFieldName('bounds')?.text).toBe("Iterator<Item = &'a T>");
    const macros = tree.rootNode.descendantsOfType('decl_macro');
    expect(macros.map((node) => node.childForFieldName('name')?.text)).toEqual(['identity', 'choose']);
    expect(macros[0]?.childForFieldName('parameters')?.type).toBe('token_tree');
    expect(macros[0]?.childForFieldName('parameters')?.text).toBe('($value:expr)');
    expect(macros[1]?.childForFieldName('parameters')).toBeNull();
    expect(macros.every((node) => node.childForFieldName('body')?.type === 'token_tree')).toBe(true);
    const highlighted = queries[0]!.captures(tree.rootNode);
    for (const name of ['identity', 'choose']) {
      expect(highlighted.some((capture) => capture.name === 'function.macro' && capture.node.text === name)).toBe(true);
    }
    expect(highlighted.filter((capture) => capture.name === 'keyword' && capture.node.text === 'macro')).toHaveLength(
      2
    );
    const tags = queries[1]!.captures(tree.rootNode);
    expect(
      tags.filter((capture) => capture.name === 'definition.interface').map((capture) => capture.node.type)
    ).toEqual(Array.from({ length: 6 }, () => 'trait_alias'));
    expect(tags.filter((capture) => capture.name === 'definition.macro').map((capture) => capture.node.type)).toEqual([
      'decl_macro',
      'decl_macro',
    ]);
    const injected = queries[2]!.captures(tree.rootNode).filter((capture) => capture.name === 'injection.content');
    for (const macro of macros) {
      const body = macro.childForFieldName('body')!;
      expect(
        injected.some(
          (capture) => capture.node.startIndex === body.startIndex && capture.node.endIndex === body.endIndex
        )
      ).toBe(macro.childForFieldName('parameters') !== null);
      if (macro.childForFieldName('parameters')) {
        const expansion = parser.parse(body.text)!;
        try {
          expect(expansion.rootNode.hasError).toBe(false);
        } finally {
          expansion.delete();
        }
      }
    }
    const parameters = macros[0]!.childForFieldName('parameters')!;
    expect(injected.some((capture) => capture.node.startIndex === parameters.startIndex)).toBe(false);
    const index = source.indexOf('$value }');
    let current = tree.copy();
    let previous = source;
    try {
      for (const replacement of ['$value + 1', '$value']) {
        const end = previous.indexOf(' }', index);
        const next = previous.slice(0, index) + replacement + previous.slice(end);
        current.edit(
          new Edit({
            startIndex: index,
            oldEndIndex: end,
            newEndIndex: index + replacement.length,
            startPosition: position(previous, index),
            oldEndPosition: position(previous, end),
            newEndPosition: position(next, index + replacement.length),
          })
        );
        const old = current;
        current = parser.parse(next, old)!;
        old.delete();
        const fresh = parser.parse(next)!;
        try {
          expect(current.rootNode.hasError).toBe(false);
          expect(snapshot(current.rootNode)).toEqual(snapshot(fresh.rootNode));
        } finally {
          fresh.delete();
        }
        previous = next;
      }
    } finally {
      current.delete();
    }
  } finally {
    for (const query of queries) query.delete();
    tree.delete();
    parser.delete();
  }
});
