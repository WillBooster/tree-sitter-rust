import { readFileSync } from 'node:fs';

import { Language, Parser, Query, type Tree } from '@willbooster/web-tree-sitter';
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

test('preserves macro bindings, references and highlights around trivia', async () => {
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
  const source = Source;
  let tree: Tree | undefined;
  try {
    tree = parser.parse(source)!;
    checkTree(tree);
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
    const expected = Variables.map((text) => {
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
    const keyword = 'macro_rules';
    expect(
      tokens
        .filter(({ name, node }) => name === 'keyword' && node.type === 'macro_rules!')
        .map(({ node }) => [node.text, node.startIndex, node.endIndex])
    ).toEqual([[keyword, 0, keyword.length]]);
    expect(tokens.filter(({ name }) => name === 'comment').map(({ node }) => node.text)).toEqual([
      '/* keyword */',
      '/* left */',
      '/* right */',
    ]);
  }
});

test('recognizes macro_rules invocations', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  const query = new Query(
    language,
    '(macro_definition name: (identifier) @definition)\n' +
      '(macro_invocation macro: (identifier) @invocation)\n' +
      '(function_item name: (identifier) @function)'
  );
  const highlights = new Query(language, readFileSync('queries/highlights.scm', 'utf8'));
  try {
    for (const argumentsText of ['{}', '()', '[]']) {
      const invocation = `macro_rules! ${argumentsText}`;
      const terminator = argumentsText === '{}' ? '' : ';';
      const source = `macro_rules! macro_rules { () => {}; }\n${invocation}${terminator}\nfn following() {}`;
      checkParse(parser, source, check);
      function check(_source: string, tree: Tree): void {
        expect(query.captures(tree.rootNode).map(({ name, node }) => [name, node.text])).toEqual([
          ['definition', 'macro_rules'],
          ['invocation', 'macro_rules'],
          ['function', 'following'],
        ]);
        const tokens = highlights.captures(tree.rootNode);
        expect(tokens.filter(({ name }) => name === 'function.macro').map(({ node }) => node.text)).toEqual([
          'macro_rules',
          '!',
        ]);
        expect(tokens.filter(({ name }) => name === 'keyword').map(({ node }) => node.text)).toEqual([
          'macro_rules',
          '!',
          'fn',
        ]);
      }
    }
  } finally {
    highlights.delete();
    query.delete();
    parser.delete();
  }
});

test('parses literal dollars and metavariables in macros', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse(LiteralSource)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test('retains complete Unicode and raw macro names after dollar trivia', async () => {
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
        checkParse(parser, source, (text, tree) => {
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
        checkParse(parser, source, (_text, tree) => {
          const captures = query.captures(tree.rootNode);
          expect(
            captures
              .filter(({ name }) => name === 'literal')
              .map(({ node }) => [node.text, node.startIndex, node.endIndex])
          ).toEqual([[literal, start, start + literal.length]]);
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

test.each(['*', '+', '?'].flatMap((operator) => [true, false].map((matcher) => ({ operator, matcher }))))(
  'retains $operator repetition nodes and separators among surrounding trivia (matcher: $matcher)',
  async ({ operator, matcher }) => {
    await Parser.init();
    const language = await Language.load('tree-sitter-rust.wasm');
    const parser = new Parser().setLanguage(language);
    const query = new Query(language, '(token_repetition_pattern) @pattern (token_repetition) @repetition');
    try {
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
          const pattern = `$($a:tt)${gap}${separator}${operator}`;
          const reference = `$($a)${gap}${separator}${operator}`;
          const source = matcher
            ? `macro_rules! m { (${pattern} /* pattern end */ // tail\n#[allow(x)]) => { 1 }; }`
            : `macro_rules! m { (${pattern} /* pattern end */) => { ${reference} /* reference end */ // tail\n#[allow(x)] }; }`;
          checkParse(parser, source, check);

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
    } finally {
      query.delete();
      parser.delete();
    }
  }
);

test('preserves repetition separators and following comment captures', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  const query = new Query(
    language,
    '(token_repetition_pattern) @pattern (token_repetition) @repetition (block_comment) @comment (line_comment) @comment'
  );
  const highlights = new Query(
    language,
    readFileSync(new URL('../../queries/highlights.scm', import.meta.url), 'utf8')
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
            checkParse(parser, source, check);

            function check(text: string, tree: Tree): void {
              const expected = [pattern, reference].map((value) => {
                const start = text.indexOf(value);
                return [value, start, start + value.length];
              });
              const captures = query.captures(tree.rootNode);
              expect(
                captures
                  .filter(({ name }) => name !== 'comment')
                  .map(({ node }) => [node.text, node.startIndex, node.endIndex])
              ).toEqual(expected);
              const currentComment = comment.trim();
              const start = text.indexOf(currentComment);
              const expectedComment = [[currentComment, start, start + currentComment.length]];
              expect(
                captures
                  .filter(({ name }) => name === 'comment')
                  .map(({ node }) => [node.text, node.startIndex, node.endIndex])
              ).toEqual(expectedComment);
              expect(
                highlights
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
    highlights.delete();
    parser.delete();
  }
});

function checkParse(parser: Parser, source: string, check: (source: string, tree: Tree) => void): void {
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    check(source, tree);
  } finally {
    tree.delete();
  }
}
