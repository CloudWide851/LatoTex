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
};
