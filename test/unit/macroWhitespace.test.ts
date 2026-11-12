import { Language, Parser, type Tree } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

import { directChildren, fieldNodes, sortNodes, sortTaggedNodes } from '../helpers/ast.js';

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

test('preserves macro bindings and references around trivia', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  const source = Source;
  let tree: Tree | undefined;
  try {
    tree = parser.parse(source)!;
    checkTree(tree);
  } finally {
    tree?.delete();
    parser.delete();
  }

  function checkTree(current: Tree): void {
    expect(current.rootNode.hasError).toBe(false);
    expect(fieldNodes(current.rootNode, 'function_item', 'return_type', 'type_identifier').map((n) => n.text)).toEqual([
      'macro_rules',
    ]);
    expect(fieldNodes(current.rootNode, 'call_expression', 'function', 'identifier').map((n) => n.text)).toEqual([
      'macro_rules',
    ]);
    expect(fieldNodes(current.rootNode, 'macro_definition', 'name', 'identifier').map((n) => n.text)).toEqual(['add']);
    const bindingPatterns = current.rootNode
      .descendantsOfType('token_binding_pattern')
      .filter(
        (node) =>
          node.childForFieldName('name')?.type === 'metavariable' &&
          node.childForFieldName('type')?.type === 'fragment_specifier'
      );
    expect(bindingPatterns.map((node) => node.childForFieldName('type')!.text)).toEqual(['expr', 'expr']);
    let offset = 0;
    const expected = Variables.map((text) => {
      const start = source.indexOf(text, offset);
      offset = start + text.length;
      return [text, start, offset];
    });
    const variables = sortNodes([
      ...bindingPatterns.map((node) => node.childForFieldName('name')!),
      ...directChildren(current.rootNode, 'token_tree', 'metavariable'),
    ]);
    expect(variables.map((node) => [node.text, node.startIndex, node.endIndex])).toEqual(expected);
  }
});

test('recognizes macro_rules invocations with and without keyword trivia', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  try {
    for (const argumentsText of ['{}', '()', '[]']) {
      const invocation = `macro_rules! ${argumentsText}`;
      const terminator = argumentsText === '{}' ? '' : ';';
      const source = `macro_rules! macro_rules { () => {}; }\n${invocation}${terminator}\nfn following() {}`;
      for (const text of [source, replaceFirst(source, invocation, `macro_rules /* gap */ ! ${argumentsText}`)])
        checkParse(parser, text, checkMacroRulesInvocations);
    }
  } finally {
    parser.delete();
  }
});

test('keeps literal dollars separate from metavariables through error recovery', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  try {
    for (const [source, invalid] of [
      [LiteralSource, false],
      [replaceFirst(LiteralSource, 'keyword!(7)', '$'), true],
    ] as const) {
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError).toBe(invalid);
        const variables = tree.rootNode.descendantsOfType('metavariable');
        expect(variables.map((node) => node.text)).toEqual(['$x', '$x', '$ /* name */ fn', '$ /* reference */ fn']);
        expect(variables.every((node) => !node.hasError)).toBe(true);
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});

test('retains complete Unicode and raw macro names around dollar trivia', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  try {
    for (const name of ['é', '_é', 'α', '東京', 'Москва', 'a\u0301', 'a1é', 'r#foo', 'r#fn', 'r#é']) {
      for (const gap of ['', ' ', '/* c */', '\n']) {
        const variable = `$${gap}${name}`;
        const source = `macro_rules! m { (${variable}:expr) => { ${variable} }; } fn main() { assert_eq!(m!(7), 7); }`;
        for (const text of [source, replaceFirst(source, variable, `$/* extra */${gap}${name}`)])
          checkParse(parser, text, check);

        function check(text: string, tree: Tree): void {
          const bindingStart = text.indexOf('(') + 1;
          const bindingEnd = text.indexOf(':expr');
          const referenceStart = text.indexOf('=> { ') + 5;
          const captures = sortTaggedNodes([
            ...fieldNodes(tree.rootNode, 'token_binding_pattern', 'name', 'metavariable').map((node) => ({
              name: 'binding',
              node,
            })),
            ...directChildren(tree.rootNode, 'token_tree', 'metavariable').map((node) => ({
              name: 'reference',
              node,
            })),
          ]);
          expect(captures.map(({ name: kind, node }) => [kind, node.text, node.startIndex, node.endIndex])).toEqual([
            ['binding', text.slice(bindingStart, bindingEnd), bindingStart, bindingEnd],
            ['reference', variable, referenceStart, referenceStart + variable.length],
          ]);
        }
      }
    }
  } finally {
    parser.delete();
  }
});

