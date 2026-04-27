import type { FsAction, ResourceNode } from "../../shared/types/app";

function normalizePath(path: string | null | undefined): string {
  return String(path ?? "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function dirname(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : "";
}

function basename(path: string): string {
  const normalized = normalizePath(path);
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

function sortNodes(nodes: ResourceNode[]): ResourceNode[] {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "directory" ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

function rewriteNodePath(node: ResourceNode, sourcePath: string, targetPath: string): ResourceNode {
  const normalizedNodePath = normalizePath(node.relativePath);
  const normalizedSource = normalizePath(sourcePath);
  const normalizedTarget = normalizePath(targetPath);
  const nextPath = normalizedNodePath === normalizedSource
    ? normalizedTarget
    : normalizedNodePath.startsWith(`${normalizedSource}/`)
      ? `${normalizedTarget}${normalizedNodePath.slice(normalizedSource.length)}`
      : normalizedNodePath;
  return {
    ...node,
    relativePath: nextPath,
    name: basename(nextPath),
    children: node.children.map((child) => rewriteNodePath(child, normalizedSource, normalizedTarget)),
  };
}

function removeNode(nodes: ResourceNode[], path: string): { nodes: ResourceNode[]; removed: ResourceNode | null } {
  const normalizedPath = normalizePath(path);
  let removed: ResourceNode | null = null;
  const nextNodes: ResourceNode[] = [];
  for (const node of nodes) {
    if (normalizePath(node.relativePath) === normalizedPath) {
      removed = node;
      continue;
    }
    if (node.children.length > 0) {
      const childResult = removeNode(node.children, normalizedPath);
      if (childResult.removed) {
        removed = childResult.removed;
        nextNodes.push({ ...node, children: childResult.nodes });
        continue;
      }
    }
    nextNodes.push(node);
  }
  return { nodes: nextNodes, removed };
}

function buildParentChain(parentPath: string, child: ResourceNode): ResourceNode {
  const normalizedParent = normalizePath(parentPath);
  const parentParent = dirname(normalizedParent);
  const node: ResourceNode = {
    name: basename(normalizedParent),
    relativePath: normalizedParent,
    kind: "directory",
    children: [child],
  };
  return parentParent ? buildParentChain(parentParent, node) : node;
}

function insertNode(nodes: ResourceNode[], nodeToInsert: ResourceNode, parentPath: string): { nodes: ResourceNode[]; inserted: boolean } {
  const normalizedParent = normalizePath(parentPath);
  if (!normalizedParent) {
    return { nodes: sortNodes([...nodes, nodeToInsert]), inserted: true };
  }
  let inserted = false;
  const nextNodes = nodes.map((node) => {
    if (node.kind === "directory" && normalizePath(node.relativePath) === normalizedParent) {
      inserted = true;
      return { ...node, children: sortNodes([...node.children, nodeToInsert]) };
    }
    if (node.children.length === 0) {
      return node;
    }
    const childResult = insertNode(node.children, nodeToInsert, normalizedParent);
    if (childResult.inserted) {
      inserted = true;
      return { ...node, children: childResult.nodes };
    }
    return node;
  });
  return { nodes: nextNodes, inserted };
}

function upsertNode(nodes: ResourceNode[], nodeToInsert: ResourceNode, parentPath: string): ResourceNode[] {
  const normalizedParent = normalizePath(parentPath);
  const withoutDuplicate = removeNode(nodes, nodeToInsert.relativePath).nodes;
  const result = insertNode(withoutDuplicate, nodeToInsert, normalizedParent);
  if (result.inserted) {
    return result.nodes;
  }
  return sortNodes([...withoutDuplicate, buildParentChain(normalizedParent, nodeToInsert)]);
}

function createNode(path: string, kind: ResourceNode["kind"]): ResourceNode {
  const normalizedPath = normalizePath(path);
  return {
    name: basename(normalizedPath),
    relativePath: normalizedPath,
    kind,
    children: [],
  };
}

export function applyOptimisticFsAction(input: {
  tree: ResourceNode[];
  action: FsAction;
  path: string;
  targetPath?: string;
}): ResourceNode[] {
  const path = normalizePath(input.path);
  const targetPath = normalizePath(input.targetPath);
  if (!path) {
    return input.tree;
  }

  if (input.action === "delete") {
    return removeNode(input.tree, path).nodes;
  }

  if (input.action === "create_file") {
    return upsertNode(input.tree, createNode(path, "file"), dirname(path));
  }

  if (input.action === "create_folder") {
    return upsertNode(input.tree, createNode(path, "directory"), dirname(path));
  }

  if ((input.action === "rename" || input.action === "move" || input.action === "copy") && targetPath) {
    const source = removeNode(input.tree, path);
    if (!source.removed) {
      return input.tree;
    }
    const nextNode = rewriteNodePath(source.removed, path, targetPath);
    return upsertNode(input.action === "copy" ? input.tree : source.nodes, nextNode, dirname(targetPath));
  }

  return input.tree;
}
