import path from 'node:path';

import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestHarness, type TestHarness } from 'wrangler';

// The same Worker with and without Node.js compatibility, since the grammar must run in both.
const Configs = {
  'tree-sitter-rust-test': 'wrangler.jsonc',
  'tree-sitter-rust-test-no-nodejs-compat': 'wrangler.no-nodejs-compat.jsonc',
};

let harness: TestHarness | undefined;

beforeAll(async () => {
  harness = createTestHarness({
    workers: Object.values(Configs).map((config) => ({
      configPath: path.join(import.meta.dirname, '../fixtures/workerd', config),
    })),
  });
  await harness.listen();
}, 120_000);

afterAll(async () => {
  await harness?.close();
});

test.each(Object.keys(Configs))('parses in Cloudflare Workers with the imported Wasm modules (%s)', async (name) => {
  const response = await harness!.getWorker(name).fetch('http://localhost/', { method: 'POST', body: 'fn main() {}' });
  expect(await response.text()).toBe(
    '(source_file (function_item name: (identifier) parameters: (parameters) body: (block)))'
  );
});
