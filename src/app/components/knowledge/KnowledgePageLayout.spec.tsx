// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeItem } from "../../../shared/types/app";
import { KnowledgePageLayout } from "./KnowledgePageLayout";

const apiMocks = vi.hoisted(() => ({
  expandKnowledgeGraph: vi.fn(),
  listKnowledgeItems: vi.fn(),
  reindexKnowledgeItem: vi.fn(),
  unarchiveKnowledgeItem: vi.fn(),
}));
const mountedRoots: Root[] = [];

vi.mock("../../../shared/api/knowledge", () => apiMocks);
vi.mock("../../../shared/api/projects", () => ({ listProjects: vi.fn(async () => []) }));
vi.mock("../workspace/LibraryExplorerPanel", () => ({
  LibraryExplorerPanel: () => <div data-testid="library-explorer" />,
}));
vi.mock("../workspace/workspaceShellLazy", () => ({
  WorkspacePanelFallback: (props: { label: string }) => <div>{props.label}</div>,
}));
vi.mock("../LibraryDocumentViewer", () => ({
  LibraryDocumentViewer: (props: { selectedPath: string }) => <div data-testid="document-viewer">{props.selectedPath}</div>,
}));
vi.mock("./KnowledgeEmbeddingBanner", () => ({ KnowledgeEmbeddingBanner: () => null }));
vi.mock("./KnowledgeEntryMenu", () => ({ KnowledgeEntryMenu: () => null }));
vi.mock("./KnowledgeFileGraphPanel", () => ({
  KnowledgeFileGraphPanel: (props: { item: KnowledgeItem }) => <div data-testid="graph-view">{props.item.title}</div>,
}));
vi.mock("./KnowledgeSearchTopbar", () => ({ KnowledgeSearchTopbar: () => <div data-testid="knowledge-topbar" /> }));
vi.mock("./useKnowledgeWorkbenchPrefs", () => ({
  useKnowledgeWorkbenchPrefs: () => ({
    knowledgePrefs: {
      semanticModelReminderEnabled: true,
      graph: { maxVisibleNodes: 40, showLabels: true },
    },
    searchScope: "current",
    selectSearchScope: vi.fn(),
  }),
}));
vi.mock("./useKnowledgeSearch", () => ({
  useKnowledgeSearch: () => ({
    embedding: null,
    errorMessage: null,
    hits: [],
    searching: false,
    setEmbeddingStatus: vi.fn(),
  }),
}));
vi.mock("./useKnowledgeRuntimePerformance", () => ({ useKnowledgeRuntimePerformance: () => undefined }));

function item(id: string, path: string): KnowledgeItem {
  return {
    itemId: id,
    projectId: "project-1",
    relativePath: `.latotex/papers/${path}`,
    title: path,
    sourceKind: "pdf",
    contentHash: id,
    indexState: "ready",
    chunkCount: 4,
    locked: false,
    updatedAt: "2026-08-11T00:00:00Z",
  };
}

function props(selectedLibraryPath: string | null) {
  return {
    projectId: "project-1",
    busy: false,
    layout: [30, 70],
    libraryTree: [],
    selectedLibraryPath,
    analysisRunning: false,
    libraryViewMode: null,
    translationModelId: null,
    paperBriefEngine: "auto" as const,
    libraryBibLayout: [50, 50],
    libraryExplorerDefaultExpanded: true,
    libraryExplorerScrollbarVisible: true,
    onLibraryExplorerExpandedPathsChange: vi.fn(),
    onLayout: vi.fn(),
    onBibLayoutChange: vi.fn(),
    onSelectLibraryPath: vi.fn(),
    onOpenWorkspaceSource: vi.fn(),
    onProjectChange: vi.fn(),
    onOpenPlugins: vi.fn(),
    onFsAction: vi.fn(async () => true),
    onLibraryRescan: vi.fn(),
    onLibraryImportPdf: vi.fn(),
    onLibraryImportLink: vi.fn(),
    onLibrarySyncZotero: vi.fn(),
    onLibraryAnalyzePaper: vi.fn(),
    onLibraryViewModeChange: vi.fn(),
    t: (key: any) => String(key),
  };
}

describe("KnowledgePageLayout", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    apiMocks.listKnowledgeItems.mockResolvedValue([item("a", "paper.bib"), item("b", "other.bib")]);
    apiMocks.expandKnowledgeGraph.mockResolvedValue({ nodes: [], edges: [], aggregated: false, totalNodes: 0 });
    apiMocks.reindexKnowledgeItem.mockResolvedValue({});
    apiMocks.unarchiveKnowledgeItem.mockResolvedValue({ ok: true });
  });

  afterEach(async () => {
    for (const root of mountedRoots.splice(0)) {
      await act(async () => root.unmount());
    }
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("does not request a graph until the selected file graph tab is activated", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push(root);
    await act(async () => {
      root.render(<KnowledgePageLayout {...props("paper.bib")} />);
      await Promise.resolve();
    });
    expect(apiMocks.expandKnowledgeGraph).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid='document-viewer']")?.textContent).toBe("paper.bib");

    const graphButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "knowledge.graph");
    await act(async () => {
      graphButton?.click();
      await Promise.resolve();
    });
    expect(apiMocks.expandKnowledgeGraph).toHaveBeenCalledTimes(1);
    expect(apiMocks.expandKnowledgeGraph).toHaveBeenCalledWith(expect.objectContaining({ itemId: "a" }));
    expect(container.querySelector("[data-testid='graph-view']")?.textContent).toBe("paper.bib");

    await act(async () => {
      root.render(<KnowledgePageLayout {...props("other.bib")} />);
      await Promise.resolve();
    });
    expect(apiMocks.expandKnowledgeGraph).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-testid='document-viewer']")?.textContent).toBe("other.bib");
  });

  it("keeps the empty state to one import action and never requests a graph", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push(root);
    const inputProps = props(null);
    await act(async () => {
      root.render(<KnowledgePageLayout {...inputProps} />);
      await Promise.resolve();
    });
    const importButtons = Array.from(container.querySelectorAll("button"))
      .filter((button) => button.textContent === "knowledge.importFirst");
    expect(importButtons).toHaveLength(1);
    expect(apiMocks.expandKnowledgeGraph).not.toHaveBeenCalled();
  });

  it("explains why Graph is unavailable for an unindexed library file", async () => {
    apiMocks.listKnowledgeItems.mockResolvedValue([]);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push(root);
    await act(async () => {
      root.render(<KnowledgePageLayout {...props("unindexed.bib")} />);
      await Promise.resolve();
    });

    const graphButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "knowledge.graph");
    expect(graphButton?.disabled).toBe(true);
    expect(container.querySelector("button[aria-label='knowledge.graph']")).not.toBeNull();
    expect(apiMocks.expandKnowledgeGraph).not.toHaveBeenCalled();
  });
});
