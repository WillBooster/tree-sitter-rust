import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

const whitespaceCodePoints = [0x85, 0x20_0e, 0x20_0f, 0x20_28, 0x20_29];

test.each(whitespaceCodePoints)('treats Rust whitespace code point %s as a token separator', async (codePoint) => {
  await Parser.init();
  const parser = new Parser();
  parser.setLanguage(await Language.load('tree-sitter-rust.wasm'));
  const whitespace = String.fromCodePoint(codePoint);
  const sources = [
    'fn main() { let value = 1; }',
    'unsafe extern "C" { pub(in crate) safe fn function(); }',
    'unsafe extern "C" { pub(in crate) unsafe static VALUE: u8; }',
    'mod inner { unsafe extern "C" { pub(in crate :: inner ) safe fn function(); } }',
    'macro_rules! m { ($ name :tt) => {}; }',
    'tokens!("text" suffix, r"raw" suffix);',
    'fn main() { let raw = r"content"; let float = 1.; let range = 0.. -1; }',
  ];
  try {
    for (const source of sources) {
      const control = parser.parse(source)!;
      const tree = parser.parse(source.replaceAll(' ', whitespace))!;
      try {
        expect(control.rootNode.hasError, source).toBe(false);
        expect(tree.rootNode.hasError, source).toBe(false);
        expect(tree.rootNode.toString()).toBe(control.rootNode.toString());
      } finally {
        tree.delete();
        control.delete();
      }
    }
    const control = parser.parse('macro_rules! m { ($($x:tt) *) => {}; }')!;
    const tree = parser.parse(`macro_rules! m { ($($x:tt)${whitespace}*) => {}; }`)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(
        tree.rootNode.descendantsOfType('token_repetition_pattern')[0]?.children.map((node) => [node.type, node.text])
      ).toEqual(
        control.rootNode
          .descendantsOfType('token_repetition_pattern')[0]
          ?.children.map((node) => [node.type, node.text])
      );
    } finally {
      tree.delete();
      control.delete();
    }
  } finally {
    parser.delete();
  }
});

test.each(whitespaceCodePoints)('preserves whitespace code point %s inside string content', async (codePoint) => {
  await Parser.init();
  const parser = new Parser();
  parser.setLanguage(await Language.load('tree-sitter-rust.wasm'));
  const content = `left${String.fromCodePoint(codePoint)}right`;
  const tree = parser.parse(`fn main() { let ordinary = "${content}"; let raw = r"${content}"; }`)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('string_content').map((node) => node.text)).toEqual([content, content]);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(whitespaceCodePoints)(
  'does not skip whitespace code point %s inside a frontmatter header',
  async (codePoint) => {
    await Parser.init();
    const parser = new Parser();
    parser.setLanguage(await Language.load('tree-sitter-rust.wasm'));
    const tree = parser.parse(`---${String.fromCodePoint(codePoint)}\nvalue = 1\n---\nfn main() {}`)!;
    try {
      expect(tree.rootNode.hasError).toBe(true);
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);
