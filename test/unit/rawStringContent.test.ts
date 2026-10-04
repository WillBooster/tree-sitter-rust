import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

for (const prefix of ['r', 'br', 'cr']) {
  test(`preserves the complete content and range of ${prefix} raw strings`, async () => {
    await Parser.init();
    const language = await Language.load('tree-sitter-rust.wasm');
    const parser = new Parser();
    parser.setLanguage(language);
    const query = new Query(language, '(raw_string_literal (string_content) @content)');
    try {
      for (const content of ['', '   ', '\n\t SELECT * FROM users\n    ', '\r\n body\t', ' "partial"# \t']) {
        const before = `fn main() { let _ = ${prefix}##"`;
        const tree = parser.parse(`${before}${content}"##; }`)!;
        try {
          expect(tree.rootNode.hasError).toBe(false);
          const captures = query.captures(tree.rootNode);
          expect(captures).toHaveLength(1);
          expect(captures[0]?.node.text).toBe(content);
          expect(captures[0]?.node.startIndex).toBe(before.length);
          expect(captures[0]?.node.endIndex).toBe(before.length + content.length);
        } finally {
          tree.delete();
        }
      }
    } finally {
      query.delete();
      parser.delete();
    }
  });
}
