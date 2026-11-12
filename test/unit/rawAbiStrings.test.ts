import { Language, Parser } from '@willbooster/web-tree-sitter';
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
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const matches = tree.rootNode.descendantsOfType('extern_modifier').flatMap((modifier) =>
      modifier.children
        .filter((child) => child.type === 'raw_string_literal')
        .flatMap((rawLiteral) =>
          rawLiteral.children
            .filter((abi) => abi.type === 'string_content')
            .map((abi) => [
              ['modifier', modifier.text],
              ['literal', rawLiteral.text],
              ['abi', abi.text],
            ])
        )
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual([
      ['modifier', `extern ${literal}`],
      ['literal', literal],
      ['abi', 'C'],
    ]);
  } finally {
    tree.delete();
    parser.delete();
  }
});
