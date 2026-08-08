export type ResearchTaskStatus =
  | "discussion"
  | "plan_pending"
  | "execution"
  | "approval_paused"
  | "validation"
  | "completed"
  | "failed"
  | "cancelled";

export type ResearchTask = {
  id: string;
  projectId: string;
  goal: string;
  status: ResearchTaskStatus;
  currentPlanVersion: number | null;
  runIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ResearchPlanStep = {
  id: string;
  order: number;
  enabled: boolean;
  dependencies: string[];
  capability: string;
  input: unknown;
  riskLevel: "read" | "write" | "high";
  status: string;
  runId: string | null;
};

export type ResearchPlanVersion = {
  id: string;
  taskId: string;
  version: number;
  sourceMessage: string;
  approvalStatus: "draft" | "approved" | "superseded";
  authorizedProjectIds: string[];
  steps: ResearchPlanStep[];
  createdAt: string;
  approvedAt: string | null;
};

export type ResearchChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: string;
  runId?: string | null;
};

export type ResearchChatSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ResearchChatMessage[];
};

export type ResearchChatStore = {
  sessions: ResearchChatSession[];
  activeSessionId: string | null;
  migrationCompleted: boolean;
  diagnosticCode: string | null;
};

export type ResearchChatMigrationResult = {
  migrated: boolean;
  verified: boolean;
  store: ResearchChatStore;
  diagnosticCode: string | null;
};

export type ResearchWorkspaceSnapshot = {
  tasks: ResearchTask[];
  plans: ResearchPlanVersion[];
  chatStore: ResearchChatStore;
};

export type ResearchCapabilityDescriptor = {
  id: string;
  riskLevel: "read" | "write" | "high";
  executionTarget: "backend" | "frontend";
  autoAfterPlanApproval: boolean;
  resourceMode: "read" | "write" | null;
  requiresNetwork: boolean;
};

export type ResearchAgentRun = {
  runId: string;
  projectId: string;
  taskId: string;
  planVersion: number;
  status: string;
  currentStepId: string | null;
  completedSteps: number;
  totalSteps: number;
  lastOperation: string | null;
  evidenceCount: number;
  diagnosticCode: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

export type ResearchPlanApproval = {
  approvalId: string;
  projectId: string;
  runId: string;
  stepId: string;
  riskLevel: "high";
  commandSummary: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  resolvedAt: string | null;
};

export type ResearchPlanExecutionAccepted = {
  runId: string;
  status: string;
};

export type AgentAppCommand =
  | { command: "project.overview" }
  | { command: "ui.navigate"; pageId: string; resource?: string | null }
  | { command: "literature.search"; queries: string[]; deep?: boolean | null }
  | { command: "literature.import"; source: string }
  | { command: "literature.open"; path: string }
  | { command: "literature.citation_trace"; doi: string; direction: string }
  | { command: "workspace.read"; path: string; maxChars?: number | null }
  | { command: "workspace.propose_latex"; path: string; instruction: string }
  | { command: "workspace.apply_latex"; path: string; proposalId: string }
  | { command: "workspace.write_non_latex"; path: string; content: string }
  | { command: "workspace.compile"; mainPath: string }
  | { command: "analysis.run"; prompt: string; inputFiles: string[] }
  | { command: "report.generate"; title: string }
  | { command: "report.export"; reportId: string; format: string }
  | { command: "draw.create"; name: string }
  | { command: "draw.open"; path: string }
  | { command: "draw.export"; path: string; format: string }
  | { command: "submission.check"; mainPath: string; profileId?: string | null }
  | { command: "submission.build"; mainPath: string; profileId?: string | null }
  | { command: "submission.send"; artifactId: string; channel: string }
  | { command: "git.status" }
  | { command: "git.diff"; path?: string | null }
  | { command: "git.commit"; message: string; paths: string[] }
  | { command: "runtime.status" }
  | { command: "runtime.update"; runtimeId: string }
  | { command: "plugin.status" }
  | { command: "plugin.update"; pluginId: string }
  | { command: "settings.change"; patch: unknown };

export type ResearchUiCommand = {
  projectId: string;
  runId: string;
  stepId: string;
  capability: AgentAppCommand["command"];
  command: AgentAppCommand;
  createdAt: string;
};

export type AgentResourceLock = {
  lockId: string;
  projectId: string;
  resourcePath: string;
  mode: "read" | "write";
  runId: string;
  heartbeatAt: string;
  expiresAt: string;
};

export type EvidencePacket = {
  id: string;
  taskId: string;
  runId: string | null;
  source: string;
  doi: string | null;
  sourceVersion: string | null;
  title: string;
  excerpt: string;
  locator: { page: number | null; section: string | null; paragraph: string | null };
  contentHash: string;
  retractionStatus: "clear" | "retracted" | "corrected" | "unknown";
  correctionStatus: "none" | "corrected" | "expression_of_concern" | "unknown";
  sourceUrl: string;
  createdAt: string;
};

export type ClaimEvidenceAssessment = {
  id: string;
  taskId: string;
  claim: string;
  status: "supported" | "partial" | "contradicted" | "insufficient";
  evidenceIds: string[];
  verbatimExcerpts: string[];
  rationale: string;
  repairAttempted: boolean;
  repairedClaim: string | null;
  requiresUnconfirmedLabel: boolean;
  createdAt: string;
};
