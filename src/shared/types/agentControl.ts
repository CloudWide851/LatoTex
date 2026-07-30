export type AgentProfile = {
  id: string;
  name: string;
  description: string;
  color: string;
  modelId: string | null;
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
};

export type AgentControlDeleteResponse = {
  deleted: boolean;
  fallbackProfileId: string | null;
  affectedBindings: AgentBinding[];
};
