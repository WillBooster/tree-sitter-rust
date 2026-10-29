import { readFileSync } from 'node:fs';

import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test('attaches outer documentation to its declaration and rejects orphan documentation', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  const highlights = new Query(language, readFileSync('queries/highlights.scm', 'utf8'));
  try {
    for (const doc of [
      '/// documentation\n',
      '///*documentation*\n',
      '///*\n',
      '/** documentation */',
      '///\n',
      '/** */',
    ]) {
      for (const item of ['pub fn f() {}', 'struct S;', 'enum E { V }', 'mod inner {}', 'type T = u8;', 'm!{}']) {
        const source = `mod m { ${doc} /* bridge */ #[allow(unused)] ${item} }`;
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(false);
          const wrapper = tree.rootNode.descendantsOfType('attributed_declaration')[0];
          expect(wrapper?.childForFieldName('declaration')?.text, source).toBe(item);
          expect(wrapper?.namedChildren[0]?.text, source).toBe(doc);
          expect(
            highlights
              .captures(tree.rootNode)
              .filter(({ name }) => name === 'attribute')
              .map(({ node }) => node.text)
          ).toEqual(['#[allow(unused)]']);
          expect(
            highlights
              .captures(tree.rootNode)
              .filter(({ name }) => name === 'comment')
              .map(({ node }) => node.text)
          ).toContain(doc);
          expect(wrapper?.namedChildren[0]?.namedChildren[0]?.childForFieldName('outer')?.text).toBe(
            doc.startsWith('///') ? '/' : '*'
          );
        } finally {
          tree.delete();
        }
      }
      for (const source of [
        doc,
        `mod m { fn f() {} ${doc} }`,
        `fn f() { ${doc} }`,
        `struct S { ${doc} }`,
        `fn f() { 1 ${doc} }`,
        `fn f() { (1 ${doc}) }`,
        `fn f() { [1 ${doc}] }`,
        `fn f() { 1 ${doc} /* ordinary */ }`,
      ]) {
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(true);
        } finally {
          tree.delete();
        }
      }
    }
    for (const source of [
      '//// ordinary\n',
      '/**/',
      '/***/',
      '/****/',
      '/* nested /** text */ comment */',
      '//! inner\n',
      '/*! inner */',
      'mod m { //! inner\n }',
      'struct S { /// field\n field: u8 }',
      'enum E { /** variant */ V }',
      'm! { /// arbitrary\n }',
      'macro_rules! m { () => { /** arbitrary */ } }',
    ]) {
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
      } finally {
        tree.delete();
      }
    }
  } finally {
    highlights.delete();
    parser.delete();
  }
});

test('retains comments and their highlighting while recovering from an invalid expression', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  const highlights = new Query(language, readFileSync('queries/highlights.scm', 'utf8'));
  try {
    for (const comment of ['// hello\n', '//// hello\n', '/* hello */', '/* nested /* hello */ */']) {
      const source = `fn f(){let x = @ ${comment};} fn after() {}`;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(true);
        expect(tree.rootNode.descendantsOfType(['line_comment', 'block_comment']).map((node) => node.text)).toContain(
          comment.trimEnd()
        );
        expect(
          highlights
            .captures(tree.rootNode)
            .filter(({ name }) => name === 'comment')
            .map(({ node }) => node.text)
        ).toContain(comment.trimEnd());
        expect(
          tree.rootNode.descendantsOfType('function_item').map((node) => node.childForFieldName('name')?.text)
        ).toEqual(['f', 'after']);
        expect(tree.rootNode.descendantsOfType('let_declaration')[0]?.childForFieldName('value')).toBeNull();
      } finally {
        tree.delete();
      }
    }
    for (const comment of [
      '// it\'s "x\n',
      '//! it\'s "x\n',
      '/// it\'s "x\n',
      '/* it\'s "x */',
      '/*! it\'s "x */',
      '/** it\'s "x */',
    ]) {
      const source = `@@@ ${comment}\nfn after() { let s = "y"; }`;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(true);
        expect(
          tree.rootNode.descendantsOfType(['line_comment', 'block_comment']).map((node) => node.text.trimEnd())
        ).toEqual([comment.trimEnd()]);
        expect(
          tree.rootNode.descendantsOfType('function_item').map((node) => node.childForFieldName('name')?.text)
        ).toEqual(['after']);
        expect(tree.rootNode.descendantsOfType('string_literal').map((node) => node.text)).toEqual(['"y"']);
      } finally {
        tree.delete();
      }
    }
  } finally {
    highlights.delete();
    parser.delete();
  }
});

