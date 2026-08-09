import { invokeCommand } from "./core";
import { executeWorkflowStart } from "./agent";
import type {
  ClaimEvidenceAssessment,
  AgentResourceLock,
  EvidencePacket,
  ResearchChatMigrationResult,
  ResearchChangeCheckpoint,
  ResearchChangeCheckpointUndoResult,
  ResearchChatStore,
  ResearchAgentRun,
  ResearchCapabilityDescriptor,
  ResearchPlanApproval,
  ResearchPlanExecutionAccepted,
  ResearchPlanVersion,
  ResearchTask,
  ResearchRunRecoveryResponse,
  ResearchNetworkPolicy,
  ResearchFulltextDocument,
  ResearchQuerySnapshot,
  ResearchReviewProtocol,
  ResearchReviewWorkspace,
  ResearchScreeningRecord,
  ResearchUiCommand,
  ResearchWorkspaceSnapshot,
} from "../types/researchAgent";

export const RESEARCH_RUN_CHANGED_EVENT = "latotex.research.run.changed";

function emitResearchRunChanged(projectId: string) {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(RESEARCH_RUN_CHANGED_EVENT, { detail: { projectId } }));
}

export function getResearchWorkspace(projectId: string): Promise<ResearchWorkspaceSnapshot> {
  return invokeCommand<ResearchWorkspaceSnapshot>("research_workspace_get", {
    input: { projectId },
  });
}

export function createResearchTask(
  projectId: string,
  goal: string,
  chatSessionId?: string | null,
): Promise<ResearchTask> {
  return invokeCommand<ResearchTask>("research_task_create", {
    input: { projectId, goal, chatSessionId: chatSessionId ?? null },
  });
}

export function getResearchNetworkPolicy(projectId: string): Promise<ResearchNetworkPolicy> {
  return invokeCommand<ResearchNetworkPolicy>("research_network_policy_get", {
    input: { projectId },
  });
}

export function updateResearchNetworkPolicy(input: Omit<ResearchNetworkPolicy, "updatedAt">) {
  return invokeCommand<ResearchNetworkPolicy>("research_network_policy_update", { input });
}

export function startResearchPlanningWorkflow(input: {
  projectId: string;
  taskId: string;
  prompt: string;
  modelOverride?: string;
}) {
  return executeWorkflowStart({
    projectId: input.projectId,
    workflowId: "research-plan-discussion",
    callsite: "research.workbench",
    prompt: input.prompt,
    contextRefs: [],
    modelOverride: input.modelOverride,
    bypassCache: true,
    teamMode: "off",
    harnessProfileId: "research.planning",
    profileId: "builtin-planner",
    researchTaskId: input.taskId,
  });
}

export function saveResearchPlan(input: {
  projectId: string;
  taskId: string;
  sourceMessage: string;
  authorizedProjectIds: string[];
  title?: string;
  summary?: string;
  assumptions?: string[];
  expectedArtifacts?: string[];
  acceptanceCriteria?: string[];
  steps: Array<{
    id?: string;
    enabled: boolean;
    dependencies: string[];
    capability: string;
    input: unknown;
    riskLevel: "read" | "write" | "high";
  }>;
}): Promise<ResearchPlanVersion> {
  return invokeCommand<ResearchPlanVersion>("research_plan_save", { input });
}

export function approveResearchPlan(
  projectId: string,
  taskId: string,
  version: number,
): Promise<ResearchPlanVersion> {
  return invokeCommand<ResearchPlanVersion>("research_plan_approve", {
    input: { projectId, taskId, version },
  });
}

export function getResearchChatStore(projectId: string): Promise<ResearchChatStore> {
  return invokeCommand<ResearchChatStore>("research_chat_store_get", {
    input: { projectId },
  });
}

export function replaceResearchChatStore(
  projectId: string,
  store: ResearchChatStore,
): Promise<ResearchChatStore> {
  return invokeCommand<ResearchChatStore>("research_chat_store_replace", {
    input: { projectId, store },
  });
}

export function migrateResearchChatStore(
  projectId: string,
  store: ResearchChatStore,
): Promise<ResearchChatMigrationResult> {
  return invokeCommand<ResearchChatMigrationResult>("research_chat_store_migrate", {
    input: { projectId, migrationId: "localstorage-chat-v1", store },
  });
}

export function getResearchCapabilityRegistry(): Promise<ResearchCapabilityDescriptor[]> {
  return invokeCommand<ResearchCapabilityDescriptor[]>("research_capability_registry");
}

export async function executeResearchPlan(
  projectId: string,
  taskId: string,
  version: number,
): Promise<ResearchPlanExecutionAccepted> {
  const accepted = await invokeCommand<ResearchPlanExecutionAccepted>("research_plan_execute", {
    input: { projectId, taskId, version },
  });
  emitResearchRunChanged(projectId);
  return accepted;
}

export function listResearchRuns(
  projectId?: string | null,
  includeTerminal = false,
): Promise<ResearchAgentRun[]> {
  return invokeCommand<ResearchAgentRun[]>("research_run_list", {
    input: { projectId: projectId ?? null, includeTerminal },
  });
}

export function listResearchUiCommands(projectId: string): Promise<ResearchUiCommand[]> {
  return invokeCommand<ResearchUiCommand[]>("research_ui_command_list", {
    input: { projectId },
  });
}

export async function resolveResearchUiCommand(input: {
  projectId: string;
  runId: string;
  stepId: string;
  status: "completed" | "failed";
  result?: unknown;
  diagnosticCode?: string | null;
}): Promise<ResearchPlanExecutionAccepted> {
  const accepted = await invokeCommand<ResearchPlanExecutionAccepted>("research_ui_command_resolve", { input });
  emitResearchRunChanged(input.projectId);
  return accepted;
}

