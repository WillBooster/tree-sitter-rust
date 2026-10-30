import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test('preserves frontmatter content and the following Rust declaration', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  try {
    for (const fence of ['---', '-----', '-'.repeat(255)]) {
      for (const body of ['', ' \t\n[dependencies]\n', '  ---\nvalue = "---"\n', 'before\0after\n']) {
        const source = `#!/usr/bin/env cargo\n\n${fence} Cargo.toml\n${body}${fence}\nfn main() {}`;
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(false);
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
    parser.delete();
  }
});

test('handles CRLF headers and closing fences at end of input', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  try {
    const block = '---\t工具.file-name\r\n \tvalue = 1\r\n---\t';
    for (const ending of ['', '\r\nfn main() {}']) {
      const source = block + ending;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError).toBe(false);
        expect(tree.rootNode.descendantsOfType('frontmatter').map((node) => node.text)).toEqual([block]);
        expect(tree.rootNode.descendantsOfType('frontmatter_content').map((node) => node.text)).toEqual([
          ' \tvalue = 1\r\n',
        ]);
        expect(tree.rootNode.descendantsOfType('frontmatter_info_string').map((node) => node.text)).toEqual([
          '工具.file-name',
        ]);
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});

test('does not recognize frontmatter after an invalid prefix', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  try {
    for (const prefix of [
      '// comment\n',
      '/* comment */\n',
      '/// docs\n',
      '#!/usr/bin/env cargo\n// comment\n',
      '\n#!x\n',
      ' #!x\n',
      '#! [\n',
      '#!\r[\n',
      '#!\v[\n',
      '#!\f[\n',
      '#!\u0085[\n',
      '#!\u200E[\n',
      '#!\u200F[\n',
      '#!\u2028[\n',
      '#!\u2029[\n',
      '#!/*c*/[\n',
      '#!/* outer /* nested */ */[\n',
      '#!/**/[\n',
    ]) {
      const tree = parser.parse(`${prefix}---\nx\n---\nfn main() {}`)!;
      try {
        expect(tree.rootNode.hasError, prefix).toBe(true);
        expect(tree.rootNode.descendantsOfType('frontmatter')).toHaveLength(0);
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});

test('rejects frontmatter fences beyond the compiler limit', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  try {
    for (const count of [256, 257, 512]) {
      const fence = '-'.repeat(count);
      const tree = parser.parse(`${fence}\nvalue\n${fence}\nfn main() {}`)!;
      try {
        expect(tree.rootNode.hasError, String(count)).toBe(true);
        expect(tree.rootNode.descendantsOfType('frontmatter')).toHaveLength(0);
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});

test('rejects a truncated CRLF after the closing fence', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  try {
    for (const space of ['', ' ', '\t']) {
      const tree = parser.parse(`---\nvalue\n---${space}\r`)!;
      try {
        expect(tree.rootNode.hasError, JSON.stringify(space)).toBe(true);
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});

test('preserves shebang commands containing comment-shaped text', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  try {
    for (const prefix of [
      '#!/*c*/cmd\n',
      '#!/**doc*/[\n',
      '#!/*!doc*/[\n',
      '#!//comment\n',
      '#!/*\n',
      '#!\u00A0[\n',
      '#!\u2000[\n',
    ]) {
      const tree = parser.parse(`${prefix}---\nvalue\n---\nfn main() {}`)!;
      try {
        expect(tree.rootNode.hasError, prefix).toBe(false);
        expect(tree.rootNode.descendantsOfType('shebang').map((node) => node.text)).toEqual([prefix]);
        expect(tree.rootNode.descendantsOfType('frontmatter_content').map((node) => node.text)).toEqual(['value\n']);
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});

test('accepts Rust Unicode whitespace on blank lines before frontmatter', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  try {
    for (const space of ['\u0085', '\u200E', '\u200F', '\u2028', '\u2029']) {
      for (const shebang of ['', '#!/usr/bin/env cargo\n']) {
        const tree = parser.parse(`${shebang}${space}\n---\nvalue\n---\nfn main() {}`)!;
        try {
          expect(tree.rootNode.hasError, JSON.stringify({ space, shebang })).toBe(false);
          expect(tree.rootNode.descendantsOfType('frontmatter_content').map((node) => node.text)).toEqual(['value\n']);
        } finally {
          tree.delete();
        }
      }
    }
  } finally {
    parser.delete();
  }
});
