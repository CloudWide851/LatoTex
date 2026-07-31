// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EmbeddingRuntimeStatus,
  KnowledgeSearchHit,
  KnowledgeSearchResponse,
} from "../../../shared/types/app";
import { useKnowledgeSearch } from "./useKnowledgeSearch";

const apiMocks = vi.hoisted(() => ({
  cancelKnowledgeSearch: vi.fn(),
  searchKnowledge: vi.fn(),
}));
const telemetryMocks = vi.hoisted(() => ({
  dispose: vi.fn(),
  record: vi.fn(),
}));
const mountedRoots: Root[] = [];

vi.mock("../../../shared/api/knowledge", () => apiMocks);
vi.mock("./knowledgeSearchPerformance", () => ({
  beginKnowledgeSearchTelemetry: () => telemetryMocks,
}));

const lexicalEmbedding: EmbeddingRuntimeStatus = {
  pluginId: "latotex.research.multilingual-e5-small",
  installed: true,
  available: true,
  modelFingerprint: "fixture",
  indexFingerprint: "fixture",
  rebuildRequired: false,
  mode: "hybrid",
};

function hit(evidenceId: string, title: string): KnowledgeSearchHit {
  return {
    evidenceId,
    projectId: "project-1",
    itemId: `item-${evidenceId}`,
    title,
    relativePath: `${title}.md`,
    sourceKind: "markdown",
    anchor: { kind: "lines", value: "1-2", lineStart: 1, lineEnd: 2 },
    snippet: `${title} evidence`,
    score: 1,
    matchKinds: ["exact"],
    citation: {
      citationId: evidenceId,
      projectId: "project-1",
      itemId: `item-${evidenceId}`,
      title,
      relativePath: `${title}.md`,
      sourceKind: "markdown",
      anchor: { kind: "lines", value: "1-2", lineStart: 1, lineEnd: 2 },
      snippet: `${title} evidence`,
    },
  };
}

function response(
  runId: string,
  hits: KnowledgeSearchHit[],
  embedding = lexicalEmbedding,
): KnowledgeSearchResponse {
  return {
    runId,
    hits,
    strategy: "exact+bm25",
    embedding,
    lexicalElapsedMs: 4,
    semanticElapsedMs: 0,
    elapsedMs: 5,
  };
}

function SearchProbe(props: { query: string }) {
  const search = useKnowledgeSearch({
    projectId: "project-1",
    projectIds: null,
    scope: "current",
    query: props.query,
    deep: false,
    onAcceptedResponse: () => undefined,
    onStart: () => undefined,
    t: (key) => String(key),
  });
  return (
    <output data-testid="state">
      {JSON.stringify({
        hits: search.hits.map((entry) => entry.title),
        searching: search.searching,
      })}
    </output>
  );
}

describe("useKnowledgeSearch", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    apiMocks.cancelKnowledgeSearch.mockResolvedValue({ ok: true, message: "cancelled" });
  });

  afterEach(async () => {
    for (const root of mountedRoots.splice(0)) {
      await act(async () => root.unmount());
    }
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it("shows lexical hits before accepting the hybrid result", async () => {
    let resolveHybrid: ((value: KnowledgeSearchResponse) => void) | null = null;
    const hybridPromise = new Promise<KnowledgeSearchResponse>((resolve) => {
      resolveHybrid = resolve;
    });
    apiMocks.searchKnowledge
      .mockImplementationOnce((input: { runId: string }) => (
        Promise.resolve(response(input.runId, [hit("lexical", "Lexical")]))
      ))
      .mockImplementationOnce(() => hybridPromise);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(async () => {
      root.render(<SearchProbe query="reproducible evidence" />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Lexical");
    expect(container.textContent).toContain('"searching":true');
    expect(apiMocks.searchKnowledge.mock.calls[0]?.[0]).toMatchObject({
      semantic: false,
      deep: false,
    });
    const runId = apiMocks.searchKnowledge.mock.calls[0]?.[0].runId;
    expect(apiMocks.searchKnowledge.mock.calls[1]?.[0]).toMatchObject({
      runId,
      semantic: true,
    });

    await act(async () => {
      resolveHybrid?.(response(runId, [hit("hybrid", "Hybrid")]));
      await hybridPromise;
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Hybrid");
    expect(container.textContent).toContain('"searching":false');
  });

  it("cancels the superseded run and ignores its late response", async () => {
    let resolveOld: ((value: KnowledgeSearchResponse) => void) | null = null;
    const oldPromise = new Promise<KnowledgeSearchResponse>((resolve) => {
      resolveOld = resolve;
    });
    const lexicalOnlyEmbedding = { ...lexicalEmbedding, installed: false, available: false, mode: "lexical" as const };
    apiMocks.searchKnowledge.mockImplementation((input: { query: string; runId: string }) => (
      input.query === "old query"
        ? oldPromise
        : Promise.resolve(response(input.runId, [hit("new", "New")], lexicalOnlyEmbedding))
    ));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(async () => {
      root.render(<SearchProbe query="old query" />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
      await Promise.resolve();
    });
    const oldRunId = apiMocks.searchKnowledge.mock.calls[0]?.[0].runId;
    await act(async () => {
      root.render(<SearchProbe query="new query" />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
      await Promise.resolve();
    });
    expect(apiMocks.cancelKnowledgeSearch).toHaveBeenCalledWith(oldRunId);
    expect(container.textContent).toContain("New");

    await act(async () => {
      resolveOld?.(response(oldRunId, [hit("old", "Old")]));
      await Promise.resolve();
    });
    expect(container.textContent).toContain("New");
    expect(container.textContent).not.toContain('"Old"');
  });
});
