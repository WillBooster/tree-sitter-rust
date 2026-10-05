import { readFileSync } from 'node:fs';

import { Edit, Language, Parser, Query, type Node, type Point, type Tree } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

const Source = `macro_rules /* keyword */ ! add {
    ($ /* left */ x:expr, $ y:expr) => { $ /* right */ x + $
        y };
}
type macro_rules = i32;
fn macro_rules() -> macro_rules { 3 }
fn main() { let expected = macro_rules(); assert_eq!(add!(1, 2), expected); }
`;

const LiteralSource = `macro_rules! literal { ($) => { 1 }; }
macro_rules! tagged { ($x:ident, $) => { stringify!($x) }; }
macro_rules! keyword { ($ /* name */ fn:expr) => { $ /* reference */ fn }; }
fn main() {
    assert_eq!(literal!($), 1);
    assert_eq!(tagged!(answer, $), "answer");
    let value = keyword!(7);
    assert_eq!(value, 7);
}
`;

const Variables = ['$ /* left */ x', '$ y', '$ /* right */ x', '$\n        y'];

test('preserves macro bindings, references and highlights through trivia edits', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  const query = new Query(
    language,
    '(macro_definition name: (identifier) @macro)\n' +
      '(call_expression function: (identifier) @function)\n' +
      '(function_item return_type: (type_identifier) @returnType)\n' +
      '(token_binding_pattern name: (metavariable) @binding type: (fragment_specifier) @fragment)\n' +
      '(token_tree (metavariable) @reference)'
  );
  const highlights = new Query(
    language,
    readFileSync(new URL('../../queries/highlights.scm', import.meta.url), 'utf8')
  );
  let source = Source;
  let variables = [...Variables];
  let tree: Tree | undefined;
  try {
    tree = parser.parse(source)!;
    checkTree(tree);
    for (const [before, after] of [
      ['macro_rules /* keyword */ !', 'macro_rules!'],
      ['macro_rules!', 'macro_rules /* keyword */ !'],
      ['$ /* left */ x', '$x'],
      ['$x', '$ /* left */ x'],
      ['$ y', '$\n/* binding */ y'],
      ['$\n/* binding */ y', '$ y'],
    ]) {
      const start = source.indexOf(before!);
      expect(start).toBeGreaterThanOrEqual(0);
      const next = source.slice(0, start) + after + source.slice(start + before!.length);
      variables = variables.map((text) => (text === before ? after! : text));
      tree.edit(
        new Edit({
          startIndex: start,
          oldEndIndex: start + before!.length,
          newEndIndex: start + after!.length,
          startPosition: position(source, start),
          oldEndPosition: position(source, start + before!.length),
          newEndPosition: position(next, start + after!.length),
        })
      );
      const previous: Tree = tree;
      tree = parser.parse(next, previous)!;
      previous.delete();
      source = next;
      const fresh = parser.parse(source)!;
      try {
        expect(snapshot(tree.rootNode)).toEqual(snapshot(fresh.rootNode));
        checkTree(tree);
      } finally {
        fresh.delete();
      }
    }
    expect(source).toBe(Source);
  } finally {
    tree?.delete();
    query.delete();
    highlights.delete();
    parser.delete();
  }

  function checkTree(current: Tree): void {
    expect(current.rootNode.hasError).toBe(false);
    const captures = query.captures(current.rootNode);
    expect(captures.filter(({ name }) => name === 'returnType').map(({ node }) => node.text)).toEqual(['macro_rules']);
    expect(captures.filter(({ name }) => name === 'function').map(({ node }) => node.text)).toEqual(['macro_rules']);
    expect(captures.filter(({ name }) => name === 'macro').map(({ node }) => node.text)).toEqual(['add']);
    expect(captures.filter(({ name }) => name === 'fragment').map(({ node }) => node.text)).toEqual(['expr', 'expr']);
    let offset = 0;
    const expected = variables.map((text) => {
      const start = source.indexOf(text, offset);
      offset = start + text.length;
      return [text, start, offset];
    });
    expect(
      captures
        .filter(({ name }) => name === 'binding' || name === 'reference')
        .map(({ node }) => [node.text, node.startIndex, node.endIndex])
    ).toEqual(expected);
    const tokens = highlights.captures(current.rootNode);
    const keyword = source.startsWith('macro_rules!') ? 'macro_rules!' : 'macro_rules';
    expect(
      tokens
        .filter(({ name, node }) => name === 'keyword' && node.type === 'macro_rules!')
        .map(({ node }) => [node.text, node.startIndex, node.endIndex])
    ).toEqual([[keyword, 0, keyword.length]]);
    expect(tokens.filter(({ name }) => name === 'comment').map(({ node }) => node.text)).toEqual(
      ['/* keyword */', '/* left */', '/* binding */', '/* right */'].filter((text) => source.includes(text))
    );
  }
});

test('keeps literal dollars separate from metavariables through error recovery', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, '(metavariable) @variable');
  let source = LiteralSource;
  let tree: Tree | undefined;
  try {
    tree = parser.parse(source)!;
    expect(tree.rootNode.hasError).toBe(false);
    const start = source.indexOf('keyword!(7)');
    expect(start).toBeGreaterThanOrEqual(0);
    for (const [before, after] of [
      ['keyword!(7)', '$'],
      ['$', 'keyword!(7)'],
    ]) {
      const next = source.slice(0, start) + after + source.slice(start + before!.length);
      tree.edit(
        new Edit({
          startIndex: start,
          oldEndIndex: start + before!.length,
          newEndIndex: start + after!.length,
          startPosition: position(source, start),
          oldEndPosition: position(source, start + before!.length),
          newEndPosition: position(next, start + after!.length),
        })
      );
      const previous: Tree = tree;
      tree = parser.parse(next, previous)!;
      previous.delete();
      source = next;
      const fresh = parser.parse(source)!;
      try {
        expect(snapshot(tree.rootNode)).toEqual(snapshot(fresh.rootNode));
        expect(tree.rootNode.hasError).toBe(after === '$');
        for (const current of [tree, fresh]) {
          const variables = query.captures(current.rootNode);
          expect(variables.map(({ node }) => node.text)).toEqual([
            '$x',
            '$x',
            '$ /* name */ fn',
            '$ /* reference */ fn',
          ]);
          expect(variables.every(({ node }) => !node.hasError)).toBe(true);
        }
      } finally {
        fresh.delete();
      }
    }
    expect(source).toBe(LiteralSource);
  } finally {
    tree?.delete();
    query.delete();
    parser.delete();
  }
});

function position(source: string, index: number): Point {
  const lines = source.slice(0, index).split('\n');
  return { row: lines.length - 1, column: lines.at(-1)!.length };
}

function snapshot(node: Node): unknown {
  return [
    node.type,
    node.isNamed,
    node.isExtra,
    node.isMissing,
    node.hasError,
    node.startIndex,
    node.endIndex,
    node.startPosition,
    node.endPosition,
    node.children.map((_, i) => node.fieldNameForChild(i)),
    node.children.map(snapshot),
  ];
}
