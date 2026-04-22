import type { ResourceNode } from "../../../shared/types/app";
import { dirnameOf } from "./treeUtils";

export type PendingMove = {
  sourcePath: string;
  targetPath: string;
};

export function normalizeExplorerPath(path: string | null | undefined): string {
  return String(path ?? "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

export function rewritePathAfterMove(path: string | null, sourcePath: string, targetPath: string): string | null {
  const normalizedPath = normalizeExplorerPath(path);
  const normalizedSource = normalizeExplorerPath(sourcePath);
  const normalizedTarget = normalizeExplorerPath(targetPath);
  if (!normalizedPath || !normalizedSource || !normalizedTarget) {
    return path;
  }
  if (normalizedPath === normalizedSource) {
    return normalizedTarget;
  }
  if (normalizedPath.startsWith(`${normalizedSource}/`)) {
    return `${normalizedTarget}${normalizedPath.slice(normalizedSource.length)}`;
  }
  return path;
}

export function rewriteExpandedAfterMove(
  previous: Record<string, boolean>,
  sourcePath: string,
  targetPath: string,
): Record<string, boolean> {
  const normalizedSource = normalizeExplorerPath(sourcePath);
  const normalizedTarget = normalizeExplorerPath(targetPath);
  const nextExpanded: Record<string, boolean> = {};
  for (const [path, expanded] of Object.entries(previous)) {
    const rewrittenPath = rewritePathAfterMove(path, normalizedSource, normalizedTarget);
    if (!rewrittenPath) {
      continue;
    }
    nextExpanded[rewrittenPath] = expanded;
  }
  const targetDirectory = dirnameOf(normalizedTarget);
  if (targetDirectory) {
    nextExpanded[targetDirectory] = true;
  }
  return nextExpanded;
}

function rewriteNodeRelativePath(node: ResourceNode, sourcePath: string, targetPath: string): ResourceNode {
  const rewrittenPath = rewritePathAfterMove(node.relativePath, sourcePath, targetPath) ?? node.relativePath;
  return {
    ...node,
    relativePath: rewrittenPath,
    name: rewrittenPath.split("/").pop() ?? node.name,
    children: node.children.map((child) => rewriteNodeRelativePath(child, sourcePath, targetPath)),
  };
}

export function hasTreePath(nodes: ResourceNode[], targetPath: string): boolean {
  const normalizedTarget = normalizeExplorerPath(targetPath);
  if (!normalizedTarget) {
    return false;
  }
  for (const node of nodes) {
    if (normalizeExplorerPath(node.relativePath) === normalizedTarget) {
      return true;
    }
    if (node.children.length > 0 && hasTreePath(node.children, normalizedTarget)) {
      return true;
    }
  }
  return false;
}

function removeNodeByPath(
  nodes: ResourceNode[],
  targetPath: string,
): { nextNodes: ResourceNode[]; removedNode: ResourceNode | null } {
  const normalizedTarget = normalizeExplorerPath(targetPath);
  let removedNode: ResourceNode | null = null;
  const nextNodes: ResourceNode[] = [];
  for (const node of nodes) {
    const normalizedPath = normalizeExplorerPath(node.relativePath);
    if (normalizedPath === normalizedTarget) {
      removedNode = node;
      continue;
    }
    if (removedNode) {
      nextNodes.push(node);
      continue;
    }
    if (node.children.length === 0) {
      nextNodes.push(node);
      continue;
    }
    const result = removeNodeByPath(node.children, normalizedTarget);
    if (result.removedNode) {
      removedNode = result.removedNode;
      nextNodes.push({ ...node, children: result.nextNodes });
      continue;
    }
    nextNodes.push(node);
  }
  return { nextNodes, removedNode };
}

function insertNodeIntoTree(nodes: ResourceNode[], nodeToInsert: ResourceNode, targetDirectoryPath: string): ResourceNode[] {
  const normalizedTargetDirectory = normalizeExplorerPath(targetDirectoryPath);
  if (!normalizedTargetDirectory) {
    return [...nodes, nodeToInsert];
  }
  return nodes.map((node) => {
    if (normalizeExplorerPath(node.relativePath) === normalizedTargetDirectory && node.kind === "directory") {
      return { ...node, children: [...node.children, nodeToInsert] };
    }
    if (node.children.length === 0) {
      return node;
    }
    return { ...node, children: insertNodeIntoTree(node.children, nodeToInsert, normalizedTargetDirectory) };
  });
}

function applyPendingMove(nodes: ResourceNode[], move: PendingMove): ResourceNode[] {
  const normalizedSource = normalizeExplorerPath(move.sourcePath);
  const normalizedTarget = normalizeExplorerPath(move.targetPath);
  if (!normalizedSource || !normalizedTarget || normalizedSource === normalizedTarget) {
    return nodes;
  }
  const withoutSource = removeNodeByPath(nodes, normalizedSource);
  if (!withoutSource.removedNode) {
    return nodes;
  }
  const withoutTargetDuplicate = removeNodeByPath(withoutSource.nextNodes, normalizedTarget).nextNodes;
  const movedNode = rewriteNodeRelativePath(withoutSource.removedNode, normalizedSource, normalizedTarget);
  return insertNodeIntoTree(withoutTargetDuplicate, movedNode, dirnameOf(normalizedTarget));
}

export function applyPendingMoves(nodes: ResourceNode[], pendingMoves: PendingMove[]): ResourceNode[] {
  return pendingMoves.reduce((currentNodes, move) => applyPendingMove(currentNodes, move), nodes);
}