test('keeps prefixed literal tokens separate from dollars in opaque macro trees', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
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
        for (const text of [source, replaceFirst(source, literal, '"plain"')]) checkParse(parser, text, check);

        function check(text: string, tree: Tree): void {
          const currentLiteral = text === source ? literal : '"plain"';
          const literals = tree.rootNode.descendantsOfType([
            'string_literal',
            'raw_string_literal',
            'char_literal',
            'float_literal',
          ]);
          expect(literals.map((node) => [node.text, node.startIndex, node.endIndex])).toEqual([
            [currentLiteral, start, start + currentLiteral.length],
          ]);
          expect(tree.rootNode.descendantsOfType('metavariable').map((node) => node.text)).toEqual(
            source.includes('$d:tt') ? ['$d', '$l'] : []
          );
        }
      }
    }
  } finally {
    parser.delete();
  }
});

test.each(['*', '+', '?'].flatMap((operator) => [true, false].map((matcher) => ({ operator, matcher }))))(
  'retains $operator repetition nodes and separators among surrounding trivia (matcher: $matcher)',
  async ({ operator, matcher }) => {
    await Parser.init();
    const language = await Language.load('tree-sitter-rust.wasm');
    const parser = new Parser().setLanguage(language);
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
          const texts = [source, replaceFirst(source, '// tail\n', '/* tail */ ')];
          if (separator)
            texts.push(
              replaceFirst(
                source,
                `)${gap}${separator}`,
                `)${gap === '/* before */' ? '// edited\n' : '/* edited */'}${separator}`
              )
            );
          for (const text of texts) checkParse(parser, text, check);

          function check(text: string, tree: Tree): void {
            const expected = [['pattern', '/* pattern end */']];
            if (!matcher) expected.push(['repetition', '/* reference end */']);
            let start = 0;
            expect(
              tree.rootNode
                .descendantsOfType(['token_repetition_pattern', 'token_repetition'])
                .map((node) => [
                  node.type === 'token_repetition_pattern' ? 'pattern' : 'repetition',
                  node.text,
                  node.startIndex,
                  node.endIndex,
                ])
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
      parser.delete();
    }
  }
);

test('preserves repetition separators and following comments', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
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
            for (const text of [source, replaceFirst(source, gap, edited)]) checkParse(parser, text, check);

            function check(text: string, tree: Tree): void {
              const expected = [pattern, reference].map((value) => {
                const current = value.includes(gap) ? value.replace(gap, text.includes(edited) ? edited : gap) : value;
                const start = text.indexOf(current);
                return [current, start, start + current.length];
              });
              expect(
                tree.rootNode
                  .descendantsOfType(['token_repetition_pattern', 'token_repetition'])
                  .map((node) => [node.text, node.startIndex, node.endIndex])
              ).toEqual(expected);
              const currentComment = text.includes(edited) ? '/* edited */' : comment.trim();
              const start = text.indexOf(currentComment);
              const expectedComment = [[currentComment, start, start + currentComment.length]];
              expect(
                tree.rootNode
                  .descendantsOfType(['block_comment', 'line_comment'])
                  .map((node) => [node.text, node.startIndex, node.endIndex])
              ).toEqual(expectedComment);
            }
          }
        }
      }
    }
  } finally {
    parser.delete();
  }
});

function checkMacroRulesInvocations(_source: string, tree: Tree): void {
  const captures = sortTaggedNodes([
    ...fieldNodes(tree.rootNode, 'macro_definition', 'name', 'identifier').map((node) => ({
      name: 'definition',
      node,
    })),
    ...fieldNodes(tree.rootNode, 'macro_invocation', 'macro', 'identifier').map((node) => ({
      name: 'invocation',
      node,
    })),
    ...fieldNodes(tree.rootNode, 'function_item', 'name', 'identifier').map((node) => ({
      name: 'function',
      node,
    })),
  ]);
  expect(captures.map(({ name, node }) => [name, node.text])).toEqual([
    ['definition', 'macro_rules'],
    ['invocation', 'macro_rules'],
    ['function', 'following'],
  ]);
}

function checkParse(parser: Parser, source: string, check: (source: string, tree: Tree) => void): void {
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    check(source, tree);
  } finally {
    tree.delete();
  }
}

function replaceFirst(source: string, before: string, after: string): string {
  const start = source.indexOf(before);
  expect(start).toBeGreaterThanOrEqual(0);
  return source.slice(0, start) + after + source.slice(start + before.length);
}
