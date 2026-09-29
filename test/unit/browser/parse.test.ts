/// <reference types="vite/client" />
import { Language, Parser } from '@willbooster/web-tree-sitter';
import runtimeUrl from '@willbooster/web-tree-sitter/web-tree-sitter.wasm?url';
import { expect, test } from 'vitest';

import rustUrl from '../../../tree-sitter-rust.wasm?url';

test('parses in a browser, loading the Wasm files over HTTP', async () => {
  await Parser.init({ locateFile: () => runtimeUrl });
  const parser = new Parser();
  parser.setLanguage(await Language.load(rustUrl));
  expect(parser.parse('fn main() {}')?.rootNode.toString()).toBe(
    '(source_file (function_item name: (identifier) parameters: (parameters) body: (block)))'
  );
});