export async function pauseResearchRun(projectId: string, runId: string) {
  const accepted = await invokeCommand<ResearchPlanExecutionAccepted>("research_run_pause", {
    input: { projectId, runId },
  });
  emitResearchRunChanged(projectId);
  return accepted;
}

export async function resumeResearchRun(projectId: string, runId: string) {
  const accepted = await invokeCommand<ResearchPlanExecutionAccepted>("research_run_resume", {
    input: { projectId, runId },
  });
  emitResearchRunChanged(projectId);
  return accepted;
}

export async function cancelResearchRun(projectId: string, runId: string) {
  const accepted = await invokeCommand<ResearchPlanExecutionAccepted>("research_run_cancel", {
    input: { projectId, runId },
  });
  emitResearchRunChanged(projectId);
  return accepted;
}

export async function recoverResearchRuns(projectId: string): Promise<ResearchRunRecoveryResponse> {
  const result = await invokeCommand<ResearchRunRecoveryResponse>("research_runs_recover", {
    input: { projectId },
  });
  emitResearchRunChanged(projectId);
  return result;
}

export function listResearchChangeCheckpoints(
  projectId: string,
  runId?: string | null,
): Promise<ResearchChangeCheckpoint[]> {
  return invokeCommand<ResearchChangeCheckpoint[]>("research_change_checkpoint_list", {
    input: { projectId, runId: runId ?? null },
  });
}

export async function undoResearchChangeCheckpoint(
  projectId: string,
  checkpointId: string,
): Promise<ResearchChangeCheckpointUndoResult> {
  const result = await invokeCommand<ResearchChangeCheckpointUndoResult>(
    "research_change_checkpoint_undo",
    { input: { projectId, checkpointId } },
  );
  emitResearchRunChanged(projectId);
  return result;
}

export function listResearchPlanApprovals(projectId: string): Promise<ResearchPlanApproval[]> {
  return invokeCommand<ResearchPlanApproval[]>("research_plan_approval_list", {
    input: { projectId },
  });
}

export function listResearchResourceLocks(projectId: string): Promise<AgentResourceLock[]> {
  return invokeCommand<AgentResourceLock[]>("research_resource_lock_list", {
    input: { projectId },
  });
}

export async function resolveResearchPlanApproval(
  projectId: string,
  approvalId: string,
  decision: "approved" | "rejected",
): Promise<ResearchPlanExecutionAccepted> {
  const accepted = await invokeCommand<ResearchPlanExecutionAccepted>("research_plan_approval_resolve", {
    input: { projectId, approvalId, decision },
  });
  emitResearchRunChanged(projectId);
  return accepted;
}

export function listResearchEvidence(projectId: string, taskId: string): Promise<EvidencePacket[]> {
  return invokeCommand<EvidencePacket[]>("research_evidence_list", {
    input: { projectId, taskId },
  });
}

export function assessResearchClaim(input: {
  projectId: string;
  taskId: string;
  claim: string;
  evidenceIds: string[];
  repairedClaim?: string | null;
}): Promise<ClaimEvidenceAssessment> {
  return invokeCommand<ClaimEvidenceAssessment>("research_claim_assess", { input });
}

export function listResearchClaimAssessments(
  projectId: string,
  taskId: string,
): Promise<ClaimEvidenceAssessment[]> {
  return invokeCommand<ClaimEvidenceAssessment[]>("research_claim_assessment_list", {
    input: { projectId, taskId },
  });
}

export function getResearchFulltextDocument(
  projectId: string,
  documentHash: string,
): Promise<ResearchFulltextDocument> {
  return invokeCommand<ResearchFulltextDocument>("research_fulltext_document_get", {
    input: { projectId, documentHash },
  });
}

export function saveResearchReviewProtocol(input: {
  projectId: string;
  taskId: string;
  title: string;
  researchQuestion: string;
  inclusionCriteria: string[];
  exclusionCriteria: string[];
}): Promise<ResearchReviewProtocol> {
  return invokeCommand<ResearchReviewProtocol>("research_review_protocol_save", { input });
}

export function recordResearchQuerySnapshot(input: {
  projectId: string;
  taskId: string;
  stableId?: string | null;
  query: string;
  sources: string[];
  resultCount: number;
  stopReason: ResearchQuerySnapshot["stopReason"];
}): Promise<ResearchQuerySnapshot> {
  return invokeCommand<ResearchQuerySnapshot>("research_review_query_snapshot_record", { input });
}

export function suggestResearchScreening(input: {
  projectId: string;
  taskId: string;
  evidenceId: string;
  recommendation: ResearchScreeningRecord["recommendation"];
  confidence: number;
  suggestionReason: string;
}): Promise<ResearchScreeningRecord> {
  return invokeCommand<ResearchScreeningRecord>("research_review_screening_suggest", { input });
}

export function confirmResearchScreenings(input: {
  projectId: string;
  taskId: string;
  decisions: Array<{
    screeningId: string;
    decision: "include" | "exclude";
    exclusionReason?: string | null;
    fullTextReviewed: boolean;
  }>;
}): Promise<ResearchReviewWorkspace> {
  return invokeCommand<ResearchReviewWorkspace>("research_review_screening_confirm_batch", { input });
}

export function getResearchReviewWorkspace(
  projectId: string,
  taskId: string,
): Promise<ResearchReviewWorkspace> {
  return invokeCommand<ResearchReviewWorkspace>("research_review_workspace_get", {
    input: { projectId, taskId },
  });
}
