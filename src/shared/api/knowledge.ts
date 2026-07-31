import type {
  Ack,
  EmbeddingRuntimeStatus,
  FsAction,
  FsScope,
  KnowledgeArchiveResponse,
  KnowledgeFetchResponse,
  KnowledgeGraphResponse,
  KnowledgeItem,
  KnowledgeEmbeddingJobStatus,
  KnowledgeMutationPreview,
  KnowledgeSearchResponse,
  KnowledgeTopic,
  ResearchAnswerEnvelope,
  ResearchAnswerValidation,
} from "../types/app";
import { invokeCommand } from "./core";

export function archiveKnowledgeItem(
  projectId: string,
  relativePath: string,
): Promise<KnowledgeArchiveResponse> {
  return invokeCommand("knowledge_archive", { input: { projectId, relativePath } });
}

export function reindexKnowledgeItem(
  projectId: string,
  itemId: string,
): Promise<KnowledgeArchiveResponse> {
  return invokeCommand("knowledge_reindex", { input: { projectId, itemId } });
}

export function unarchiveKnowledgeItem(projectId: string, itemId: string): Promise<Ack> {
  return invokeCommand("knowledge_unarchive", { input: { projectId, itemId } });
}

export function listKnowledgeItems(
  projectId: string,
  filters?: { sourceKind?: string; indexState?: string },
): Promise<KnowledgeItem[]> {
  return invokeCommand("knowledge_list", {
    input: {
      projectId,
      sourceKind: filters?.sourceKind,
      indexState: filters?.indexState,
    },
  });
}

export function searchKnowledge(input: {
  projectId: string;
  projectIds?: string[];
  query: string;
  limit?: number;
  deep?: boolean;
  runId?: string;
  semantic?: boolean;
}): Promise<KnowledgeSearchResponse> {
  return invokeCommand("knowledge_search", { input });
}

export function cancelKnowledgeSearch(runId: string): Promise<Ack> {
  return invokeCommand("knowledge_search_cancel", { input: { runId } });
}

export function fetchKnowledgeEvidence(
  projectId: string,
  evidenceId: string,
  maxChars?: number,
): Promise<KnowledgeFetchResponse> {
  return invokeCommand("knowledge_fetch", { input: { projectId, evidenceId, maxChars } });
}

export function expandKnowledgeGraph(input: {
  projectId: string;
  itemId?: string;
  query?: string;
  limit?: number;
}): Promise<KnowledgeGraphResponse> {
  return invokeCommand("knowledge_graph_expand", { input });
}

export function listKnowledgeTopics(projectId: string): Promise<KnowledgeTopic[]> {
  return invokeCommand("knowledge_topic_list", { input: { projectId } });
}

export function mutateKnowledgeTopic(input: {
  projectId: string;
  topicId: string;
  action: "rename" | "hide" | "unhide" | "promote" | "merge";
  label?: string;
  targetTopicId?: string;
}): Promise<Ack> {
  return invokeCommand("knowledge_topic_mutate", { input });
}

export function previewKnowledgeMutation(input: {
  projectId: string;
  scope: FsScope;
  action: FsAction | "write";
  path: string;
  targetPath?: string;
}): Promise<KnowledgeMutationPreview> {
  return invokeCommand("knowledge_mutation_preview", { input });
}

export function getKnowledgeEmbeddingStatus(projectId: string): Promise<EmbeddingRuntimeStatus> {
  return invokeCommand("knowledge_embedding_status", { input: { projectId } });
}

export function getKnowledgeEmbeddingJobStatus(
  projectId: string,
): Promise<KnowledgeEmbeddingJobStatus> {
  return invokeCommand("knowledge_embedding_job_status", { input: { projectId } });
}

export function rebuildKnowledgeEmbeddings(
  projectId: string,
): Promise<KnowledgeEmbeddingJobStatus> {
  return invokeCommand("knowledge_embedding_rebuild", { input: { projectId } });
}

export function pauseKnowledgeEmbeddings(
  projectId: string,
): Promise<KnowledgeEmbeddingJobStatus> {
  return invokeCommand("knowledge_embedding_pause", { input: { projectId } });
}

export function resumeKnowledgeEmbeddings(
  projectId: string,
): Promise<KnowledgeEmbeddingJobStatus> {
  return invokeCommand("knowledge_embedding_resume", { input: { projectId } });
}

export function validateResearchAnswer(
  input: ResearchAnswerEnvelope,
): Promise<ResearchAnswerValidation> {
  return invokeCommand("research_answer_validate", { input });
}