test('retains misplaced documentation without swallowing following declarations', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  const highlights = new Query(language, readFileSync('queries/highlights.scm', 'utf8'));
  try {
    for (const comment of ['/** it\'s "x */', '/// it\'s "x\n']) {
      for (const prefix of [
        `fn f() { let x: ${comment} u8 = 1; }`,
        `use a::{${comment} b};`,
        `fn f() { let x = 1 ${comment}; }`,
        `type T = Vec<${comment}u8>;`,
        `fn f<T: ${comment}Clone>() {}`,
        `fn f<T>() where T: ${comment}Clone {}`,
      ]) {
        const source = `${prefix}\nfn after() { let s = "y"; }`;
        const tree = parser.parse(source)!;
        try {
          const node = tree.rootNode.descendantsOfType(['line_comment', 'block_comment'])[0];
          expect(node?.text.trimEnd(), source).toBe(comment.trimEnd());
          expect(node?.childForFieldName('outer')?.text, source).toBe(comment.startsWith('///') ? '/' : '*');
          expect(node?.childForFieldName('doc')?.text, source).toContain('it\'s "x');
          expect(tree.rootNode.descendantsOfType('function_item').at(-1)?.childForFieldName('name')?.text, source).toBe(
            'after'
          );
          expect(
            tree.rootNode.descendantsOfType('string_literal').map((item) => item.text),
            source
          ).toEqual(['"y"']);
          expect(
            highlights
              .captures(tree.rootNode)
              .filter(({ name }) => name === 'comment')
              .map(({ node: item }) => item.text.trimEnd()),
            source
          ).toContain(comment.trimEnd());
        } finally {
          tree.delete();
        }
      }
    }
  } finally {
    highlights.delete();
    parser.delete();
  }
});

test('attaches outer documentation before let conditions without losing following declarations', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  try {
    for (const attribute of ['/** docs */', '/// docs\n', '#[allow(unused)]']) {
      for (const condition of [
        `${attribute} let Some(x) = value`,
        `let Some(a) = first && ${attribute} let Some(x) = value`,
      ]) {
        for (const keyword of ['if', 'while']) {
          const source = `fn f() { ${keyword} ${condition} {} } fn after() {}`;
          const tree = parser.parse(source)!;
          try {
            expect(tree.rootNode.hasError, source).toBe(false);
            const last = tree.rootNode.descendantsOfType('let_condition').at(-1)!;
            expect(last.namedChildren[0]?.type, source).toBe('attribute_item');
            expect(last.namedChildren[0]?.text.trimEnd(), source).toBe(attribute.trimEnd());
            expect(last.childForFieldName('pattern')?.text, source).toBe('Some(x)');
            expect(last.childForFieldName('value')?.text, source).toBe('value');
            expect(tree.rootNode.descendantsOfType('function_item').at(-1)?.childForFieldName('name')?.text).toBe(
              'after'
            );
          } finally {
            tree.delete();
          }
        }
      }
    }
  } finally {
    parser.delete();
  }
});

test('rejects documentation before else without treating the keyword as a struct constructor', async () => {
  await Parser.init();
  const parser = new Parser().setLanguage(await Language.load('tree-sitter-rust.wasm'));
  try {
    for (const doc of ['/// docs\n', '/** docs */']) {
      for (const branch of ['else {}', 'else if y {}']) {
        const source = `fn f() { if x {} ${doc}${branch} }`;
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(true);
          expect(
            tree.rootNode.descendantsOfType('struct_expression').map((node) => node.childForFieldName('name')?.text)
          ).not.toContain('else');
        } finally {
          tree.delete();
        }
      }
      for (const name of ['r#else', 'elsewhere', 'Record']) {
        const source = `fn f() { let value = ${doc}${name} {}; }`;
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(false);
          expect(tree.rootNode.descendantsOfType('struct_expression')[0]?.childForFieldName('name')?.text).toBe(name);
        } finally {
          tree.delete();
        }
      }
    }
    for (const comment of ['// comment\n', '/* comment */', '']) {
      const source = `fn f() { if x {} ${comment}else {} }`;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        expect(tree.rootNode.descendantsOfType('if_expression')[0]?.childForFieldName('alternative')?.type).toBe(
          'else_clause'
        );
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});

test('retains outer documentation in broken use lists and type annotations', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  const highlights = new Query(language, readFileSync('queries/highlights.scm', 'utf8'));
  const injections = new Query(language, readFileSync('queries/injections.scm', 'utf8'));
  try {
    for (const doc of ['/// documentation\n', '///*documentation*\n', '/** documentation */']) {
      for (const source of [
        `use a::{@ ${doc} b}; fn after() {}`,
        `fn f() { let x: , ${doc} = 1; } fn after() {}`,
        `type T = @ ${doc}; fn after() {}`,
        `fn f() -> @ ${doc} { 0 } fn after() {}`,
      ]) {
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(true);
          const comment = tree.rootNode.descendantsOfType(['line_comment', 'block_comment'])[0];
          expect(comment?.text, source).toBe(doc);
          expect(comment?.childForFieldName('outer')?.text).toBe(doc.startsWith('///') ? '/' : '*');
          expect(comment?.childForFieldName('doc')?.text.trim()).toBe(
            doc.includes('*documentation*') ? '*documentation*' : 'documentation'
          );
          expect(
            highlights
              .captures(tree.rootNode)
              .filter(({ name }) => name === 'comment')
              .map(({ node }) => node.text)
          ).toContain(doc);
          expect(
            injections
              .captures(tree.rootNode)
              .filter(({ name }) => name === 'injection.content')
              .map(({ node }) => node.text.trim())
          ).toContain(doc.includes('*documentation*') ? '*documentation*' : 'documentation');
          expect(
            tree.rootNode.descendantsOfType('function_item').map((node) => node.childForFieldName('name')?.text)
          ).toContain('after');
        } finally {
          tree.delete();
        }
      }
    }
  } finally {
    injections.delete();
    highlights.delete();
    parser.delete();
  }
});

