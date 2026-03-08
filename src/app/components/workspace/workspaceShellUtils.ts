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
    { token: "/check-ref", label: t("agent.command.checkRef.label"), description: t("agent.command.checkRef.description") },
    { token: "/new", label: t("agent.command.new.label"), description: t("agent.command.new.description") },
    { token: "/memory", label: t("agent.command.memory.label"), description: t("agent.command.memory.description") },
    { token: "/resume", label: t("agent.command.resume.label"), description: t("agent.command.resume.description") },
  ];
}
