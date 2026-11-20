import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-rust.wasm'));

test('ends bare break nodes before the body whitespace', () => {
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse(`fn f(flag: bool) {
    'outer: loop {
        if flag || break 'outer

        { first(); }
        { next(); }
        while break 'outer     { first(); }
        { next(); }
    }
}`)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('break_expression').map((node) => node.text)).toEqual([
      "break 'outer",
      "break 'outer",
    ]);
  } finally {
    tree.delete();
    parser.delete();
  }
});
