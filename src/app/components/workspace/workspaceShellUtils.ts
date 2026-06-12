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
    { token: "/paper", label: t("agent.command.paper.label"), description: t("agent.command.paper.description") },
    { token: "/rebuttal", label: t("agent.command.rebuttal.label"), description: t("agent.command.rebuttal.description") },
  ];
}



type PendingChatAutoFix = {
  projectId: string | null;
  prompt: string;
  forceNewSession: boolean;
  source: string;
  requestId: string;
};

export function dispatchCompileAssistAutoFix(projectId: string | null, prompt: string) {
  if (typeof window === "undefined") {
    return;
  }
  const detail: PendingChatAutoFix = {
    projectId,
    prompt,
    forceNewSession: true,
    source: "compile_assist",
    requestId: Date.now().toString(36),
  };
  (window as Window & { __latotexPendingChatAutoFix?: PendingChatAutoFix }).__latotexPendingChatAutoFix = detail;
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent("latotex.chat.autofix", { detail }));
  }, 0);
}
