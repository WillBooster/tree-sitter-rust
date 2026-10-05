import { type Node, type Point } from '@willbooster/web-tree-sitter';

export function position(source: string, index: number): Point {
  const lines = source.slice(0, index).split('\n');
  return { row: lines.length - 1, column: lines.at(-1)!.length };
}

export function snapshot(node: Node): unknown {
  return {
    type: node.type,
    named: node.isNamed,
    extra: node.isExtra,
    missing: node.isMissing,
    hasError: node.hasError,
    start: node.startIndex,
    end: node.endIndex,
    startPosition: node.startPosition,
    endPosition: node.endPosition,
    fields: node.children.map((_, index) => node.fieldNameForChild(index)),
    children: node.children.map(snapshot),
  };
}
