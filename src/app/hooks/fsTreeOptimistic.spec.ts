import { describe, expect, it } from "vitest";
import type { ResourceNode } from "../../shared/types/app";
import { applyOptimisticFsAction } from "./fsTreeOptimistic";

const baseTree: ResourceNode[] = [
  {
    name: "src",
    relativePath: "src",
    kind: "directory",
    children: [
      {
        name: "main.tex",
        relativePath: "src/main.tex",
        kind: "file",
        children: [],
      },
    ],
  },
];

describe("applyOptimisticFsAction", () => {
  it("moves a subtree and rewrites child paths immediately", () => {
    const next = applyOptimisticFsAction({
      tree: baseTree,
      action: "move",
      path: "src",
      targetPath: "archive/src",
    });

    expect(next[0]?.relativePath).toBe("archive");
    expect(next[0]?.children[0]?.relativePath).toBe("archive/src");
    expect(next[0]?.children[0]?.children[0]?.relativePath).toBe("archive/src/main.tex");
  });

  it("creates and deletes nodes without waiting for a backend tree refresh", () => {
    const withFolder = applyOptimisticFsAction({
      tree: [],
      action: "create_folder",
      path: "notes",
    });
    const withFile = applyOptimisticFsAction({
      tree: withFolder,
      action: "create_file",
      path: "notes/todo.tex",
    });
    const afterDelete = applyOptimisticFsAction({
      tree: withFile,
      action: "delete",
      path: "notes/todo.tex",
    });

    expect(withFile[0]?.children[0]?.relativePath).toBe("notes/todo.tex");
    expect(afterDelete[0]?.children).toHaveLength(0);
  });

  it("moves a root file into a folder without leaving a duplicate root node", () => {
    const tree: ResourceNode[] = [
      { name: ".editorconfig", relativePath: ".editorconfig", kind: "file", children: [] },
      { name: "测试文件夹", relativePath: "测试文件夹", kind: "directory", children: [] },
    ];
    const next = applyOptimisticFsAction({
      tree,
      action: "move",
      path: ".editorconfig",
      targetPath: "测试文件夹/.editorconfig",
    });

    const rootEditorconfigs = next.filter((node) => node.relativePath === ".editorconfig");
    const folder = next.find((node) => node.relativePath === "测试文件夹");
    expect(rootEditorconfigs).toHaveLength(0);
    expect(folder?.children.filter((node) => node.relativePath === "测试文件夹/.editorconfig")).toHaveLength(1);
  });
});
