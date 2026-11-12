import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load('tree-sitter-rust.wasm');

test.each([
  ["type Object = dyn 'static + Display;", "'static", 'type_identifier', 'Display'],
  ["type Object<'a> = dyn 'a + Trait<'a>;", "'a", 'generic_type', "Trait<'a>"],
  ["type Object<'a> = dyn 'a + for<'b> Trait<'b>;", "'a", 'higher_ranked_trait_bound', "for<'b> Trait<'b>"],
  ["type Object<'a> = dyn 'a + Send + Sync;", "'a", 'type_identifier', 'Send'],
  ["fn f(value: &(dyn '_ + std::fmt::Display)) {}", "'_", 'scoped_type_identifier', 'std::fmt::Display'],
] as const)('keeps the trait field and exposes a leading lifetime: %s', (source, lifetime, traitType, traitText) => {
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const captures = tree.rootNode.descendantsOfType('dynamic_type').flatMap((node) => {
      const trait = node.childForFieldName('trait');
      if (!trait?.isNamed) return [];
      return node.children
        .filter((child) => child.type === 'lifetime')
        .flatMap((bound) => [
          ['bound', bound.type, bound.text],
          ['trait', trait.type, trait.text],
        ]);
    });
    expect(captures).toEqual([
      ['bound', 'lifetime', lifetime],
      ['trait', traitType, traitText],
    ]);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test('requires a trait and the separator after a leading lifetime', () => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const type of ["dyn 'static", "dyn 'static +", "dyn 'static Display"]) {
      const tree = parser.parse(`type Object = ${type};`)!;
      try {
        expect(tree.rootNode.hasError, type).toBe(true);
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});
