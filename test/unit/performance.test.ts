import { expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';

const Root = path.join(import.meta.dirname, '../..');
// The Wasm build is the one the package ships.
const WasmPath = path.join(Root, 'tree-sitter-rust.wasm');
await Parser.init();
const parser = new Parser();
parser.setLanguage(await Language.load(WasmPath));

// Only `bun run build/ci` rebuilds the Wasm build, so a check against a stale one would pass after a source
// edit that brings the slowdown back.
test('uses a Wasm build built from the current parser', () => {
  // src/parser.c is generated from grammar.js, so an edit to the grammar alone also makes the Wasm build stale.
  const sources = ['grammar.js', 'src/parser.c', 'src/scanner.c'].map(
    (name) => fs.statSync(path.join(Root, name)).mtimeMs
  );
  expect(
    Math.max(...sources) > fs.statSync(WasmPath).mtimeMs,
    'grammar.js or src/ changed after the Wasm build was built; run `bun run build/ci`'
  ).toBe(false);
});

// Consumers parse files being edited, so recovering from many errors must stay linear: ten times the lines take
// about ten times as long, against a hundred times for quadratic recovery. The ratio, unlike an absolute limit,
// holds on slow CI runners, and each size keeps its fastest run to filter out pauses caused by the tests running
// alongside.
test('recovers from an error on each line in linear time', { timeout: 60_000 }, () => {
  expect(fastestParseTime(10_000) / fastestParseTime(1000)).toBeLessThan(30);
});

function fastestParseTime(lines: number): number {
  let fastest = Infinity;
  for (let run = 0; run < 3; run++) {
    const start = performance.now();
    const tree = parser.parse('$ a\n'.repeat(lines));
    fastest = Math.min(fastest, performance.now() - start);
    if (!tree) throw new Error('The parser returned no tree');
    const { hasError } = tree.rootNode;
    tree.delete();
    expect(hasError).toBe(true);
  }
  return fastest;
}
