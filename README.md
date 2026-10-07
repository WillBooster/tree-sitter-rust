# @willbooster/tree-sitter-rust

[![npm version](https://img.shields.io/npm/v/@willbooster/tree-sitter-rust.svg)](https://www.npmjs.com/package/@willbooster/tree-sitter-rust)
[![license](https://img.shields.io/npm/l/@willbooster/tree-sitter-rust.svg)](https://www.npmjs.com/package/@willbooster/tree-sitter-rust)
[![Test](https://github.com/WillBooster/tree-sitter-rust/actions/workflows/test.yml/badge.svg)](https://github.com/WillBooster/tree-sitter-rust/actions/workflows/test.yml)
[![Test rust](https://github.com/WillBooster/tree-sitter-rust/actions/workflows/test-rust.yml/badge.svg)](https://github.com/WillBooster/tree-sitter-rust/actions/workflows/test-rust.yml)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)
[![wbfy](https://img.shields.io/badge/wbfy-20.28.8-1e90ff.svg)](https://github.com/WillBooster/shared/tree/main/packages/wbfy)
[![crates.io](https://img.shields.io/crates/v/willbooster-tree-sitter-rust.svg)](https://crates.io/crates/willbooster-tree-sitter-rust)

Rust grammar for [tree-sitter](https://github.com/tree-sitter/tree-sitter), forked from
[tree-sitter/tree-sitter-rust](https://github.com/tree-sitter/tree-sitter-rust). We are grateful
to its authors and contributors. This is not an official release of that project.

This fork fixes parsing bugs and raises conformance with [The Rust Reference](https://doc.rust-lang.org/reference/).

## Usage

The npm package ships `tree-sitter-rust.wasm` for
[@willbooster/web-tree-sitter](https://www.npmjs.com/package/@willbooster/web-tree-sitter), which runs in Node.js, Bun,
browsers, and Cloudflare Workers. The compact ABI 16 parser requires runtime 1.3.0 or later.

In Node.js and Bun, load the grammar from its path:

```js
import { fileURLToPath } from 'node:url';
import { Language, Parser } from '@willbooster/web-tree-sitter';

await Parser.init();
const parser = new Parser();
const wasmPath = fileURLToPath(import.meta.resolve('@willbooster/tree-sitter-rust/tree-sitter-rust.wasm'));
parser.setLanguage(await Language.load(wasmPath));
const tree = parser.parse('fn main() {}\n');
```

In browsers, load the grammar from its URL. With Vite:

```js
import { Language, Parser } from '@willbooster/web-tree-sitter';
import runtimeUrl from '@willbooster/web-tree-sitter/web-tree-sitter.wasm?url';
import rustUrl from '@willbooster/tree-sitter-rust/tree-sitter-rust.wasm?url';

await Parser.init({ locateFile: () => runtimeUrl });
const parser = new Parser();
parser.setLanguage(await Language.load(rustUrl));
```

In Cloudflare Workers, which do not allow compiling Wasm at run time, import both `.wasm` files as modules:

```js
import { Language, Parser } from '@willbooster/web-tree-sitter';
import runtime from '@willbooster/web-tree-sitter/web-tree-sitter.wasm';
import rust from '@willbooster/tree-sitter-rust/tree-sitter-rust.wasm';

await Parser.init({ wasmModule: runtime });
const parser = new Parser();
parser.setLanguage(await Language.load(rust));
```

The package also ships the queries in `queries/` and the node types in `src/node-types.json`.

In Rust, depend on the [crate](https://crates.io/crates/willbooster-tree-sitter-rust) and on
[willbooster-tree-sitter](https://crates.io/crates/willbooster-tree-sitter), the runtime this package is tested and
fuzzed with. The compact ABI 16 parser requires runtime 1.3.0 or later:

```toml
[dependencies]
tree-sitter = { package = "willbooster-tree-sitter", version = "1.3.0" }
tree-sitter-rust = { package = "willbooster-tree-sitter-rust", version = "2" }
```

```rust
let mut parser = tree_sitter::Parser::new();
parser.set_language(&tree_sitter_rust::LANGUAGE.into())?;
```

## Expression attributes

An attribute in an expression position can produce an `attributed_expression` node with a `value` field.
For example, in `let x = #[allow(unused)] 1 + 2;`, that field contains `1`; the enclosing binary expression
still contains `+ 2`. Multiple attributes can form nested wrappers. Queries matching `_expression` include
these wrappers. Follow each wrapper's `value` field until reaching the operand.

Existing item, parameter and list attributes retain their sibling nodes. Attributes inside parentheses also precede
the operand as siblings. List and parenthesized operands remain queryable through
`_expression`. Compiler feature gates and attribute-placement diagnostics remain the compiler's responsibility.

## Development

```sh
mise install
bun install --frozen-lockfile
bun run build/ci
bun run test
script/parse-examples
cargo test
```

The scripts and tests generate, build, test, and parse with `script/tree-sitter`, the tree-sitter CLI of the
WillBooster/tree-sitter runtime version locked in `Cargo.lock`, since the generator and the runtime of upstream's CLI are
not the ones this package ships with. Its first run downloads that CLI from the runtime's GitHub Release, or builds it
with `cargo` (whose build runs the CMake that `mise.toml` pins) when the download fails or the release has no binary that runs here. Run other CLI
commands through it as well (e.g. `script/tree-sitter parse file.rs`).

`bun run test` runs:

- the corpus in `test/corpus`, with the native build and with the Wasm build (the first run downloads the WASI SDK);
- an incremental-parsing check (`test/unit/incremental.test.ts`): `script/fuzz-corpus` runs `tree-sitter fuzz`, which
  edits each corpus case at random, reparses it, undoes the edits, and reparses again. `TREE_SITTER_SEED`,
  `TREE_SITTER_ITERATIONS`, and `TREE_SITTER_EDITS` run other or more edits;
- a check that the real-world Rust files in `examples/`, the checked-in ones and those of the cloned repositories,
  fail to parse exactly as listed in `script/known-failures.txt`. The first run clones the repositories. The example
  repositories are pinned to commits in `script/parse-examples`. After a grammar change or a moved pin alters that list,
  `script/parse-examples` rewrites it; review its diff before committing;
- a performance check (`test/unit/performance.test.ts`) that recovering from an error on each line takes linear time
  (ten times the lines take about ten times the CPU time, under a ceiling), since consumers parse files while they are
  being edited. It loads the Wasm build through @willbooster/web-tree-sitter, which `bun run build/ci` rebuilds after
  regenerating the parser;
- a check that `package.json` and `Cargo.lock` test the same runtime version (`test/unit/runtimeVersion.test.ts`);
- checks that the Wasm build parses in Chromium (`test/unit/browser/`) and in Cloudflare Workers with and without
  Node.js compatibility (`test/unit/workerd.test.ts`). Run `bun run test/ci-setup` once to install Chromium.

The tests and `script/parse-examples` compile the parser into `.tmp/tree-sitter-lib` rather than the CLI's cache shared
by every checkout; `script/fuzz-corpus` builds a per-run parser in `.tmp/fuzz` and deletes it afterwards.

CI also runs these tests on Linux arm64 and macOS, where the Rust binding compiles the parser natively, and fuzzes the
parser with libFuzzer and sanitizers (`.github/workflows/robustness.yml`).

### References

- [The Rust Reference](https://doc.rust-lang.org/reference/) — While Rust does
  not have a specification, the reference tries to describe its working in detail.
  It tends to be out of date.
- [Keywords](https://doc.rust-lang.org/stable/book/appendix-01-keywords.html) and
  [Operators and Symbols](https://doc.rust-lang.org/stable/book/appendix-02-operators.html).
