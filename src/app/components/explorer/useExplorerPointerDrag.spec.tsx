// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WORKSPACE_REFERENCE_DROP_EVENT,
  WORKSPACE_REFERENCE_TARGET_ATTR,
  type WorkspaceReferenceDropDetail,
} from "../../../shared/events/workspaceReferenceDrop";
import type { ResourceNode } from "../../../shared/types/app";
import { ExplorerTree } from "../ExplorerTree";

const TREE: ResourceNode[] = [
  {
    name: "sources",
    relativePath: "sources",
    kind: "directory",
    children: [
      { name: "paper.tex", relativePath: "sources/paper.tex", kind: "file", children: [] },
    ],
  },
  { name: "archive", relativePath: "archive", kind: "directory", children: [] },
];

function pointerEvent(type: string, init: PointerEventInit = {}): PointerEvent {
  const event = new window.PointerEvent(type, init);
  if (typeof event.pointerId !== "number") {
    Object.defineProperty(event, "pointerId", {
      configurable: true,
      value: init.pointerId ?? 7,
    });
  }
  return event;
}

async function emitPointer(target: EventTarget, type: string, clientX: number, clientY: number) {
  await act(async () => {
    target.dispatchEvent(pointerEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 7,
      clientX,
      clientY,
    }));
  });
}

async function renderTree(onAction = vi.fn().mockResolvedValue(undefined), projectId: string | null = "project-1") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ExplorerTree
        projectId={projectId}
        tree={TREE}
        selectedPath={null}
        onSelect={() => undefined}
        onAction={onAction}
        t={(key) => String(key)}
      />,
    );
  });
  return { container, onAction, root };
}

async function unmount(root: Root, container: HTMLElement) {
  await act(async () => {
    root.unmount();
  });
  container.remove();
}

