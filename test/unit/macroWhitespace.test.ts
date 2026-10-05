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

test('retains complete Unicode and raw macro names through trivia edits', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  const query = new Query(
    language,
    '(token_binding_pattern name: (metavariable) @binding) (token_tree (metavariable) @reference)'
  );
  try {
    for (const name of ['é', '_é', 'α', '東京', 'Москва', 'a\u0301', 'a1é', 'r#foo', 'r#fn', 'r#é']) {
      for (const gap of ['', ' ', '/* c */', '\n']) {
        const variable = `$${gap}${name}`;
        const source = `macro_rules! m { (${variable}:expr) => { ${variable} }; } fn main() { assert_eq!(m!(7), 7); }`;
        checkEdits(parser, query, source, variable, `$/* extra */${gap}${name}`, (text, tree) => {
          const bindingStart = text.indexOf('(') + 1;
          const bindingEnd = text.indexOf(':expr');
          const referenceStart = text.indexOf('=> { ') + 5;
          expect(
            query.captures(tree.rootNode).map(({ name, node }) => [name, node.text, node.startIndex, node.endIndex])
          ).toEqual([
            ['binding', text.slice(bindingStart, bindingEnd), bindingStart, bindingEnd],
            ['reference', variable, referenceStart, referenceStart + variable.length],
          ]);
        });
      }
    }
  } finally {
    query.delete();
    parser.delete();
  }
});

test('keeps prefixed literal tokens separate from dollars in opaque macro trees', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  const query = new Query(
    language,
    '(metavariable) @variable (string_literal) @literal (raw_string_literal) @literal (char_literal) @literal (float_literal) @literal'
  );
  try {
    for (const literal of [
      'r"abc"',
      'b"abc"',
      'c"abc"',
      'br"abc"',
      'cr"abc"',
      'r#"abc"#',
      'br#"abc"#',
      'cr#"abc"#',
      "b'a'",
      '"abc"',
      '1.',
    ]) {
      for (const source of [
        `macro_rules! m { ($ ${literal}) => {}; }`,
        `macro_rules! m { () => { stringify!($ ${literal}) }; }`,
        `macro_rules! m { ($d:tt $l:literal) => { 7 }; } fn main() { assert_eq!(m!($ ${literal}), 7); }`,
      ]) {
        const start = source.indexOf(literal);
        checkEdits(parser, query, source, literal, '"plain"', (text, tree) => {
          const currentLiteral = text === source ? literal : '"plain"';
          const captures = query.captures(tree.rootNode);
          expect(
            captures
              .filter(({ name }) => name === 'literal')
              .map(({ node }) => [node.text, node.startIndex, node.endIndex])
          ).toEqual([[currentLiteral, start, start + currentLiteral.length]]);
          expect(captures.filter(({ name }) => name === 'variable').map(({ node }) => node.text)).toEqual(
            source.includes('$d:tt') ? ['$d', '$l'] : []
          );
        });
      }
    }
  } finally {
    query.delete();
    parser.delete();
  }
});

test('retains repetition nodes and separators through surrounding trivia edits', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, '(token_repetition_pattern) @pattern (token_repetition) @repetition');
  const configured = ['highlights', 'tags', 'injections'].map(
    (name) => new Query(language, readFileSync(new URL(`../../queries/${name}.scm`, import.meta.url), 'utf8'))
  );
  try {
    for (const operator of ['*', '+', '?']) {
      for (const separator of operator === '?'
        ? ['']
        : [
            '',
            '$',
            '"x$y"',
            '"x+y?"',
            'b"x$y"',
            'c"x$y"',
            'r##"x"#y$z"##',
            'br##"x"#y$z"##',
            'cr##"x"#y$z"##',
            "'$'",
            "b'$'",
          ]) {
        for (const gap of separator ? ['', ' ', '/* before */', '// before\n'] : ['']) {
          for (const matcher of [true, false]) {
            const pattern = `$($a:tt)${gap}${separator}${operator}`;
            const reference = `$($a)${gap}${separator}${operator}`;
            const source = matcher
              ? `macro_rules! m { (${pattern} /* pattern end */ // tail\n#[allow(x)]) => { 1 }; }`
              : `macro_rules! m { (${pattern} /* pattern end */) => { ${reference} /* reference end */ // tail\n#[allow(x)] }; }`;
            checkEdits(parser, query, source, '// tail\n', '/* tail */ ', check, configured);
            if (separator)
              checkEdits(
                parser,
                query,
                source,
                `)${gap}${separator}`,
                `)${gap === '/* before */' ? '// edited\n' : '/* edited */'}${separator}`,
                check,
                configured
              );

            function check(text: string, tree: Tree): void {
              const expected = [['pattern', '/* pattern end */']];
              if (!matcher) expected.push(['repetition', '/* reference end */']);
              let start = 0;
              expect(
                query.captures(tree.rootNode).map(({ name, node }) => [name, node.text, node.startIndex, node.endIndex])
              ).toEqual(
                expected.map(([name, marker]) => {
                  start = text.indexOf('$(', start);
                  const end = text.slice(0, text.indexOf(marker!, start)).trimEnd().length;
                  const capture = [name, text.slice(start, end), start, end];
                  start = end;
                  return capture;
                })
              );
            }
          }
        }
      }
    }
  } finally {
    query.delete();
    for (const current of configured) current.delete();
    parser.delete();
  }
});

