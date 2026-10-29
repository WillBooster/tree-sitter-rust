import { readFileSync } from 'node:fs';

import { Language, Parser, Query, type Tree } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test('parses boxed bindings, alternatives and keyword highlighting', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, '(box_pattern pattern: (_) @inner)');
  const highlights = new Query(
    language,
    readFileSync(new URL('../../queries/highlights.scm', import.meta.url), 'utf8')
  );
  const source = `#![feature(box_patterns)]
    macro_rules! tokens { ($($tokens:tt)*) => {}; }
    fn patterns(value: Box<i32>) {
      let box scalar = Box::new(7);
      match value {
        box captured @ 0..=5 => { let _ = captured; }
        box 6 | box 7 => {}
        box _ => {}
      }
      tokens!(box, r#box);
    }
    fn r#box() {}`;
  let tree: Tree | undefined;
  try {
    tree = parser.parse(source)!;
    checkTree(tree);
  } finally {
    tree?.delete();
    highlights.delete();
    query.delete();
    parser.delete();
  }

  function checkTree(current: Tree): void {
    expect(current.rootNode.hasError).toBe(false);
    expect(query.captures(current.rootNode).map(({ node }) => [node.type, node.text])).toEqual([
      ['identifier', 'scalar'],
      ['captured_pattern', 'captured @ 0..=5'],
      ['integer_literal', '6'],
      ['integer_literal', '7'],
    ]);
    const arms = current.rootNode.descendantsOfType('match_arm');
    expect(arms.map((node) => node.childForFieldName('pattern')!.firstNamedChild!.type)).toEqual([
      'box_pattern',
      'or_pattern',
      'box_pattern',
    ]);
    expect(arms[1]!.descendantsOfType('box_pattern')).toHaveLength(2);
    expect(current.rootNode.descendantsOfType('box_pattern').at(-1)!.childForFieldName('pattern')!.text).toBe('_');
    expect(
      highlights
        .captures(current.rootNode)
        .filter(({ name, node }) => name === 'keyword' && node.text.includes('box'))
        .map(({ node }) => node.text)
    ).toEqual(['box', 'box', 'box', 'box', 'box', 'box']);
    expect(
      current.rootNode.descendantsOfType('function_item').map((node) => node.childForFieldName('name')!.text)
    ).toEqual(['patterns', 'r#box']);
  }
});
