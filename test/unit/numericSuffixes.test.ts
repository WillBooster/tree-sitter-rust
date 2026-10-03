import { readFileSync } from 'node:fs';

import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test('preserves numeric suffixes and following string boundaries in macro tokens', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  const source = readFileSync(new URL('../fixtures/numericSuffixes.rs', import.meta.url), 'utf8');
  const tree = parser.parse(source);
  const query = new Query(language, '(_literal) @literal');
  try {
    expect(tree?.rootNode.hasError).toBe(false);
    expect(query.captures(tree!.rootNode).map(({ node }) => [node.type, node.text])).toEqual([
      ['integer_literal', '123c'],
      ['string_literal', '"foo"'],
      ['integer_literal', '123b'],
      ['string_literal', '"foo"'],
      ['integer_literal', '123r'],
      ['string_literal', '"foo"'],
      ['float_literal', '1.0c'],
      ['string_literal', '"foo"'],
      ['float_literal', '1.5b'],
      ['string_literal', '"foo"'],
      ['float_literal', '1e3r'],
      ['string_literal', '"foo"'],
      ['integer_literal', '123duration'],
      ['integer_literal', '0xff_duration'],
      ['integer_literal', '0o7duration'],
      ['integer_literal', '0b1duration'],
      ['integer_literal', '7类型'],
      ['integer_literal', '8_unit'],
      ['float_literal', '1.25duration'],
      ['float_literal', '1.25类型'],
      ['float_literal', '1e3duration'],
      ['float_literal', '2.5_unit'],
      ['float_literal', '3.0f64unit'],
      ['float_literal', '1.0f64'],
      ['float_literal', '1e3f32'],
      ['integer_literal', '123u128'],
      ['float_literal', '1.0'],
      ['raw_string_literal', 'r"raw"'],
      ['float_literal', '2.0'],
      ['raw_string_literal', 'br"byte"'],
      ['float_literal', '3.0'],
      ['raw_string_literal', 'cr"c"'],
      ['float_literal', '4.0'],
      ['raw_string_literal', 'r#"raw"#'],
    ]);
  } finally {
    query.delete();
    tree?.delete();
    parser.delete();
  }
});
