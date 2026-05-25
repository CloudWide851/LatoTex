// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentSessionController } from "./useAgentSessionController";
import type { AgentChatMessage } from "./agentTypes";

const mocks = vi.hoisted(() => ({
  executeWorkflowCancel: vi.fn(),
  runTaskAgent: vi.fn(),
}));

vi.mock("../../shared/api/agent", () => ({
  executeWorkflowCancel: mocks.executeWorkflowCancel,
}));

function AgentSessionProbe() {
  const [agentPrompt, setAgentPrompt] = useState("fix this");
  const [agentRunId, setAgentRunId] = useState<string | null>("run-recovered");
  const [agentPhase, setAgentPhase] = useState<"idle" | "running" | "done" | "error">("running");
  const [statusKey, setAgentStatusKey] = useState<any>("agent.statusRunning");
  const [toast, setToast] = useState<{ type: "info" | "error"; message: string } | null>(null);
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const controller = useAgentSessionController({
    activeProjectId: "project-1",
    selectedFile: "main.tex",
    agentPrompt,
    agentPhase,
    agentRunId,
    agentMessages: messages,
    setAgentMessages: setMessages,
    setAgentPrompt,
    setAgentRunId,
    setAgentPhase,
    setAgentStatusKey,
    setPage: () => undefined,
    setSelectedFile: () => undefined,
    setToast,
    runTaskAgent: mocks.runTaskAgent,
    t: (key) => String(key),
  });

  return (
    <div>
      <button type="button" data-testid="run" onClick={() => void controller.handleAgentRun()}>
        run
      </button>
      <span data-testid="phase">{agentPhase}</span>
      <span data-testid="run-id">{agentRunId ?? ""}</span>
      <span data-testid="status">{statusKey}</span>
      <span data-testid="toast">{toast?.message ?? ""}</span>
    </div>
  );
}

describe("useAgentSessionController", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.executeWorkflowCancel.mockResolvedValue({ ok: true, message: "cancelling" });
    mocks.runTaskAgent.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("clears recovered running state after interrupt so a new command can be started", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<AgentSessionProbe />);
    });

    await act(async () => {
      container.querySelector("[data-testid='run']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mocks.executeWorkflowCancel).toHaveBeenCalledWith("run-recovered");
    expect(container.querySelector("[data-testid='phase']")?.textContent).toBe("done");
    expect(container.querySelector("[data-testid='run-id']")?.textContent).toBe("");
    expect(container.querySelector("[data-testid='status']")?.textContent).toBe("agent.statusDone");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
