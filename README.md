# @willbooster/tree-sitter-rust

[![npm version](https://img.shields.io/npm/v/@willbooster/tree-sitter-rust.svg)](https://www.npmjs.com/package/@willbooster/tree-sitter-rust)
[![license](https://img.shields.io/npm/l/@willbooster/tree-sitter-rust.svg)](https://www.npmjs.com/package/@willbooster/tree-sitter-rust)
[![Test](https://github.com/WillBooster/tree-sitter-rust/actions/workflows/test.yml/badge.svg)](https://github.com/WillBooster/tree-sitter-rust/actions/workflows/test.yml)
[![Test rust](https://github.com/WillBooster/tree-sitter-rust/actions/workflows/test-rust.yml/badge.svg)](https://github.com/WillBooster/tree-sitter-rust/actions/workflows/test-rust.yml)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)
[![wbfy](https://img.shields.io/badge/wbfy-21.3.0-1e90ff.svg)](https://github.com/WillBooster/shared/tree/main/packages/wbfy)
[![crates.io](https://img.shields.io/crates/v/willbooster-tree-sitter-rust.svg)](https://crates.io/crates/willbooster-tree-sitter-rust)

Rust grammar for [tree-sitter](https://github.com/tree-sitter/tree-sitter), forked from
[tree-sitter/tree-sitter-rust](https://github.com/tree-sitter/tree-sitter-rust). We are grateful
to its authors and contributors. This is not an official release of that project.

This fork fixes parsing bugs and raises conformance with [The Rust Reference](https://doc.rust-lang.org/reference/).

## Support Scope

This fork maintains only full parsing: valid input yields a correct tree, and invalid input yields `ERROR` or `MISSING`
nodes without crashing, hanging, or taking more than linear time. Incremental parsing works as in upstream tree-sitter
but is not tested here, and no queries (highlights, locals, injections, tags) are shipped. Node types, field names, and
the trees that error recovery produces may change; such changes are released as new major versions.

## Usage

The npm package ships `tree-sitter-rust.wasm` for
[@willbooster/web-tree-sitter](https://www.npmjs.com/package/@willbooster/web-tree-sitter), which runs in Node.js, Bun,
browsers, and Cloudflare Workers. The parser requires version 15.0.0 or later within major version 15 of that runtime.
It carries the WillBooster ABI number, which upstream's `web-tree-sitter` rejects.

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
import rustUrl from '@willbooster/tree-sitter-rust/tree-sitter-rust.wasm?url';
import { Language, Parser } from '@willbooster/web-tree-sitter';
import runtimeUrl from '@willbooster/web-tree-sitter/web-tree-sitter.wasm?url';

await Parser.init({ locateFile: () => runtimeUrl });
const parser = new Parser();
parser.setLanguage(await Language.load(rustUrl));
```

In Cloudflare Workers, which do not allow compiling Wasm at run time, import both `.wasm` files as modules:

```js
import rust from '@willbooster/tree-sitter-rust/tree-sitter-rust.wasm';
import { Language, Parser } from '@willbooster/web-tree-sitter';
import runtime from '@willbooster/web-tree-sitter/web-tree-sitter.wasm';

await Parser.init({ wasmModule: runtime });
const parser = new Parser();
parser.setLanguage(await Language.load(rust));
```

The package also ships the node types in `src/node-types.json`.

In Rust, depend on the [crate](https://crates.io/crates/willbooster-tree-sitter-rust) and on
[willbooster-tree-sitter](https://crates.io/crates/willbooster-tree-sitter), the runtime this package is tested and
fuzzed with. The parser requires version 15.0.0 or later within major version 15 of that runtime; upstream's
`tree-sitter` crate rejects it:

```sh
cargo add willbooster-tree-sitter@15.0.0 --rename tree-sitter
cargo add willbooster-tree-sitter-rust --rename tree-sitter-rust
```

```rust
let mut parser = tree_sitter::Parser::new();
parser.set_language(&tree_sitter_rust::LANGUAGE.into())?;
```

## Conditional chains

An `if` / `else if` / `else` chain is one `if_expression`. Its repeated `alternative` field contains a direct
`else_clause` for each `else if` and any final `else`. Conditional clauses expose `condition` and `consequence`
fields. The final `else` exposes only `consequence`.

## Box patterns

`box_pattern` exposes its operand through the `pattern` field, including anonymous `_` patterns.
Nested `box` patterns produce nested nodes; `box 6 | box 7` produces two boxed alternatives.
The `box` keyword is an anonymous token, including inside macro token trees; `r#box` remains an identifier.
The grammar parses this feature-gated syntax without evaluating Rust's feature attributes.

## Macros

A macro definition's anonymous `macro_rules!` node covers the `macro_rules` keyword. The `!` is a separate
anonymous child. A macro invocation's `macro` field contains its name, including when that name is `macro_rules`.

## Reference nodes

A joint `&&` token produces one `reference_pattern` or `reference_type` node with an anonymous `&&` child.
Consecutive `&` tokens separated by whitespace or comments produce nested reference nodes.
For a joint token, an optional lifetime and mutability describe the inner reference.

## Attributes

An attribute in an expression position can produce an `attributed_expression` node with a `value` field.
For example, in `let x = #[allow(unused)] 1 + 2;`, that field contains `1`; the enclosing binary expression
still contains `+ 2`. Consecutive attributes share one wrapper. The `_expression` supertype includes
these wrappers, including attributed block statements. The `value` field identifies the operand.

Outer declaration attributes belong to an `attributed_declaration` node whose `declaration` field identifies
the item. In declaration and statement positions, outer attributes without a following declaration or
expression produce a syntax error. In attribute positions, outer documentation comments (`///` and `/** ... */`) are
`attribute_item` nodes containing a `line_comment` or `block_comment`, with their existing `outer` and
`doc` fields. Inside macro token trees, outer documentation is a direct `line_comment` or
`block_comment` token child without an `attribute_item` wrapper. Inner documentation and ordinary
comments remain comment extras. Misplaced outer documentation where attributes are unavailable also
remains a comment extra with its `outer` and `doc` fields. At completed block, parameter,
parenthesized, and array boundaries, orphan outer documentation retains those fields and produces a syntax
error. Its missing owner cannot take a later item's body as an operand. Recovery after surrounding syntax
errors may return larger `ERROR` subtrees. Ordinary line comments are leaf nodes; read their `text` rather
than an anonymous `//` child.

Parameter and list attributes retain their sibling nodes. Attributes inside parentheses also precede
the operand as siblings. List and parenthesized operands remain in the
`_expression` supertype. Compiler feature gates and attribute-placement diagnostics remain the compiler's responsibility.

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

`bun run generate` records a fresh generation profile from the applicable `test/corpus` cases and Git-tracked
files in `examples/`, then generates compact parser tables. The parser also embeds metadata from `tree-sitter.json`. After changing a grammar,
`tree-sitter.json`, a corpus case, or a tracked example,
regenerate and commit `src/`. Stage added or removed examples with `git add -A examples` before generation so the profile uses the intended file list.
Profiles in `.tmp/generation-profiles/` are temporary and must not be committed. `bun run build-wasm`, `bun run build/ci`,
and the release build regenerate the parsers before compiling them.

`bun run test` runs:

- the corpus in `test/corpus`, with the native build and with the Wasm build (the first run downloads the WASI SDK);
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
by every checkout.

CI also runs these tests on Linux arm64 and macOS, where the Rust binding compiles the parser natively, and fuzzes the
parser with libFuzzer and sanitizers (`.github/workflows/robustness.yml`).

### References

- [The Rust Reference](https://doc.rust-lang.org/reference/) — While Rust does
  not have a specification, the reference tries to describe its working in detail.
  It tends to be out of date.
- [Keywords](https://doc.rust-lang.org/stable/book/appendix-01-keywords.html) and
  [Operators and Symbols](https://doc.rust-lang.org/stable/book/appendix-02-operators.html).
