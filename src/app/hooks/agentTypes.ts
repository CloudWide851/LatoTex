export type AgentMessageFormat = "plain" | "markdown";

export type AgentChatMessage = {
  id: string;
  role: "user" | "agent";
  text: string;
  format?: AgentMessageFormat;
  proposalId?: string;
};

export type AgentFileProposal = {
  id: string;
  targetPath: string;
  originalContent: string;
  candidateContent: string;
  summary: string;
  analysisPrompt: string;
  insertions?: number;
  deletions?: number;
  changedLines?: number[];
  previewApplied?: boolean;
};

export type AgentEventCard = {
  id: string;
  runId: string;
  kind: string;
  stage: string;
  source: string;
  status: string;
  title: string;
  content: string;
  cardKey: string;
  createdAt: string;
};
