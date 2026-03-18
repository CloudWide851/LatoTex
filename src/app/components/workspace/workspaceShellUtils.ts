import type { AgentCommandItem } from "../AgentChatOverlay";

type TranslationFn = (key: any) => string;

export type AgentStatusKey =
  | "agent.statusIdle"
  | "agent.statusRunning"
  | "agent.statusDone"
  | "agent.statusError";

export function composeTitleWithShortcut(label: string, shortcut: string): string {
  return `${label} (${shortcut})`;
}

export function buildAgentCommandItems(t: TranslationFn): AgentCommandItem[] {
  return [
    { token: "/review", label: t("agent.command.review.label"), description: t("agent.command.review.description") },
  ];
}


