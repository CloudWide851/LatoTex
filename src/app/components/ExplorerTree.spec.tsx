// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
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

describe("ExplorerTree", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

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

  it("moves a library file into a directory when dropped on that folder", async () => {
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

    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      getData: (key: string) => {
        if (key === "application/x-latotex-path" || key === "text/plain") {
          return "papers/demo.bib";
        }
        return "";
      },
      setData: () => undefined,
    };

    await act(async () => {
      const event = new Event("dragover", { bubbles: true, cancelable: true }) as Event & { dataTransfer: typeof dataTransfer };
      event.dataTransfer = dataTransfer;
      archiveNode?.dispatchEvent(event);
    });

    await act(async () => {
      const event = new Event("drop", { bubbles: true, cancelable: true }) as Event & { dataTransfer: typeof dataTransfer };
      event.dataTransfer = dataTransfer;
      archiveNode?.dispatchEvent(event);
    });

    expect(onAction).toHaveBeenCalledWith("move", "papers/demo.bib", "archive/demo.bib");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("moves a library directory into another directory when dropped", async () => {
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

    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      getData: (key: string) => {
        if (key === "application/x-latotex-path" || key === "text/plain") {
          return "papers";
        }
        return "";
      },
      setData: () => undefined,
    };

    await act(async () => {
      const event = new Event("dragover", { bubbles: true, cancelable: true }) as Event & { dataTransfer: typeof dataTransfer };
      event.dataTransfer = dataTransfer;
      archiveNode?.dispatchEvent(event);
    });

    await act(async () => {
      const event = new Event("drop", { bubbles: true, cancelable: true }) as Event & { dataTransfer: typeof dataTransfer };
      event.dataTransfer = dataTransfer;
      archiveNode?.dispatchEvent(event);
    });

    expect(onAction).toHaveBeenCalledWith("move", "papers", "archive/papers");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("moves a workspace file into a directory when dropped on that folder", async () => {
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

    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      getData: (key: string) => {
        if (key === "application/x-latotex-path" || key === "text/plain") {
          return "papers/demo.bib";
        }
        return "";
      },
      setData: () => undefined,
    };

    await act(async () => {
      const event = new Event("dragover", { bubbles: true, cancelable: true }) as Event & { dataTransfer: typeof dataTransfer };
      event.dataTransfer = dataTransfer;
      archiveNode?.dispatchEvent(event);
    });

    await act(async () => {
      const event = new Event("drop", { bubbles: true, cancelable: true }) as Event & { dataTransfer: typeof dataTransfer };
      event.dataTransfer = dataTransfer;
      archiveNode?.dispatchEvent(event);
    });

    expect(onAction).toHaveBeenCalledWith("move", "papers/demo.bib", "archive/demo.bib");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("moves a workspace directory into another directory when dropped", async () => {
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

    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      getData: (key: string) => {
        if (key === "application/x-latotex-path" || key === "text/plain") {
          return "papers";
        }
        return "";
      },
      setData: () => undefined,
    };

    await act(async () => {
      const event = new Event("dragover", { bubbles: true, cancelable: true }) as Event & { dataTransfer: typeof dataTransfer };
      event.dataTransfer = dataTransfer;
      archiveNode?.dispatchEvent(event);
    });

    await act(async () => {
      const event = new Event("drop", { bubbles: true, cancelable: true }) as Event & { dataTransfer: typeof dataTransfer };
      event.dataTransfer = dataTransfer;
      archiveNode?.dispatchEvent(event);
    });

    expect(onAction).toHaveBeenCalledWith("move", "papers", "archive/papers");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("blocks invalid library directory drops into the same tree branch", async () => {
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

    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      getData: (key: string) => {
        if (key === "application/x-latotex-path" || key === "text/plain") {
          return "papers";
        }
        return "";
      },
      setData: () => undefined,
    };

    await act(async () => {
      const event = new Event("dragover", { bubbles: true, cancelable: true }) as Event & { dataTransfer: typeof dataTransfer };
      event.dataTransfer = dataTransfer;
      nestedNode?.dispatchEvent(event);
    });

    await act(async () => {
      const event = new Event("drop", { bubbles: true, cancelable: true }) as Event & { dataTransfer: typeof dataTransfer };
      event.dataTransfer = dataTransfer;
      nestedNode?.dispatchEvent(event);
    });

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
