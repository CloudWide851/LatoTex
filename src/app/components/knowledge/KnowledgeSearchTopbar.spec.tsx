// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeSearchHit } from "../../../shared/types/app";
import { KnowledgeSearchTopbar } from "./KnowledgeSearchTopbar";

let mountedRoot: Root | null = null;

function hit(id: string, title: string): KnowledgeSearchHit {
  const anchor = { kind: "lines", value: "4-5", lineStart: 4, lineEnd: 5 };
  return {
    evidenceId: id,
    projectId: "project-1",
    itemId: `item-${id}`,
    title,
    relativePath: `notes/${title}.md`,
    sourceKind: "markdown",
    anchor,
    snippet: `${title} evidence excerpt`,
    score: 1,
    matchKinds: ["exact"],
    citation: {
      citationId: id,
      projectId: "project-1",
      itemId: `item-${id}`,
      title,
      relativePath: `notes/${title}.md`,
      sourceKind: "markdown",
      anchor,
      snippet: `${title} evidence excerpt`,
    },
  };
}

describe("KnowledgeSearchTopbar", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    if (mountedRoot) {
      await act(async () => mountedRoot?.unmount());
      mountedRoot = null;
    }
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("portals results, supports keyboard selection, and closes on Escape", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    const onSelectHit = vi.fn();
    const baseProps = {
      query: "evidence",
      hits: [hit("a", "Alpha"), hit("b", "Beta")],
      searching: false,
      errorMessage: null,
      deep: false,
      scope: "current" as const,
      scopeLoading: false,
      sourceFilter: "all" as const,
      statusFilter: "all" as const,
      busy: false,
      onQueryChange: vi.fn(),
      onDeepChange: vi.fn(),
      onScopeChange: vi.fn(),
      onSourceFilterChange: vi.fn(),
      onStatusFilterChange: vi.fn(),
      onSelectHit,
      onClearSelection: vi.fn(),
      onRefresh: vi.fn(),
      onImportPdf: vi.fn(),
      onImportLink: vi.fn(),
      onSyncZotero: vi.fn(),
      t: (key: any) => String(key),
    };

    await act(async () => root.render(<KnowledgeSearchTopbar {...baseProps} />));
    const input = container.querySelector<HTMLInputElement>("[role='combobox']");
    const listbox = document.body.querySelector("[role='listbox']");
    expect(listbox).not.toBeNull();
    expect(container.querySelector("[role='listbox']")).toBeNull();
    expect(listbox?.textContent).toContain("L4–5");

    await act(async () => input?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    await act(async () => input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onSelectHit).toHaveBeenCalledWith(expect.objectContaining({ evidenceId: "b" }));
    expect(document.body.querySelector("[role='listbox']")).toBeNull();

    await act(async () => input?.focus());
    expect(document.body.querySelector("[role='listbox']")).not.toBeNull();
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(document.body.querySelector("[role='listbox']")).toBeNull();
  });

  it("keeps the advanced filter portal interactive and closes on outside click", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    const onDeepChange = vi.fn();
    await act(async () => root.render(
      <KnowledgeSearchTopbar
        query=""
        hits={[]}
        searching={false}
        errorMessage={null}
        deep={false}
        scope="current"
        scopeLoading={false}
        sourceFilter="all"
        statusFilter="all"
        busy={false}
        onQueryChange={() => undefined}
        onDeepChange={onDeepChange}
        onScopeChange={() => undefined}
        onSourceFilterChange={() => undefined}
        onStatusFilterChange={() => undefined}
        onSelectHit={() => undefined}
        onClearSelection={() => undefined}
        onRefresh={() => undefined}
        onImportPdf={() => undefined}
        onImportLink={() => undefined}
        onSyncZotero={() => undefined}
        t={(key) => String(key)}
      />,
    ));
    const filterButton = container.querySelector<HTMLButtonElement>("button[aria-label='knowledge.advancedFilters']");
    await act(async () => filterButton?.click());
    const filtersDialog = document.body.querySelector<HTMLElement>("[role='dialog'][aria-label='knowledge.advancedFilters']");
    expect(filtersDialog?.id).toBe(filterButton?.getAttribute("aria-controls"));
    const checkbox = document.body.querySelector<HTMLInputElement>("input[type='checkbox']");
    expect(checkbox).not.toBeNull();
    await act(async () => checkbox?.click());
    expect(onDeepChange).toHaveBeenCalledWith(true);
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(document.body.querySelector("input[type='checkbox']")).toBeNull();
  });
});
