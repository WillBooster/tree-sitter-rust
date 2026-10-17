((macro_invocation
  (token_tree) @injection.content)
 (#set! injection.language "rust")
 (#set! injection.include-children))

((macro_rule
  (token_tree) @injection.content)
 (#set! injection.language "rust")
 (#set! injection.include-children))

((decl_macro
  parameters: (token_tree)
  body: (token_tree) @injection.content)
 (#set! injection.language "rust")
 (#set! injection.include-children))

((line_comment
  doc: (doc_comment) @injection.content)
 (#set! injection.language "markdown")
 (#set! injection.combined))

((block_comment
  doc: (doc_comment) @injection.content)
 (#set! injection.language "markdown"))
