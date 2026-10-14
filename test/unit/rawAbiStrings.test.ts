import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test.each([
  ['extern r"C" fn function() {}', 'r"C"'],
  ['pub unsafe extern r#"C"# fn function() {}', 'r#"C"#'],
  ['unsafe extern r##"C"## { fn function(); }', 'r##"C"##'],
  ['type Callback = unsafe extern r###"C"### fn();', 'r###"C"###'],
  ['trait Interface { extern r#"C"# fn function(); }', 'r#"C"#'],
])('parses a raw ABI string in %s', async (source, literal) => {
  await Parser.init();
  const parser = new Parser();
  const language = await Language.load('tree-sitter-rust.wasm');
  parser.setLanguage(language);
  const tree = parser.parse(source)!;
  let query: Query | undefined;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    query = new Query(language, '(extern_modifier (raw_string_literal (string_content) @abi) @literal) @modifier');
    const matches = query.matches(tree.rootNode);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.captures.map(({ name, node }) => [name, node.text])).toEqual([
      ['modifier', `extern ${literal}`],
      ['literal', literal],
      ['abi', 'C'],
    ]);
  } finally {
    query?.delete();
    tree.delete();
    parser.delete();
  }
});
