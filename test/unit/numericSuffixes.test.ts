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
      ['float_literal', '1e3efoo'],
      ['float_literal', '1e3Efoo'],
      ['float_literal', '1.0e3efoo'],
      ['float_literal', '1.0E3Efoo'],
      ['integer_literal', '0x1efoo'],
      ['integer_literal', '0_unit'],
      ['integer_literal', '0_foo'],
      ['integer_literal', '00bfoo'],
      ['float_literal', '1e3_类型'],
      ['float_literal', '1.0e3_efoo'],
    ]);
  } finally {
    query.delete();
    tree?.delete();
    parser.delete();
  }
});

test('preserves syntax errors at invalid numeric suffix boundaries', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  const query = new Query(language, '(_literal) @literal');
  try {
    for (const literal of [
      '1efoo',
      '1Efoo',
      '1.0efoo',
      '1.0Efoo',
      '1_efoo',
      '1.0_efoo',
      '0b1efoo',
      '0o7Efoo',
      '1e3_\u0301',
      '1.0e3_\u0661',
      '1e3_\u0661',
    ]) {
      const expression = parser.parse(`fn main() { let _ = ${literal}; }`)!;
      const macro = parser.parse(`swallow!(${literal});`)!;
      try {
        expect(expression.rootNode.hasError, literal).toBe(true);
        expect(
          query.captures(macro.rootNode).map(({ node }) => node.text),
          literal
        ).not.toContain(literal);
      } finally {
        expression.delete();
        macro.delete();
      }
    }
  } finally {
    query.delete();
    parser.delete();
  }
});

test('keeps tuple fields suffixless while preserving public integer captures', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser();
  parser.setLanguage(language);
  const fieldQuery = new Query(
    language,
    '(field_expression field: (integer_literal) @field) (field_initializer field: (integer_literal) @field)'
  );
  const literalQuery = new Query(language, '(_literal) @literal');
  try {
    for (const source of [
      'fn main() { let _ = 0x1f.0foo; }',
      'fn main() { let _ = 0b1.0foo; }',
      'fn main() { let _ = 0o7.5x; }',
      'fn main() { let x=(1,); let _ = x.0foo; }',
      'struct Tuple(u32); fn main() { let _ = Tuple { 0foo: 1 }; }',
    ]) {
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(true);
      } finally {
        tree.delete();
      }
    }
    const tree = parser.parse('struct Tuple(u32); fn main() { let t=(1u32,); let _=t.0; let _=Tuple { 0: 1 }; }')!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(fieldQuery.captures(tree.rootNode).map(({ node }) => [node.type, node.text])).toEqual([
        ['integer_literal', '0'],
        ['integer_literal', '0'],
      ]);
      expect(literalQuery.captures(tree.rootNode).map(({ node }) => node.text)).toEqual(['1u32', '1']);
    } finally {
      tree.delete();
    }
  } finally {
    fieldQuery.delete();
    literalQuery.delete();
    parser.delete();
  }
});
