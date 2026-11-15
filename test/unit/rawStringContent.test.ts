import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

import { directChildren } from '../helpers/ast.js';

for (const prefix of ['r', 'br', 'cr']) {
  test(`preserves the complete content and range of ${prefix} raw strings`, async () => {
    await Parser.init();
    const language = await Language.load('tree-sitter-rust.wasm');
    const parser = new Parser();
    parser.setLanguage(language);
    try {
      for (const hashes of ['', '#', '##', '#'.repeat(255)]) {
        const contents = ['', '   ', '\n\t SELECT * FROM users\n    ', '\r\n body\t'];
        if (hashes) contents.push(` "partial"${hashes.slice(1)} \t`);
        for (const content of contents) {
          checkContent(`fn main() { let _ = ${prefix}${hashes}"`, content, `"${hashes}; }`);
        }
      }
      checkContent(`macro_rules! tokens { ($($t:tt)*) => {} } tokens!(${prefix}#"`, '  a', '"###);');
      for (const count of [256, 257]) {
        const hashes = '#'.repeat(count);
        const exprTree = parser.parse(`fn main() { let _ = ${prefix}${hashes}"a"${hashes}; }`)!;
        const macroTree = parser.parse(
          `macro_rules! tokens { ($($t:tt)*) => {} } tokens!(${prefix}${hashes}"a"${hashes});`
        )!;
        try {
          expect(exprTree.rootNode.hasError).toBe(true);
          expect(directChildren(macroTree.rootNode, 'raw_string_literal', 'string_content')).toHaveLength(0);
        } finally {
          exprTree.delete();
          macroTree.delete();
        }
      }
    } finally {
      parser.delete();
    }

    function checkContent(before: string, content: string, after: string): void {
      const tree = parser.parse(`${before}${content}${after}`)!;
      try {
        expect(tree.rootNode.hasError).toBe(false);
        const captures = directChildren(tree.rootNode, 'raw_string_literal', 'string_content');
        expect(captures).toHaveLength(1);
        expect(captures[0]?.text).toBe(content);
        expect(captures[0]?.startIndex).toBe(before.length);
        expect(captures[0]?.endIndex).toBe(before.length + content.length);
      } finally {
        tree.delete();
      }
    }
  });
}
