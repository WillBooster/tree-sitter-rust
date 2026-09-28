# @willbooster/tree-sitter-rust

Rust grammar for [tree-sitter](https://github.com/tree-sitter/tree-sitter), forked from
[tree-sitter/tree-sitter-rust](https://github.com/tree-sitter/tree-sitter-rust). We are grateful to its authors and
contributors. This is not an official release of that project.

## Features

- **Speed** — When initially parsing a file, `tree-sitter-rust` takes around two to three times
  as long as rustc's hand-written parser.

  ```sh
  $ wc -l examples/ast.rs
    2157 examples/ast.rs

  $ rustc -Z unpretty=ast-tree -Z time-passes examples/ast.rs | head -n0
    time:   0.002; rss:   55MB ->   60MB (   +5MB)  parse_crate

  $ tree-sitter parse examples/ast.rs --quiet --time
    examples/ast.rs    6.48 ms        9908 bytes/ms
  ```

  But if you _edit_ the file after parsing it, tree-sitter can generally _update_
  the previous existing syntax tree to reflect your edit in less than a millisecond,
  thanks to its incremental parsing system.

## References

- [The Rust Reference](https://doc.rust-lang.org/reference/) — While Rust does
  not have a specification, the reference tries to describe its working in detail.
  It tends to be out of date.
- [Keywords](https://doc.rust-lang.org/stable/book/appendix-01-keywords.html) and
  [Operators and Symbols](https://doc.rust-lang.org/stable/book/appendix-02-operators.html).

