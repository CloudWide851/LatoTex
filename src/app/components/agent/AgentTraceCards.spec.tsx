// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentTraceCards } from "./AgentTraceCards";
import type { AgentEventCard } from "../../hooks/analysisWorkspaceHelpers";

describe("AgentTraceCards", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("virtualizes large trace groups", async () => {
    const cards: AgentEventCard[] = Array.from({ length: 80 }, (_, index) => ({
      id: `event-${index}`,
      runId: "run-1",
      kind: "event",
      stage: "tool",
      source: "agent",
      status: "completed",
      title: `Step ${index}`,
      content: `path: file-${index}.tex`,
      cardKey: `card-${index}`,
      createdAt: "2026-06-13T00:00:00.000Z",
      nodeId: `node-${index}`,
    }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AgentTraceCards
          cards={cards}
          title="Trace"
          bodyClassName="max-h-80"
          t={(key) => String(key)}
        />,
      );
    });

    expect(container.querySelectorAll("[data-virtual-index]").length).toBeLessThan(30);
    expect(container.textContent).toContain("Step 0");
    expect(container.textContent).not.toContain("Step 79");

    await act(async () => {
      root.unmount();
    });
  });
});
