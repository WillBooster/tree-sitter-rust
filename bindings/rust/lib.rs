//! This crate provides Rust language support for the [tree-sitter] parsing library.
//!
//! Typically, you will use the [`LANGUAGE`] constant to add this language to a
//! tree-sitter [`Parser`], and then use the parser to parse some code:
//!
//! ```
//! let code = "fn main() {\n    println!(\"Hello\");\n}\n";
//! let mut parser = tree_sitter::Parser::new();
//! let language = tree_sitter_rust::LANGUAGE;
//! parser
//!     .set_language(&language.into())
//!     .expect("Error loading Rust parser");
//! let tree = parser.parse(code, None).unwrap();
//! assert!(!tree.root_node().has_error());
//! ```
//!
//! The parser requires [willbooster-tree-sitter] 19.1.1 or later within major version 19.
//! Upstream's `tree-sitter` crate rejects its ABI (`0x5742000c`). Earlier `17.x` and `18.x`
//! `willbooster-tree-sitter` releases share ABI `0x5742000c` and pass that check, but dereference
//! unused `TSLanguage` tables that `19.1.0` and later omit.
//!
//! [`Parser`]: https://docs.rs/willbooster-tree-sitter/19.1.1/tree_sitter/struct.Parser.html
//! [willbooster-tree-sitter]: https://crates.io/crates/willbooster-tree-sitter
//! [tree-sitter]: https://tree-sitter.github.io/

use tree_sitter_language::LanguageFn;

unsafe extern "C" {
    fn tree_sitter_rust() -> *const ();
}

/// The tree-sitter [`LanguageFn`] for this grammar.
pub const LANGUAGE: LanguageFn = unsafe { LanguageFn::from_raw(tree_sitter_rust) };

/// The content of the [`node-types.json`] file for this grammar.
///
/// [`node-types.json`]: https://tree-sitter.github.io/tree-sitter/using-parsers/6-static-node-types
pub const NODE_TYPES: &str = include_str!("../../src/node-types.json");

#[cfg(test)]
mod tests {
    #[test]
    fn test_can_load_grammar() {
        let mut parser = tree_sitter::Parser::new();
        parser
            .set_language(&super::LANGUAGE.into())
            .expect("Error loading Rust parser");
    }
}
