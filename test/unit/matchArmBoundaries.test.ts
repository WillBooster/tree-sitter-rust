import { readFileSync } from 'node:fs';

import { Language, Parser, Query, type Tree } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test('preserves borrowed match arms separated by block-body commas', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, '(match_arm pattern: (match_pattern) @pattern value: (_) @body)');
  const source = `fn example(value: &&Option<i32>) {
    match value { &&Some(0) => {}, &&Some(_) => {}, &&None => {} }
  }
  fn following() {}`;
  let tree: Tree | undefined;
  try {
    tree = parser.parse(source)!;
    checkTree(tree);
  } finally {
    tree?.delete();
    query.delete();
    parser.delete();
  }

  function checkTree(current: Tree): void {
    expect(current.rootNode.hasError).toBe(false);
    const captures = query.captures(current.rootNode);
    expect(captures.filter(({ name }) => name === 'pattern').map(({ node }) => node.text)).toEqual([
      '&&Some(0)',
      '&&Some(_)',
      '&&None',
    ]);
    expect(captures.filter(({ name }) => name === 'body').map(({ node }) => node.text)).toEqual(['{}', '{}', '{}']);
    expect(
      current.rootNode.descendantsOfType('function_item').map((node) => node.childForFieldName('name')!.text)
    ).toEqual(['example', 'following']);
  }
});

test('preserves neighboring pattern and expression forms in match arms', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  const source = `fn negative(value: i32) { match value { 0 => {} -1 => {} | 1 | 2 => {} _ => {} } }
    fn method(value: i32) -> i32 { match value { 0 => {1i32}.abs(), _ => 0 } }
    fn wrapped_call(value: i32) { match value { 0 => ({|| ()})(), _ => () } }
    fn wrapped_index(value: i32) -> i32 { match value { 0 => ({[1]})[0], _ => 0 } }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(
      tree.rootNode
        .descendantsOfType('match_expression')
        .map((match) =>
          match
            .childForFieldName('body')!
            .namedChildren.map((arm) => [arm.childForFieldName('pattern')!.text, arm.childForFieldName('value')!.type])
        )
    ).toEqual([
      [
        ['0', 'block'],
        ['-1', 'block'],
        ['| 1 | 2', 'block'],
        ['_', 'block'],
      ],
      [
        ['0', 'call_expression'],
        ['_', 'integer_literal'],
      ],
      [
        ['0', 'call_expression'],
        ['_', 'unit_expression'],
      ],
      [
        ['0', 'index_expression'],
        ['_', 'integer_literal'],
      ],
    ]);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test('keeps joint reference-pattern tokens distinct from nested patterns and boolean operators', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  const source = `fn patterns(value: &&i32, a: bool, b: bool) {
    let &&joint = value;
    let & /* gap */ &nested = value;
    let logical = a && b;
  }`;
  const tree = parser.parse(source)!;
  const highlights = new Query(language, readFileSync('queries/highlights.scm', 'utf8'));
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const patterns = tree.rootNode
      .descendantsOfType('let_declaration')
      .map((node) => node.childForFieldName('pattern')!);
    expect(patterns.slice(0, 2).map((node) => [node.type, node.firstChild!.type])).toEqual([
      ['reference_pattern', '&&'],
      ['reference_pattern', '&'],
    ]);
    expect(patterns[0]!.descendantsOfType('reference_pattern')).toHaveLength(1);
    expect(patterns[1]!.descendantsOfType('reference_pattern')).toHaveLength(2);
    expect(
      tree.rootNode
        .descendantsOfType('reference_type')
        .map((node) => [node.firstChild!.type, node.childForFieldName('type')!.text])
    ).toEqual([['&&', 'i32']]);
    expect(
      tree.rootNode.descendantsOfType('binary_expression').map((node) => node.childForFieldName('operator')!.text)
    ).toEqual(['&&']);
    expect(
      highlights
        .captures(tree.rootNode)
        .filter(
          ({ name, node }) => name === 'operator' && ['reference_type', 'reference_pattern'].includes(node.parent!.type)
        )
        .map(({ node }) => [node.text, node.startIndex])
    ).toEqual([
      ['&&', source.indexOf('&&i32')],
      ['&&', source.indexOf('&&joint')],
      ['&', source.indexOf('& /* gap */')],
      ['&', source.indexOf('&nested')],
    ]);
  } finally {
    highlights.delete();
    tree.delete();
    parser.delete();
  }
});
