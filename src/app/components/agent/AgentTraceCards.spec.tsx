// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAgentApproval } from "../../../shared/api/agent";
import { AgentTraceCards } from "./AgentTraceCards";
import type { AgentEventCard } from "../../hooks/analysisWorkspaceHelpers";

vi.mock("../../../shared/api/agent", () => ({
  resolveAgentApproval: vi.fn().mockResolvedValue({ runId: "run-1", status: "accepted" }),
}));

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

  it("shows workflow and harness chips", async () => {
    const cards: AgentEventCard[] = [{
      id: "event-1",
      runId: "run-1",
      kind: "event",
      stage: "provider",
      source: "agent",
      status: "completed",
      title: "Submission preflight",
      content: "checked",
      cardKey: "card-1",
      createdAt: "2026-06-13T00:00:00.000Z",
      workflowId: "latex.submission_preflight",
      harnessProfileId: "latex.submission",
    }];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AgentTraceCards
          cards={cards}
          title="Trace"
          t={(key) => String(key)}
        />,
      );
    });

    expect(container.textContent).toContain("latex.submission_preflight");
    expect(container.textContent).toContain("latex.submission");

    await act(async () => {
      root.unmount();
    });
  });

  it("resolves a pending permission from the trace card", async () => {
    const cards: AgentEventCard[] = [{
      id: "event-approval",
      runId: "run-1",
      kind: "agent.approval.requested",
      stage: "run",
      source: "system",
      status: "waiting_approval",
      title: "Permission Approval",
      content: "",
      cardKey: "approval-card",
      createdAt: "2026-06-13T00:00:00.000Z",
      requiresApproval: true,
      approvalId: "approval-1",
      approvalExpiresAt: "2026-06-13T00:10:00.000Z",
      approvalCapabilities: [{ capability: "python", resource: "managed" }],
    }];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<AgentTraceCards cards={cards} title="Trace" t={(key) => String(key)} />);
    });
    const allowOnce = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "agent.approval.allowOnce");
    expect(allowOnce).toBeTruthy();

    await act(async () => {
      allowOnce?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(resolveAgentApproval).toHaveBeenCalledWith("approval-1", "allow_once");

    await act(async () => {
      root.unmount();
    });
  });
});
