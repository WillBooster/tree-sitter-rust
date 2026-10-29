import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load('tree-sitter-rust.wasm');
const allEditionKeywords = [
  '_',
  'as',
  'break',
  'const',
  'continue',
  'crate',
  'else',
  'enum',
  'extern',
  'false',
  'fn',
  'for',
  'if',
  'impl',
  'in',
  'let',
  'loop',
  'match',
  'mod',
  'move',
  'mut',
  'pub',
  'ref',
  'return',
  'self',
  'Self',
  'static',
  'struct',
  'super',
  'trait',
  'true',
  'type',
  'unsafe',
  'use',
  'where',
  'while',
  'abstract',
  'become',
  'box',
  'do',
  'final',
  'macro',
  'override',
  'priv',
  'typeof',
  'unsized',
  'virtual',
  'yield',
];

test('rejects keyword declarations while retaining following declarations', () => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(
    language,
    '(function_item name: (identifier) @function) (struct_item name: (type_identifier) @type)'
  );
  try {
    for (const keyword of allEditionKeywords) {
      for (const declaration of [`fn ${keyword}() {}`, `struct ${keyword};`]) {
        const source = `${declaration}\nfn after() {}`;
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(true);
          const captures = query.captures(tree.rootNode);
          expect(
            captures.some(({ node }) => node.text === keyword),
            source
          ).toBe(false);
          const after = captures.find(({ name, node }) => name === 'function' && node.text === 'after')!.node;
          expect(after.startIndex, source).toBe(source.lastIndexOf('after'));
          expect(after.endIndex).toBe(after.startIndex + 'after'.length);
        } finally {
          tree.delete();
        }
      }
    }
  } finally {
    query.delete();
    parser.delete();
  }
});

test('retains valid raw identifiers and contextual names at declaration boundaries', () => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, '(function_item name: (identifier) @name)');
  const rawNames = allEditionKeywords
    .filter((name) => !['_', 'self', 'Self', 'crate', 'super'].includes(name))
    .map((name) => `r#${name}`);
  try {
    for (const name of [
      ...rawNames,
      'async',
      'await',
      'dyn',
      'try',
      'gen',
      'union',
      'raw',
      'safe',
      'default',
      'auto',
      'macro_rules',
    ]) {
      const source = `fn ${name}() {}\nfn after() {}`;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        expect(query.captures(tree.rootNode).map(({ node }) => [node.text, node.startIndex, node.endIndex])).toEqual([
          [name, 3, 3 + name.length],
          ['after', source.lastIndexOf('after'), source.lastIndexOf('after') + 5],
        ]);
      } finally {
        tree.delete();
      }
    }
  } finally {
    query.delete();
    parser.delete();
  }
});

test('retains keyword macro tokens, special paths and lifetime placeholders', () => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(
    language,
    '(struct_expression name: (_) @constructor) (lifetime (identifier) @lifetime) (macro_invocation macro: (identifier) @macro)'
  );
  const source = `macro_rules! words { ($($word:tt)*) => {}; }
words!(${allEditionKeywords.join(' ')});
struct S;
impl S {
    fn make() -> Self { Self {} }
    fn borrow(&self, value: &'static str) -> &'_ str { value }
    fn path() { let _: Self = Self::make(); let _ = self::S; let _ = Self; }
}
const _: () = ();
fn after() {}`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const captures = query.captures(tree.rootNode);
    expect(captures.filter(({ name }) => name === 'constructor').map(({ node }) => node.text)).toEqual(['Self']);
    expect(captures.filter(({ name }) => name === 'lifetime').map(({ node }) => node.text)).toEqual(['static', '_']);
    expect(captures.filter(({ name }) => name === 'macro').map(({ node }) => node.text)).toEqual(['words']);
    const tokens = tree.rootNode.descendantsOfType('macro_invocation')[0]!.descendantsOfType('token_tree')[0]!;
    expect(tokens.text).toBe(`(${allEditionKeywords.join(' ')})`);
    expect(tokens.startIndex).toBe(source.indexOf('words!(') + 'words!'.length);
    expect(tokens.endIndex).toBe(tokens.startIndex + tokens.text.length);
    expect(tree.rootNode.descendantsOfType('function_item').at(-1)!.childForFieldName('name')!.text).toBe('after');
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});
