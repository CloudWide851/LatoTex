// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getResearchWorkspace,
  listResearchEvidence,
} from "../../../shared/api/researchAgent";
import type { EvidencePacket } from "../../../shared/types/researchAgent";
import type { ChatMessage } from "../../hooks/chatSessionStore";
import { useResearchTimelineState } from "./useResearchTimelineState";

vi.mock("../../../shared/api/researchAgent", () => ({
  getResearchWorkspace: vi.fn(),
  listResearchEvidence: vi.fn(),
  RESEARCH_RUN_CHANGED_EVENT: "latotex.research.run.changed",
}));

const EVIDENCE: EvidencePacket = {
  id: "evidence-1",
  taskId: "task-1",
  runId: "run-1",
  source: "crossref",
  doi: "10.1000/example",
  sourceVersion: null,
  title: "Reproducible evidence",
  excerpt: "The result was reproduced.",
  locator: { page: 2, section: "Results", paragraph: "3" },
  contentHash: "abc",
  retractionStatus: "clear",
  correctionStatus: "none",
  sourceUrl: "https://example.invalid",
  createdAt: "2026-08-10T00:00:00Z",
};

function Probe(props: { messages: ChatMessage[] }) {
  const state = useResearchTimelineState({ projectId: "project-1", messages: props.messages });
  return <output>{JSON.stringify(state.evidenceCountByTask)}</output>;
}

describe("useResearchTimelineState", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(getResearchWorkspace).mockResolvedValue({
      tasks: [],
      plans: [],
      chatStore: {
        sessions: [],
        activeSessionId: null,
        migrationCompleted: true,
        diagnosticCode: null,
      },
    });
    vi.mocked(listResearchEvidence).mockResolvedValue([]);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("does not read the research ledger for ordinary chat messages", async () => {
    await act(async () => {
      root.render(<Probe messages={[{
        id: "message-1",
        role: "assistant",
        text: "Ordinary answer",
        createdAt: "2026-08-10T00:00:00Z",
      }]} />);
      await Promise.resolve();
    });

    expect(getResearchWorkspace).not.toHaveBeenCalled();
    expect(listResearchEvidence).not.toHaveBeenCalled();
  });

  it("loads evidence counts only for task-linked timeline messages", async () => {
    vi.mocked(listResearchEvidence).mockResolvedValue([EVIDENCE]);
    await act(async () => {
      root.render(<Probe messages={[{
        id: "message-1",
        role: "assistant",
        text: "Plan ready",
        taskId: "task-1",
        createdAt: "2026-08-10T00:00:00Z",
      }]} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getResearchWorkspace).toHaveBeenCalledWith("project-1");
    expect(listResearchEvidence).toHaveBeenCalledWith("project-1", "task-1");
    expect(container.textContent).toBe('{"task-1":1}');
  });
});
