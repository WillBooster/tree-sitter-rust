import { type Node } from '@willbooster/web-tree-sitter';

export interface TaggedNode<Name extends string = string> {
  name: Name;
  node: Node;
}

export function fieldNodes(root: Node, parentTypes: string | string[], fieldName: string, childType?: string): Node[] {
  return root
    .descendantsOfType(parentTypes)
    .flatMap((parent) => parent.childrenForFieldName(fieldName).filter((child) => matchesChildType(child, childType)));
}

export function directChildren(root: Node, parentTypes: string | string[], childType?: string): Node[] {
  return root
    .descendantsOfType(parentTypes)
    .flatMap((parent) => parent.children.filter((child) => matchesChildType(child, childType)));
}

export function sortNodes(nodes: readonly Node[]): Node[] {
  return nodes.toSorted(compareNodes);
}

export function sortTaggedNodes<Name extends string>(items: readonly TaggedNode<Name>[]): TaggedNode<Name>[] {
  return items.toSorted((left, right) => compareNodes(left.node, right.node));
}

function matchesChildType(child: Node, childType?: string): boolean {
  return childType === undefined ? child.isNamed : child.type === childType;
}

function compareNodes(left: Node, right: Node): number {
  return left.startIndex - right.startIndex || left.endIndex - right.endIndex;
}
