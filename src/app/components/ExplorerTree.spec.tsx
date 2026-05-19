// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExplorerTree } from "./ExplorerTree";
import type { ResourceNode } from "../../shared/types/app";

const TREE: ResourceNode[] = [
  { name: "a.tex", relativePath: "a.tex", kind: "file", children: [] },
  { name: "b.tex", relativePath: "b.tex", kind: "file", children: [] },
  { name: "c.tex", relativePath: "c.tex", kind: "file", children: [] },
];

const LIBRARY_TREE: ResourceNode[] = [
  {
    name: "papers",
    relativePath: "papers",
    kind: "directory",
    children: [
      { name: "demo.bib", relativePath: "papers/demo.bib", kind: "file", children: [] },
      {
        name: "nested",
        relativePath: "papers/nested",
        kind: "directory",
        children: [],
      },
    ],
  },
  {
    name: "archive",
    relativePath: "archive",
    kind: "directory",
    children: [],
  },
];

const LIBRARY_TREE_AFTER_MOVE: ResourceNode[] = [
  {
    name: "papers",
    relativePath: "papers",
    kind: "directory",
    children: [
      {
        name: "nested",
        relativePath: "papers/nested",
        kind: "directory",
        children: [],
      },
    ],
  },
  {
    name: "archive",
    relativePath: "archive",
    kind: "directory",
    children: [
      { name: "demo.bib", relativePath: "archive/demo.bib", kind: "file", children: [] },
    ],
  },
];

function MoveVisibilityHarness() {
  const [tree, setTree] = useState<ResourceNode[]>(LIBRARY_TREE);
  const [selectedPath, setSelectedPath] = useState<string | null>("papers/demo.bib");

  return (
    <ExplorerTree
      mode="library"
      tree={tree}
      selectedPath={selectedPath}
      onSelect={setSelectedPath}
      onAction={async (action, path, targetPath) => {
        if (action !== "move" || path !== "papers/demo.bib" || targetPath !== "archive/demo.bib") {
          return false;
        }
        setTree(LIBRARY_TREE_AFTER_MOVE);
        setSelectedPath("archive/demo.bib");
        return true;
      }}
      t={(key) => String(key)}
    />
  );
}

function ControlledExpansionHarness() {
  const [expandedPaths, setExpandedPaths] = useState<string[]>([]);
  return (
    <ExplorerTree
      mode="library"
      tree={LIBRARY_TREE}
      selectedPath={null}
      expandedPaths={expandedPaths}
      onExpandedPathsChange={setExpandedPaths}
      onSelect={() => undefined}
      t={(key) => String(key)}
    />
  );
}