test('rejects orphan documentation without exposing its text to Rust recovery', async () => {
  await Parser.init();
  const parser = new Parser().setLanguage(await Language.load('tree-sitter-rust.wasm'));
  try {
    for (const doc of ['/// it\'s "x\n', '/** it\'s "x */']) {
      for (const head of [
        `fn f() { 1 ${doc} }`,
        `fn f(x: u8 ${doc}) {}`,
        `fn f() { let x = [1 ${doc}]; }`,
        `fn f() { let x = 1 ${doc} }`,
        `fn f() { let x: u8 ${doc} }`,
      ]) {
        const source = `${head} fn after() { let s = "y"; }`;
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(true);
          const comment = tree.rootNode.descendantsOfType(['line_comment', 'block_comment'])[0];
          expect(comment?.text, source).toBe(doc);
          expect(comment?.childForFieldName('outer')?.text, source).toBe(doc.startsWith('///') ? '/' : '*');
          expect(comment?.childForFieldName('doc')?.text.trim(), source).toBe('it\'s "x');
          expect(
            tree.rootNode.descendantsOfType('function_item').map((node) => node.childForFieldName('name')?.text),
            source
          ).toEqual(['f', 'after']);
        } finally {
          tree.delete();
        }
      }
    }
  } finally {
    parser.delete();
  }
});

test('preserves completed operands before orphan documentation with or without following trivia', async () => {
  await Parser.init();
  const parser = new Parser().setLanguage(await Language.load('tree-sitter-rust.wasm'));
  try {
    for (const doc of ['/// docs\n', '/** docs */']) {
      for (const trivia of ['', ' ', ' /* ordinary */ ']) {
        for (const [operand, suffix, nodeType] of [
          ['1', '', 'integer_literal'],
          ['g(1)', '', 'call_expression'],
          ['[1', ']', 'integer_literal'],
          ['(1', ')', 'integer_literal'],
        ] as const) {
          const source = `fn f() { ${operand} ${doc}${trivia}${suffix} } fn after() {}`;
          const tree = parser.parse(source)!;
          try {
            expect(tree.rootNode.hasError, source).toBe(true);
            expect(
              tree.rootNode.descendantsOfType(nodeType).map((node) => node.text),
              source
            ).toContain(nodeType === 'call_expression' ? 'g(1)' : '1');
            expect(tree.rootNode.descendantsOfType(['line_comment', 'block_comment'])[0]?.text, source).toBe(doc);
            expect(
              tree.rootNode.descendantsOfType('function_item').map((node) => node.childForFieldName('name')?.text),
              source
            ).toEqual(['f', 'after']);
          } finally {
            tree.delete();
          }
        }
      }
    }
  } finally {
    parser.delete();
  }
});

test('keeps orphan documentation recovery inside its closing boundary when a statement is unfinished', async () => {
  await Parser.init();
  const parser = new Parser().setLanguage(await Language.load('tree-sitter-rust.wasm'));
  try {
    for (const doc of ['/// it\'s "x\n', '/** it\'s "x */']) {
      for (const value of [`[1 ${doc}]`, `[(1) ${doc}]`, `(1 ${doc})`]) {
        for (const following of ['fn after() { let s = "y"; }', 'fn g() {}\nfn after() {}']) {
          const source = `fn f() { let x = ${value} } ${following}`;
          const tree = parser.parse(source)!;
          try {
            expect(tree.rootNode.hasError, source).toBe(true);
            expect(
              tree.rootNode.descendantsOfType('function_item').map((node) => node.childForFieldName('name')?.text),
              source
            ).toEqual(following.startsWith('fn g') ? ['f', 'g', 'after'] : ['f', 'after']);
            const comment = tree.rootNode.descendantsOfType(['line_comment', 'block_comment'])[0];
            expect(comment?.text, source).toBe(doc);
            expect(comment?.childForFieldName('doc')?.text.trim(), source).toBe('it\'s "x');
            expect(
              tree.rootNode.descendantsOfType('integer_literal').map((node) => node.text),
              source
            ).toContain('1');
          } finally {
            tree.delete();
          }
        }
      }
    }
  } finally {
    parser.delete();
  }
});
