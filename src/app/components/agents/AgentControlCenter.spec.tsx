// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAgentControlCatalog,
  refreshAgentRuntimes,
} from "../../../shared/api/agent";
import type { AgentControlCatalog } from "../../../shared/types/agentControl";
import { AgentControlCenter } from "./AgentControlCenter";

vi.mock("../../../shared/api/agent", () => ({
  getAgentControlCatalog: vi.fn(),
  refreshAgentRuntimes: vi.fn(),
  saveAgentProfile: vi.fn(),
  deleteAgentProfile: vi.fn(),
  saveAgentBinding: vi.fn(),
  deleteAgentBinding: vi.fn(),
  saveAgentGraph: vi.fn(),
  deleteAgentGraph: vi.fn(),
}));

const catalog: AgentControlCatalog = {
  profiles: [{
    id: "builtin-researcher",
    name: "Researcher",
    description: "Evidence",
    color: "#0F766E",
    modelId: null,
    runtimeId: "native",
    fallbackRuntimeId: "native",
    identityPrompt: "Use evidence.",
    skillIds: ["literature-search"],
    mcpServerIds: [],
    toolIds: ["workspace", "web"],
    readScopes: ["."],
    writeScopes: ["readonly"],
    toolCallBudget: 16,
    tokenBudget: 48000,
    timeoutMs: 180000,
    builtIn: true,
    createdAt: "2026-07-30T00:00:00Z",
    updatedAt: "2026-07-30T00:00:00Z",
  }],
  runtimes: [{
    id: "native",
    pluginId: "latotex.agent.native",
    labelKey: "agents.runtime.native",
    enabled: true,
    available: true,
    authenticated: true,
    source: "bundled",
    executablePath: null,
    version: "0.1.4",
    failure: null,
    checkedAt: null,
  }],
  bindings: [],
  graphTemplates: [{
    id: "builtin-research-workflow",
    name: "Research workflow",
    description: "Bounded graph",
    nodes: [{
      id: "research",
      role: "researcher",
      title: "Evidence",
      profileId: "builtin-researcher",
      instruction: "Gather evidence.",
      optional: false,
    }],
    edges: [],
    maxParallelism: 1,
    builtIn: true,
    createdAt: "2026-07-30T00:00:00Z",
    updatedAt: "2026-07-30T00:00:00Z",
  }],
  callsites: [{
    id: "analysis.workspace",
    labelKey: "agents.callsite.analysis.workspace.label",
    descriptionKey: "agents.callsite.analysis.workspace.description",
    supportsGraph: true,
    defaultProfileId: "builtin-researcher",
    defaultGraphTemplateId: "builtin-research-workflow",
    effectiveProfileId: "builtin-researcher",
    effectiveGraphTemplateId: "builtin-research-workflow",
    bindingSource: "built_in",
  }],
  recentRuns: [],
};

describe("AgentControlCenter", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(getAgentControlCatalog).mockResolvedValue(catalog);
    vi.mocked(refreshAgentRuntimes).mockResolvedValue(catalog.runtimes);
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("loads backend-authoritative profiles, bindings, and task graphs", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<AgentControlCenter projectId="project-a" models={[]} t={(key) => String(key)} />);
      await Promise.resolve();
    });

    expect(getAgentControlCatalog).toHaveBeenCalledWith("project-a");
    expect(container.textContent).toContain("Researcher");
    expect(container.textContent).toContain("Research workflow");
    expect(container.textContent).toContain("agents.profile.runtime");
    expect(container.textContent).not.toContain("agents.health.systemLocked");
    expect(container.textContent).not.toContain("agents.subtitle");

    await act(async () => root.unmount());
  });

  it("maps backend failures to stable localized copy without rendering raw detail", async () => {
    vi.mocked(getAgentControlCatalog).mockRejectedValueOnce(
      new Error("Bearer secret-token should never render"),
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<AgentControlCenter projectId={null} models={[]} t={(key) => String(key)} />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("agents.error.load");
    expect(container.textContent).not.toContain("secret-token");
    await act(async () => root.unmount());
  });
});
