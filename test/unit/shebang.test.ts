import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load('tree-sitter-rust.wasm');

test('preserves shebang ranges at EOF and before Rust declarations', () => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, '(shebang) @command (function_item name: (identifier) @function)');
  try {
    for (const command of ['#!', '#! ', '#!/usr/bin/env rusti', '#!/* unterminated', '#!// comment']) {
      for (const bom of ['', '\uFEFF']) {
        for (const ending of ['', '\nfn f() {}', '\r\nfn f() {}']) {
          const source = bom + command + ending;
          const tree = parser.parse(source)!;
          try {
            expect(tree.rootNode.hasError, source).toBe(false);
            const captures = query.captures(tree.rootNode);
            const shebang = captures.find(({ name }) => name === 'command')!.node;
            expect(shebang.text).toBe(command + (ending.startsWith('\r') ? '\r\n' : ending.slice(0, 1)));
            expect(shebang.startIndex).toBe(bom.length);
            expect(shebang.endIndex).toBe(bom.length + shebang.text.length);
            expect(captures.filter(({ name }) => name === 'function').map(({ node }) => node.text)).toEqual(
              ending ? ['f'] : []
            );
            expect(tree.rootNode.descendantsOfType('inner_attribute_item')).toHaveLength(0);
          } finally {
            tree.delete();
          }
        }
      }
    }
  } finally {
    query.delete();
    parser.delete();
  }
});

test('retains inner attributes across whitespace and ordinary nested comments', () => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, '(inner_attribute_item (attribute (identifier) @name)) @attribute');
  try {
    for (const trivia of [
      '',
      ' \t',
      '\n',
      '\r\n',
      '\u0085\u200E\u200F\u2028\u2029',
      '/* ordinary */',
      '/* [ /* nested */ ] */\n',
      '// comment [\n/* [ */\n',
      '//// ordinary\n',
      '/**/\n/***/\n',
    ]) {
      const source = `#!${trivia}[allow(dead_code)]\nfn f() {}`;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        expect(tree.rootNode.descendantsOfType('shebang')).toHaveLength(0);
        const captures = query.captures(tree.rootNode);
        expect(captures.filter(({ name }) => name === 'name').map(({ node }) => node.text)).toEqual(['allow']);
        const attribute = captures.find(({ name }) => name === 'attribute')!.node;
        expect(attribute.startIndex).toBe(0);
        expect(attribute.endIndex).toBe(source.indexOf('\nfn'));
        expect(attribute.text).toBe(source.slice(0, attribute.endIndex));
        expect(tree.rootNode.descendantsOfType('function_item').map((node) => node.text)).toEqual(['fn f() {}']);
      } finally {
        tree.delete();
      }
    }
  } finally {
    query.delete();
    parser.delete();
  }
});

test('does not treat documentation comments as attribute-separating trivia', () => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const text of ['/// doc [', '//! doc [', '/** doc */ [', '/*! doc */ [']) {
      const command = `#!${text}\n`;
      const tree = parser.parse(`${command}fn f() {}`)!;
      try {
        expect(tree.rootNode.hasError, command).toBe(false);
        expect(tree.rootNode.descendantsOfType('shebang').map((node) => node.text)).toEqual([command]);
        expect(tree.rootNode.descendantsOfType('function_item').map((node) => node.text)).toEqual(['fn f() {}']);
        expect(tree.rootNode.descendantsOfType('inner_attribute_item')).toHaveLength(0);
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});

test('rejects shebangs displaced from the beginning of the file', () => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const prefix of [' ', '\n', '// comment\n', '/* comment */', '\uFEFF\uFEFF']) {
      const tree = parser.parse(`${prefix}#!/bin/tool\nfn f() {}`)!;
      try {
        expect(tree.rootNode.hasError, prefix).toBe(true);
        expect(tree.rootNode.descendantsOfType('shebang')).toHaveLength(0);
        expect(tree.rootNode.descendantsOfType('function_item').map((node) => node.text)).toEqual(['fn f() {}']);
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});
