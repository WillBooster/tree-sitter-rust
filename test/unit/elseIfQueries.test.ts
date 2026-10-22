import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test('queries an entire else-if chain as one scope and each branch directly', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-rust.wasm');
  const parser = new Parser().setLanguage(language);
  const source = `fn inspect(input: Option<i32>) {
    if let Some(first) = input && first > 0 {
      if first == 1 {}
    } else /* branch */ if let Some(second) = input && second < 0 {
      negative(second);
    } else if input.is_none() {
      missing();
    } else {
      zero();
    }
  }`;
  const tree = parser.parse(source)!;
  const scopes = new Query(language, '(if_expression) @scope');
  const branches = new Query(
    language,
    '(else_clause "else" "if" condition: (_) @condition consequence: (block) @body)'
  );
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const capturedScopes = scopes.captures(tree.rootNode).map(({ node }) => node);
    expect(capturedScopes).toHaveLength(2);
    const chain = capturedScopes[0]!;
    expect(capturedScopes[1]!.text).toBe('if first == 1 {}');
    const alternatives = chain.childrenForFieldName('alternative');
    expect(alternatives).toHaveLength(3);
    expect(alternatives.every((node) => node.type === 'else_clause')).toBe(true);
    expect(alternatives.map((node) => node.childForFieldName('condition')?.text)).toEqual([
      'let Some(second) = input && second < 0',
      'input.is_none()',
      undefined,
    ]);
    expect(alternatives.map((node) => node.childForFieldName('consequence')?.text.trim())).toEqual([
      '{\n      negative(second);\n    }',
      '{\n      missing();\n    }',
      '{\n      zero();\n    }',
    ]);
    expect(branches.captures(tree.rootNode).map(({ name, node }) => [name, node.text.trim()])).toEqual([
      ['condition', 'let Some(second) = input && second < 0'],
      ['body', '{\n      negative(second);\n    }'],
      ['condition', 'input.is_none()'],
      ['body', '{\n      missing();\n    }'],
    ]);
  } finally {
    branches.delete();
    scopes.delete();
    tree.delete();
    parser.delete();
  }
});

test.each(['if true {} else {} else {}', 'if true {} else {} else if false {}'])(
  'rejects a branch after the terminal else in %s',
  async (expression) => {
    await Parser.init();
    const parser = new Parser().setLanguage(await Language.load('tree-sitter-rust.wasm'));
    const tree = parser.parse(`fn main() { ${expression} }`)!;
    try {
      expect(tree.rootNode.hasError).toBe(true);
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);
