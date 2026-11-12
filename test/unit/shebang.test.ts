import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

import { fieldNodes } from '../helpers/ast.js';

await Parser.init();
const language = await Language.load('tree-sitter-rust.wasm');

test('preserves shebang ranges at EOF and before Rust declarations', () => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const command of ['#!', '#! ', '#!/usr/bin/env rusti', '#!/* unterminated', '#!// comment']) {
      for (const bom of ['', '\uFEFF']) {
        for (const ending of ['', '\nfn f() {}', '\r\nfn f() {}']) {
          const source = bom + command + ending;
          const tree = parser.parse(source)!;
          try {
            expect(tree.rootNode.hasError, source).toBe(false);
            const shebang = tree.rootNode.descendantsOfType('shebang')[0]!;
            expect(shebang.text).toBe(command + (ending.startsWith('\r') ? '\r\n' : ending.slice(0, 1)));
            expect(shebang.startIndex).toBe(bom.length);
            expect(shebang.endIndex).toBe(bom.length + shebang.text.length);
            expect(fieldNodes(tree.rootNode, 'function_item', 'name', 'identifier').map((node) => node.text)).toEqual(
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
    parser.delete();
  }
});

test('retains inner attributes across whitespace and ordinary nested comments', () => {
  const parser = new Parser().setLanguage(language);
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
        const matches = tree.rootNode
          .descendantsOfType('inner_attribute_item')
          .flatMap((attribute) =>
            attribute.children
              .filter((child) => child.type === 'attribute')
              .flatMap((inner) =>
                inner.children.filter((name) => name.type === 'identifier').map((name) => ({ attribute, name }))
              )
          );
        expect(matches.map(({ name }) => name.text)).toEqual(['allow']);
        const attribute = matches[0]!.attribute;
        expect(attribute.startIndex).toBe(0);
        expect(attribute.endIndex).toBe(source.indexOf('\nfn'));
        expect(attribute.text).toBe(source.slice(0, attribute.endIndex));
        expect(tree.rootNode.descendantsOfType('function_item').map((node) => node.text)).toEqual(['fn f() {}']);
      } finally {
        tree.delete();
      }
    }
  } finally {
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