describe("useExplorerPointerDrag lifecycle", () => {
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
    if (!("elementFromPoint" in document)) {
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => null,
      });
    }
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    vi.restoreAllMocks();
  });

  it("captures one pointer without changing body styles before the drag threshold", async () => {
    const { container, onAction, root } = await renderTree();
    const source = container.querySelector<HTMLElement>("[title='sources/paper.tex']");
    expect(source).not.toBeNull();
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.defineProperties(source!, {
      setPointerCapture: { configurable: true, value: setPointerCapture },
      releasePointerCapture: { configurable: true, value: releasePointerCapture },
    });
    document.body.style.cursor = "crosshair";
    document.body.style.userSelect = "text";

    await emitPointer(source!, "pointerdown", 10, 10);
    await emitPointer(window, "pointermove", 13, 13);

    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(document.body.style.cursor).toBe("crosshair");
    expect(document.body.style.userSelect).toBe("text");

    await emitPointer(window, "pointerup", 13, 13);

    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(onAction).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe("crosshair");
    expect(document.body.style.userSelect).toBe("text");
    await unmount(root, container);
  });

  it("restores body styles on window blur and ignores a late pointer release", async () => {
    const { container, onAction, root } = await renderTree();
    const source = container.querySelector<HTMLElement>("[title='sources/paper.tex']");
    const archive = container.querySelector<HTMLElement>("[title='archive']");
    vi.spyOn(document, "elementFromPoint").mockReturnValue(archive);
    document.body.style.cursor = "crosshair";
    document.body.style.userSelect = "text";

    await emitPointer(source!, "pointerdown", 10, 10);
    await emitPointer(window, "pointermove", 40, 40);
    expect(document.body.style.cursor).toBe("grabbing");
    expect(document.body.style.userSelect).toBe("none");

    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(document.body.style.cursor).toBe("crosshair");
    expect(document.body.style.userSelect).toBe("text");

    await emitPointer(window, "pointerup", 40, 40);
    expect(onAction).not.toHaveBeenCalled();
    await unmount(root, container);
  });

  it("cancels on pointercancel, lost capture, hidden document, and unmount", async () => {
    const cases: Array<{
      cancel: (source: HTMLElement) => Promise<void>;
      label: string;
    }> = [
      {
        label: "pointercancel",
        cancel: (source) => emitPointer(source, "pointercancel", 40, 40),
      },
      {
        label: "lostpointercapture",
        cancel: (source) => emitPointer(source, "lostpointercapture", 40, 40),
      },
      {
        label: "visibility hidden",
        cancel: async () => {
          vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
          await act(async () => {
            document.dispatchEvent(new Event("visibilitychange"));
          });
          vi.restoreAllMocks();
        },
      },
    ];

    for (const testCase of cases) {
      const onAction = vi.fn().mockResolvedValue(undefined);
      const { container, root } = await renderTree(onAction);
      const source = container.querySelector<HTMLElement>("[title='sources/paper.tex']")!;
      const archive = container.querySelector<HTMLElement>("[title='archive']")!;
      vi.spyOn(document, "elementFromPoint").mockReturnValue(archive);
      await emitPointer(source, "pointerdown", 10, 10);
      await emitPointer(window, "pointermove", 40, 40);
      await testCase.cancel(source);
      await emitPointer(window, "pointerup", 40, 40);
      expect(onAction, testCase.label).not.toHaveBeenCalled();
      expect(document.body.style.cursor, testCase.label).toBe("");
      expect(document.body.style.userSelect, testCase.label).toBe("");
      await unmount(root, container);
      vi.restoreAllMocks();
    }

    const onAction = vi.fn().mockResolvedValue(undefined);
    const { container, root } = await renderTree(onAction);
    const source = container.querySelector<HTMLElement>("[title='sources/paper.tex']")!;
    await emitPointer(source, "pointerdown", 10, 10);
    await emitPointer(window, "pointermove", 40, 40);
    await unmount(root, container);
    await emitPointer(window, "pointerup", 40, 40);
    expect(onAction).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  it("dispatches one workspace reference for a file but never for a folder", async () => {
    const referenceTarget = document.createElement("section");
    referenceTarget.setAttribute(WORKSPACE_REFERENCE_TARGET_ATTR, "analysis");
    document.body.appendChild(referenceTarget);
    const received: WorkspaceReferenceDropDetail[] = [];
    const onReferenceDrop = (event: Event) => {
      received.push((event as CustomEvent<WorkspaceReferenceDropDetail>).detail);
    };
    window.addEventListener(WORKSPACE_REFERENCE_DROP_EVENT, onReferenceDrop);
    const { container, onAction, root } = await renderTree();
    vi.spyOn(document, "elementFromPoint").mockReturnValue(referenceTarget);

    const file = container.querySelector<HTMLElement>("[title='sources/paper.tex']")!;
    await emitPointer(file, "pointerdown", 10, 10);
    await emitPointer(window, "pointermove", 40, 40);
    await emitPointer(window, "pointerup", 40, 40);

    expect(received).toEqual([{
      projectId: "project-1",
      scope: "workspace",
      paths: ["sources/paper.tex"],
    }]);
    expect(onAction).not.toHaveBeenCalled();

    const folder = container.querySelector<HTMLElement>("[title='sources']")!;
    await emitPointer(folder, "pointerdown", 10, 10);
    await emitPointer(window, "pointermove", 40, 40);
    await emitPointer(window, "pointerup", 40, 40);
    expect(received).toHaveLength(1);
    expect(onAction).not.toHaveBeenCalled();

    window.removeEventListener(WORKSPACE_REFERENCE_DROP_EVENT, onReferenceDrop);
    await unmount(root, container);
    referenceTarget.remove();
  });

  it("moves a file when the pointer lands on an SVG inside a directory row", async () => {
    const { container, onAction, root } = await renderTree();
    const file = container.querySelector<HTMLElement>("[title='sources/paper.tex']")!;
    const archive = container.querySelector<HTMLElement>("[title='archive']")!;
    const archiveIcon = archive.querySelector("svg");
    expect(archiveIcon).not.toBeNull();
    vi.spyOn(document, "elementFromPoint").mockReturnValue(archiveIcon);

    await emitPointer(file, "pointerdown", 10, 10);
    await emitPointer(window, "pointermove", 40, 40);
    await emitPointer(window, "pointerup", 40, 40);

    expect(onAction).toHaveBeenCalledWith(
      "move",
      "sources/paper.tex",
      "archive/paper.tex",
    );
    await unmount(root, container);
  });
});