describe("ExplorerTree", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    if (!("PointerEvent" in window)) {
      Object.defineProperty(window, "PointerEvent", {
        configurable: true,
        value: MouseEvent,
      });
    }
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  async function dragNode(source: Element | null | undefined, target: Element | null | undefined) {
    expect(source).toBeTruthy();
    expect(target).toBeTruthy();
    if (!("elementFromPoint" in document)) {
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => target as Element,
      });
    }
    const elementFromPoint = vi.spyOn(document, "elementFromPoint");
    elementFromPoint.mockImplementation(() => target as Element);

    await act(async () => {
      source?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientX: 12, clientY: 14 }));
    });

    await act(async () => {
      window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, button: 0, clientX: 36, clientY: 52 }));
    });

    await act(async () => {
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0, clientX: 36, clientY: 52 }));
    });
  }

  it("supports ctrl and shift file multi-selection without turning directories into active files", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSelect = vi.fn();

    await act(async () => {
      root.render(
        <ExplorerTree
          tree={TREE}
          selectedPath={null}
          onSelect={onSelect}
          t={(key) => String(key)}
        />,
      );
    });

    const rows = Array.from(container.querySelectorAll("[data-explorer-node='true']"));
    const [first, second, third] = rows;

    await act(async () => {
      first?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(first?.getAttribute("aria-selected")).toBe("true");

    await act(async () => {
      second?.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    });
    expect(first?.getAttribute("aria-selected")).toBe("true");
    expect(second?.getAttribute("aria-selected")).toBe("true");

    await act(async () => {
      third?.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    });
    expect(first?.getAttribute("aria-selected")).toBe("false");
    expect(second?.getAttribute("aria-selected")).toBe("true");
    expect(third?.getAttribute("aria-selected")).toBe("true");
    expect(onSelect).toHaveBeenLastCalledWith("c.tex");
  });

  it("allows creating library folders from the root context menu", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onAction = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <ExplorerTree
          mode="library"
          tree={TREE}
          selectedPath={null}
          onSelect={() => undefined}
          onAction={onAction}
          t={(key) => String(key)}
        />,
      );
    });

    await act(async () => {
      container.firstElementChild?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 20 }));
    });

    const newFolderButton = Array.from(document.querySelectorAll("button")).find(
      (node) => node.textContent === "explorer.action.newFolder",
    );
    expect(newFolderButton).toBeTruthy();

    await act(async () => {
      newFolderButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const input = container.querySelector("input");
    expect(input).not.toBeNull();

    await act(async () => {
      if (input) {
        input.dispatchEvent(new Event("focus", { bubbles: true }));
        input.value = "papers";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });

    await act(async () => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(onAction).toHaveBeenCalledWith("create_folder", "papers");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("moves a library file into a directory through pointer dragging", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onAction = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <ExplorerTree
          mode="library"
          tree={LIBRARY_TREE}
          selectedPath={null}
          onSelect={() => undefined}
          onAction={onAction}
          t={(key) => String(key)}
        />,
      );
    });

    const nodes = Array.from(container.querySelectorAll("[data-explorer-node='true']"));
    const archiveNode = nodes.find((node) => node.getAttribute("title") === "archive");
    expect(archiveNode).toBeTruthy();

    const fileNode = nodes.find((node) => node.getAttribute("title") === "papers/demo.bib");
    await dragNode(fileNode, archiveNode);

    expect(onAction).toHaveBeenCalledWith("move", "papers/demo.bib", "archive/demo.bib");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("keeps directories collapsed when defaultExpanded is false", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ExplorerTree
          mode="library"
          tree={LIBRARY_TREE}
          selectedPath={null}
          defaultExpanded={false}
          onSelect={() => undefined}
          t={(key) => String(key)}
        />,
      );
    });

    expect(container.querySelector("[title='papers/demo.bib']")).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("reports persisted expanded paths after folder toggles", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onExpandedPathsChange = vi.fn();

    await act(async () => {
      root.render(
        <ExplorerTree
          mode="library"
          tree={LIBRARY_TREE}
          selectedPath={null}
          defaultExpanded={false}
          onSelect={() => undefined}
          onExpandedPathsChange={onExpandedPathsChange}
          t={(key) => String(key)}
        />,
      );
    });

    const papersNode = container.querySelector("[title='papers']");
    await act(async () => {
      papersNode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onExpandedPathsChange).toHaveBeenLastCalledWith(["papers"]);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("treats controlled expandedPaths as the only expanded directory set", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ExplorerTree
          mode="library"
          tree={LIBRARY_TREE}
          selectedPath={null}
          expandedPaths={[]}
          onExpandedPathsChange={() => undefined}
          onSelect={() => undefined}
          t={(key) => String(key)}
        />,
      );
    });

    expect(container.querySelector("[title='papers/demo.bib']")).toBeNull();
    expect(container.querySelector("[title='papers/nested']")).toBeNull();
    expect(container.querySelector("[title='archive']")).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("collapses only the clicked controlled directory after reopening it", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<ControlledExpansionHarness />);
    });

    const papersNode = () => container.querySelector("[title='papers']");
    const archiveNode = () => container.querySelector("[title='archive']");

    await act(async () => {
      papersNode()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector("[title='papers/demo.bib']")).not.toBeNull();

    await act(async () => {
      archiveNode()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector("[title='papers/demo.bib']")).not.toBeNull();

    await act(async () => {
      papersNode()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector("[title='papers/demo.bib']")).toBeNull();
    expect(archiveNode()).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("moves a library directory into another directory through pointer dragging", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onAction = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <ExplorerTree
          mode="library"
          tree={LIBRARY_TREE}
          selectedPath={null}
          onSelect={() => undefined}
          onAction={onAction}
          t={(key) => String(key)}
        />,
      );
    });

    const nodes = Array.from(container.querySelectorAll("[data-explorer-node='true']"));
    const papersNode = nodes.find((node) => node.getAttribute("title") === "papers");
    const archiveNode = nodes.find((node) => node.getAttribute("title") === "archive");
    expect(papersNode).toBeTruthy();
    expect(archiveNode).toBeTruthy();

    await dragNode(papersNode, archiveNode);

    expect(onAction).toHaveBeenCalledWith("move", "papers", "archive/papers");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("moves a workspace file into a directory through pointer dragging", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onAction = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <ExplorerTree
          tree={LIBRARY_TREE}
          selectedPath={null}
          onSelect={() => undefined}
          onAction={onAction}
          t={(key) => String(key)}
        />,
      );
    });

    const nodes = Array.from(container.querySelectorAll("[data-explorer-node='true']"));
    const archiveNode = nodes.find((node) => node.getAttribute("title") === "archive");
    expect(archiveNode).toBeTruthy();

    const fileNode = nodes.find((node) => node.getAttribute("title") === "papers/demo.bib");
    await dragNode(fileNode, archiveNode);

    expect(onAction).toHaveBeenCalledWith("move", "papers/demo.bib", "archive/demo.bib");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("moves a workspace directory into another directory through pointer dragging", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onAction = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <ExplorerTree
          tree={LIBRARY_TREE}
          selectedPath={null}
          onSelect={() => undefined}
          onAction={onAction}
          t={(key) => String(key)}
        />,
      );
    });

    const nodes = Array.from(container.querySelectorAll("[data-explorer-node='true']"));
    const archiveNode = nodes.find((node) => node.getAttribute("title") === "archive");
    expect(archiveNode).toBeTruthy();

    const papersNode = nodes.find((node) => node.getAttribute("title") === "papers");
    await dragNode(papersNode, archiveNode);

    expect(onAction).toHaveBeenCalledWith("move", "papers", "archive/papers");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("keeps an active drag session alive across rerenders", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onAction = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <ExplorerTree
          tree={LIBRARY_TREE}
          selectedPath={null}
          busy={false}
          onSelect={() => undefined}
          onAction={onAction}
          t={(key) => String(key)}
        />,
      );
    });

    const nodes = Array.from(container.querySelectorAll("[data-explorer-node='true']"));
    const archiveNode = nodes.find((node) => node.getAttribute("title") === "archive");
    const fileNode = nodes.find((node) => node.getAttribute("title") === "papers/demo.bib");
    expect(fileNode).toBeTruthy();
    expect(archiveNode).toBeTruthy();

    const elementFromPoint = vi.spyOn(document, "elementFromPoint");
    elementFromPoint.mockImplementation(() => archiveNode as Element);

    await act(async () => {
      fileNode?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientX: 12, clientY: 14 }));
    });

    await act(async () => {
      root.render(
        <ExplorerTree
          tree={LIBRARY_TREE}
          selectedPath={null}
          busy
          onSelect={() => undefined}
          onAction={onAction}
          t={(key) => String(key)}
        />,
      );
    });

    await act(async () => {
      window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, button: 0, clientX: 36, clientY: 52 }));
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0, clientX: 36, clientY: 52 }));
    });

    expect(onAction).toHaveBeenCalledWith("move", "papers/demo.bib", "archive/demo.bib");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("keeps the drop target expanded so the moved entry stays visible after rerender", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<MoveVisibilityHarness />);
    });

    const nodes = Array.from(container.querySelectorAll("[data-explorer-node='true']"));
    const archiveNode = nodes.find((node) => node.getAttribute("title") === "archive");
    const fileNode = nodes.find((node) => node.getAttribute("title") === "papers/demo.bib");
    expect(fileNode).toBeTruthy();
    expect(archiveNode).toBeTruthy();

    await dragNode(fileNode, archiveNode);

    const movedNode = Array.from(container.querySelectorAll("[data-explorer-node='true']")).find(
      (node) => node.getAttribute("title") === "archive/demo.bib",
    );
    expect(movedNode).toBeTruthy();
    expect(movedNode?.getAttribute("aria-selected")).toBe("true");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("does not duplicate a moved node after the parent tree updates optimistically", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<MoveVisibilityHarness />);
    });

    const nodes = Array.from(container.querySelectorAll("[data-explorer-node='true']"));
    const archiveNode = nodes.find((node) => node.getAttribute("title") === "archive");
    const fileNode = nodes.find((node) => node.getAttribute("title") === "papers/demo.bib");
    expect(fileNode).toBeTruthy();
    expect(archiveNode).toBeTruthy();

    await dragNode(fileNode, archiveNode);

    const movedNode = Array.from(container.querySelectorAll("[data-explorer-node='true']")).find(
      (node) => node.getAttribute("title") === "archive/demo.bib",
    );
    const originalNode = Array.from(container.querySelectorAll("[data-explorer-node='true']")).find(
      (node) => node.getAttribute("title") === "papers/demo.bib",
    );
    const movedNodes = Array.from(container.querySelectorAll("[data-explorer-node='true']")).filter(
      (node) => node.getAttribute("title") === "archive/demo.bib",
    );
    expect(movedNodes).toHaveLength(1);
    expect(originalNode).toBeUndefined();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("blocks invalid library directory drops into the same tree branch during pointer dragging", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onAction = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <ExplorerTree
          mode="library"
          tree={LIBRARY_TREE}
          selectedPath={null}
          onSelect={() => undefined}
          onAction={onAction}
          t={(key) => String(key)}
        />,
      );
    });

    const nodes = Array.from(container.querySelectorAll("[data-explorer-node='true']"));
    const nestedNode = nodes.find((node) => node.getAttribute("title") === "papers/nested");
    expect(nestedNode).toBeTruthy();

    const papersNode = nodes.find((node) => node.getAttribute("title") === "papers");
    await dragNode(papersNode, nestedNode);

    expect(onAction).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("hides move and keeps delete actions for library files and folders in the context menu", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onAction = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <ExplorerTree
          mode="library"
          tree={LIBRARY_TREE}
          selectedPath={null}
          onSelect={() => undefined}
          onAction={onAction}
          t={(key) => String(key)}
        />,
      );
    });

    const nodes = Array.from(container.querySelectorAll("[data-explorer-node='true']"));
    const fileNode = nodes.find((node) => node.getAttribute("title") === "papers/demo.bib");
    const directoryNode = nodes.find((node) => node.getAttribute("title") === "archive");
    expect(fileNode).toBeTruthy();
    expect(directoryNode).toBeTruthy();

    await act(async () => {
      fileNode?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 40, clientY: 40 }));
    });

    expect(Array.from(document.querySelectorAll("button")).some((node) => node.textContent === "explorer.action.move")).toBe(false);
    expect(Array.from(document.querySelectorAll("button")).some((node) => node.textContent === "explorer.action.delete")).toBe(true);

    const deleteButton = Array.from(document.querySelectorAll("button")).find(
      (node) => node.textContent === "explorer.action.delete",
    );
    await act(async () => {
      deleteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onAction).toHaveBeenCalledWith("delete", "papers/demo.bib");

    await act(async () => {
      directoryNode?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 48, clientY: 56 }));
    });

    expect(Array.from(document.querySelectorAll("button")).some((node) => node.textContent === "explorer.action.move")).toBe(false);
    expect(Array.from(document.querySelectorAll("button")).some((node) => node.textContent === "explorer.action.delete")).toBe(true);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
