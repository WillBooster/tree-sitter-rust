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
      for (const hashes of ['', '#', '##']) {
        const contents = ['', '   ', '\n\t SELECT * FROM users\n    ', '\r\n body\t'];
        if (hashes) contents.push(` "partial"${hashes.slice(1)} \t`);
        for (const content of contents) {
          checkContent(`fn main() { let _ = ${prefix}${hashes}"`, content, `"${hashes}; }`);
        }
      }
      checkContent(`macro_rules! tokens { ($($t:tt)*) => {} } tokens!(${prefix}#"`, '  a', '"###);');
    } finally {
      query.delete();
      parser.delete();
    }

    function checkContent(before: string, content: string, after: string): void {
      const tree = parser.parse(`${before}${content}${after}`)!;
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
  });
}
