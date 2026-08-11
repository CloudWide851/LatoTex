// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentControlCatalog } from "../../../shared/types/agentControl";
import { AgentControlCenter } from "./AgentControlCenter";

const api = vi.hoisted(() => ({
  deleteAgentBinding: vi.fn(),
  deleteAgentGraph: vi.fn(),
  deleteAgentProfile: vi.fn(),
  getAgentControlCatalog: vi.fn(),
  refreshAgentRuntimes: vi.fn(),
  saveAgentBinding: vi.fn(),
  saveAgentGraph: vi.fn(),
  saveAgentProfile: vi.fn(),
}));

vi.mock("../../../shared/api/agent", () => api);
vi.mock("./AgentProfileEditor", () => ({
  AgentProfileEditor: () => <div data-testid="profile-editor" />,
}));
vi.mock("./AgentBindingPanel", () => ({
  AgentBindingPanel: () => <div data-testid="binding-panel" />,
}));
vi.mock("./AgentGraphEditor", () => ({
  AgentGraphEditor: () => <div data-testid="graph-editor" />,
}));

const CATALOG: AgentControlCatalog = {
  profiles: [{
    id: "builtin-researcher",
    name: "Researcher",
    description: "Research profile",
    color: "#0f766e",
    modelId: null,
    runtimeId: "native",
    fallbackRuntimeId: "native",
    identityPrompt: "Research carefully",
    skillIds: [],
    mcpServerIds: [],
    toolIds: ["workspace"],
    readScopes: ["project"],
    writeScopes: ["*.tex"],
    toolCallBudget: 10,
    tokenBudget: 4_000,
    timeoutMs: 30_000,
    builtIn: true,
    createdAt: "",
    updatedAt: "",
  }],
  bindings: [],
  graphTemplates: [{
    id: "builtin-review",
    name: "Review workflow",
    description: "Review",
    nodes: [],
    edges: [],
    maxParallelism: 1,
    builtIn: true,
    createdAt: "",
    updatedAt: "",
  }],
  callsites: [{
    id: "chat.workspace",
    labelKey: "agents.callsite.chat.workspace.label",
    descriptionKey: "agents.callsite.chat.workspace.description",
    supportsGraph: true,
    defaultProfileId: "builtin-researcher",
    defaultGraphTemplateId: null,
    effectiveProfileId: "builtin-researcher",
    effectiveGraphTemplateId: null,
    bindingSource: "built_in",
  }],
  recentRuns: [],
  runtimes: [],
};

describe("AgentControlCenter", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    api.getAgentControlCatalog.mockResolvedValue(CATALOG);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("separates Profiles, Routing, and Workflows into focused views", async () => {
    await act(async () => {
      root.render(<AgentControlCenter projectId="project-1" models={[]} t={(key) => String(key)} />);
    });
    await act(async () => Promise.resolve());

    expect(container.querySelector("[data-testid='profile-editor']")).not.toBeNull();
    expect(container.querySelector("[data-testid='binding-panel']")).toBeNull();
    expect(container.querySelector("[data-testid='graph-editor']")).toBeNull();

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("nav button"));
    await act(async () => buttons.find((button) => button.textContent === "agents.tab.routing")?.click());
    expect(container.querySelector("[data-testid='binding-panel']")).not.toBeNull();
    expect(container.querySelector("[data-testid='profile-editor']")).toBeNull();

    await act(async () => buttons.find((button) => button.textContent === "agents.tab.workflows")?.click());
    expect(container.querySelector("[data-testid='graph-editor']")).not.toBeNull();
    expect(container.querySelector("[data-testid='binding-panel']")).toBeNull();
  });
});
