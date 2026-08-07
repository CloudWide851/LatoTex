export type AgentRuntimeId = "native" | "codex-cli" | "claude-code-cli";

export type AgentRuntimeAction =
  | "detect"
  | "select"
  | "enable"
  | "disable"
  | "update"
  | "cancel-update"
  | "terminal"
  | "profiles";

export type ExternalAgentFailure = {
  code: string;
  stage: string;
  retryable: boolean;
  diagnostics: string[];
};

export type AgentRuntimeDescriptor = {
  id: AgentRuntimeId;
  pluginId: string;
  labelKey: string;
  enabled: boolean;
  available: boolean;
  authenticated: boolean;
  source: "bundled" | "manual" | "path" | "missing" | string;
  executablePath: string | null;
  version: string | null;
  failure: ExternalAgentFailure | null;
  checkedAt: string | null;
};

export type AgentProfile = {
  id: string;
  name: string;
  description: string;
  color: string;
  modelId: string | null;
  runtimeId: AgentRuntimeId;
  fallbackRuntimeId: AgentRuntimeId;
  identityPrompt: string;
  skillIds: string[];
  mcpServerIds: string[];
  toolIds: Array<"workspace" | "web" | "python" | "mcp">;
  readScopes: string[];
  writeScopes: string[];
  toolCallBudget: number;
  tokenBudget: number;
  timeoutMs: number;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AgentBinding = {
  projectId: string | null;
  callsite: string;
  profileId: string;
  graphTemplateId: string | null;
  updatedAt: string;
};

export type AgentGraphRole =
  | "planner"
  | "researcher"
  | "analyst"
  | "writer"
  | "reviewer"
  | "synthesizer";

export type AgentGraphNode = {
  id: string;
  role: AgentGraphRole;
  title: string;
  profileId: string | null;
  instruction: string;
  optional: boolean;
};

export type AgentGraphEdge = {
  from: string;
  to: string;
};

export type AgentGraphTemplate = {
  id: string;
  name: string;
  description: string;
  nodes: AgentGraphNode[];
  edges: AgentGraphEdge[];
  maxParallelism: number;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AgentCallsiteDescriptor = {
  id: string;
  labelKey: string;
  descriptionKey: string;
  supportsGraph: boolean;
  defaultProfileId: string;
  defaultGraphTemplateId: string | null;
  effectiveProfileId: string;
  effectiveGraphTemplateId: string | null;
  bindingSource: "project" | "global" | "built_in";
};

export type AgentRunSummary = {
  runId: string;
  projectId: string;
  callsite: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentControlCatalog = {
  profiles: AgentProfile[];
  bindings: AgentBinding[];
  graphTemplates: AgentGraphTemplate[];
  callsites: AgentCallsiteDescriptor[];
  recentRuns: AgentRunSummary[];
  runtimes: AgentRuntimeDescriptor[];
};

export type AgentControlDeleteResponse = {
  deleted: boolean;
  fallbackProfileId: string | null;
  affectedBindings: AgentBinding[];
};
