import { readFileSync } from 'node:fs';
import { Edit, Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test('preserves frontmatter content and the following Rust declaration', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  const highlights = new Query(language, readFileSync('queries/highlights.scm', 'utf8'));
  try {
    for (const fence of ['---', '-----', '-'.repeat(256)]) {
      for (const body of ['', ' \t\n[dependencies]\n', '  ---\nvalue = "---"\n', 'before\0after\n']) {
        const source = `#!/usr/bin/env cargo\n\n${fence} Cargo.toml\n${body}${fence}\nfn main() {}`;
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(false);
          expect(
            highlights
              .captures(tree.rootNode)
              .filter(({ name, node }) => name === 'comment' && node.type === 'frontmatter')
              .map(({ node }) => node.text)
          ).toEqual([`${fence} Cargo.toml\n${body}${fence}`]);
          expect(tree.rootNode.descendantsOfType('frontmatter_content').map((node) => node.text)).toEqual([body]);
          expect(tree.rootNode.descendantsOfType('frontmatter_info_string').map((node) => node.text)).toEqual([
            'Cargo.toml',
          ]);
          expect(tree.rootNode.descendantsOfType('shebang').map((node) => node.text)).toEqual([
            '#!/usr/bin/env cargo\n',
          ]);
          expect(
            tree.rootNode.descendantsOfType('function_item').map((node) => node.childForFieldName('name')?.text)
          ).toEqual(['main']);
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

test('updates frontmatter fences and content incrementally', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  const query = new Query(language, '(frontmatter (frontmatter_content) @content)');
  let source = '---\n \tfirst\n---\nfn main() {}';
  let tree = parser.parse(source)!;
  try {
    for (const [removed, inserted, last] of [
      ['---', '-----', false],
      ['---', '-----', true],
      ['first', 'second', false],
    ] as const) {
      const index = last ? source.lastIndexOf(removed) : source.indexOf(removed);
      const before = source.slice(0, index);
      const position = { row: before.split('\n').length - 1, column: before.length - before.lastIndexOf('\n') - 1 };
      tree.edit(
        new Edit({
          startIndex: index,
          oldEndIndex: index + removed.length,
          newEndIndex: index + inserted.length,
          startPosition: position,
          oldEndPosition: { row: position.row, column: position.column + removed.length },
          newEndPosition: { row: position.row, column: position.column + inserted.length },
        })
      );
      source = before + inserted + source.slice(index + removed.length);
      const next = parser.parse(source, tree)!;
      tree.delete();
      tree = next;
      const fresh = parser.parse(source)!;
      try {
        expect(tree.rootNode.toString()).toBe(fresh.rootNode.toString());
        expect(query.captures(tree.rootNode).map(({ node }) => node.text)).toEqual(
          query.captures(fresh.rootNode).map(({ node }) => node.text)
        );
      } finally {
        fresh.delete();
      }
    }
    expect(tree.rootNode.hasError).toBe(false);
    expect(query.captures(tree.rootNode).map(({ node }) => node.text)).toEqual([' \tsecond\n']);
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});

test('handles CRLF headers and closing fences at end of input', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  try {
    const source = '---\t工具.file-name\r\n \tvalue = 1\r\n---\t';
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.descendantsOfType('frontmatter_content').map((node) => node.text)).toEqual([
        ' \tvalue = 1\r\n',
      ]);
      expect(tree.rootNode.descendantsOfType('frontmatter_info_string').map((node) => node.text)).toEqual([
        '工具.file-name',
      ]);
    } finally {
      tree.delete();
    }
  } finally {
    parser.delete();
  }
});