test('preserves repetition separators and following comment captures through edits', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  const query = new Query(
    language,
    '(token_repetition_pattern) @pattern (token_repetition) @repetition (block_comment) @comment (line_comment) @comment'
  );
  const configured = ['highlights', 'tags', 'injections'].map(
    (name) => new Query(language, readFileSync(new URL(`../../queries/${name}.scm`, import.meta.url), 'utf8'))
  );
  try {
    for (const operator of ['*', '+']) {
      for (const separator of [',', 'foo', ';', '=>', '::', '$', '/', '/=']) {
        for (const comment of ['/* after */', '// after\n']) {
          const gap = separator === '/' ? ` ${comment}` : comment;
          for (const matcher of [true, false]) {
            const pattern = matcher ? `$($a:tt)${separator}${gap}${operator}` : `$($a:tt),${operator}`;
            const reference = matcher ? `$($a)${operator}` : `$($a)${separator}${gap}${operator}`;
            const source = `macro_rules! m { (${pattern}) => { stringify!(${reference}) }; } fn main() { assert!(!m!(a ${matcher ? separator : ','} b).is_empty()); }`;
            const edited = separator === '/' ? ' /* edited */ ' : '/* edited */';
            checkEdits(parser, query, source, gap, edited, check, configured);

            function check(text: string, tree: Tree): void {
              const expected = [pattern, reference].map((value) => {
                const current = value.includes(gap) ? value.replace(gap, text.includes(edited) ? edited : gap) : value;
                const start = text.indexOf(current);
                return [current, start, start + current.length];
              });
              const captures = query.captures(tree.rootNode);
              expect(
                captures
                  .filter(({ name }) => name !== 'comment')
                  .map(({ node }) => [node.text, node.startIndex, node.endIndex])
              ).toEqual(expected);
              const currentComment = text.includes(edited) ? '/* edited */' : comment.trim();
              const start = text.indexOf(currentComment);
              const expectedComment = [[currentComment, start, start + currentComment.length]];
              expect(
                captures
                  .filter(({ name }) => name === 'comment')
                  .map(({ node }) => [node.text, node.startIndex, node.endIndex])
              ).toEqual(expectedComment);
              expect(
                configured[0]!
                  .captures(tree.rootNode)
                  .filter(({ name }) => name === 'comment')
                  .map(({ node }) => [node.text, node.startIndex, node.endIndex])
              ).toEqual(expectedComment);
            }
          }
        }
      }
    }
  } finally {
    query.delete();
    for (const current of configured) current.delete();
    parser.delete();
  }
});

function checkEdits(
  parser: Parser,
  query: Query,
  initial: string,
  before: string,
  after: string,
  check: (source: string, tree: Tree) => void,
  additionalQueries: readonly Query[] = []
): void {
  let source = initial;
  let tree: Tree | undefined;
  try {
    tree = parser.parse(source)!;
    expect(tree.rootNode.hasError).toBe(false);
    check(source, tree);
    for (const [oldText, newText] of [
      [before, after],
      [after, before],
    ]) {
      const start = source.indexOf(oldText!);
      expect(start).toBeGreaterThanOrEqual(0);
      const next = source.slice(0, start) + newText + source.slice(start + oldText!.length);
      tree.edit(
        new Edit({
          startIndex: start,
          oldEndIndex: start + oldText!.length,
          newEndIndex: start + newText!.length,
          startPosition: position(source, start),
          oldEndPosition: position(source, start + oldText!.length),
          newEndPosition: position(next, start + newText!.length),
        })
      );
      const previous: Tree = tree;
      tree = parser.parse(next, previous)!;
      previous.delete();
      source = next;
      const fresh = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError).toBe(false);
        expect(snapshot(tree.rootNode)).toEqual(snapshot(fresh.rootNode));
        const captures = (current: Tree): unknown =>
          [query, ...additionalQueries]
            .flatMap((currentQuery) => currentQuery.captures(current.rootNode))
            .map(({ name, node }) => [
              name,
              node.text,
              node.startIndex,
              node.endIndex,
              node.startPosition,
              node.endPosition,
            ]);
        expect(captures(tree)).toEqual(captures(fresh));
        check(source, tree);
        check(source, fresh);
      } finally {
        fresh.delete();
      }
    }
    expect(source).toBe(initial);
  } finally {
    tree?.delete();
  }
}

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
