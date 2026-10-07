import { expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { generationInputMtime } from '../helpers/generationInputs.js';

import { Language, Parser } from '@willbooster/web-tree-sitter';

const Root = path.join(import.meta.dirname, '../..');
const WasmPath = path.join(Root, 'tree-sitter-rust.wasm');
await Parser.init();
const parser = new Parser();
parser.setLanguage(await Language.load(WasmPath));

// The tests load the existing Wasm build, so a check against a stale one would miss an edit that restores the slowdown.
test('uses a Wasm build built from the current parser', () => {
  const sources = ['grammar.js', 'src/parser.c', 'src/scanner.c'].map(
    (name) => fs.statSync(path.join(Root, name)).mtimeMs
  );
  expect(
    Math.max(generationInputMtime(Root), ...sources) > fs.statSync(WasmPath).mtimeMs,
    'grammar.js or src/ changed after the Wasm build was built; run `bun run build/ci`'
  ).toBe(false);
});

// Thread CPU excludes concurrent test workers and background Wasm compilation/collection.
// The ratio allows headroom over tenfold input growth while detecting quadratic work.
test.each([
  ['line errors', '', '$ a\n', '', true],
  ['malformed foreign visibility', 'extern "C" { ', 'pub(in x fn f;\n', ' }', true],
  ['macro dollar groups', 'macro_rules! m { (', '$( a )', '*) => {}; }', false],
  ['macro dollar groups with literal gaps', 'macro_rules! m { (', '$( a ) foo ', '*) => {}; }', false],
] as const)('parses %s with bounded CPU growth', { timeout: 60_000 }, (_, prefix, line, suffix, expectedError) => {
  const small = prefix + line.repeat(2000) + suffix;
  const large = prefix + line.repeat(20_000) + suffix;
  parseCpuTime(large, expectedError);
  parseCpuTime(large, expectedError);
  let smallFastest = Infinity;
  let largeFastest = Infinity;
  for (let run = 0; run < 5; run++) {
    smallFastest = Math.min(smallFastest, parseCpuTime(small, expectedError));
    largeFastest = Math.min(largeFastest, parseCpuTime(large, expectedError));
  }
  expect(largeFastest / smallFastest).toBeLessThan(18);
  // process.threadCpuUsage reports microseconds.
  expect(largeFastest).toBeLessThan(5_000_000);
});

function parseCpuTime(source: string, expectedError: boolean): number {
  const start = process.threadCpuUsage();
  const tree = parser.parse(source);
  const { system, user } = process.threadCpuUsage(start);
  if (!tree) throw new Error('The parser returned no tree');
  const { hasError } = tree.rootNode;
  tree.delete();
  expect(hasError).toBe(expectedError);
  return system + user;
}
