import { useLayoutEffect, useRef, type RefObject } from "react";

export type AutoScrollMessageLike = {
  id: string;
  role?: string;
  text?: string;
};

export function getChatAutoScrollAppendKey(
  sessionId: string | null,
  messages: readonly AutoScrollMessageLike[],
): string | null {
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  if (!sessionId || !lastMessage) {
    return null;
  }
  if (lastMessage.role === "assistant" && !String(lastMessage.text ?? "").trim()) {
    return null;
  }
  return `${sessionId}:${lastMessage.id}`;
}

export function getAgentActivityAutoScrollAppendKey(
  runId: string | null,
  hasVisibleOutput: boolean,
): string | null {
  if (!runId || !hasVisibleOutput) {
    return null;
  }
  return runId;
}

export function useAutoScrollOnAppend(
  containerRef: RefObject<HTMLElement | null>,
  appendKey: string | null,
  enabled = true,
): void {
  const lastAppliedKeyRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (!enabled || !appendKey) {
      return;
    }
    const node = containerRef.current;
    if (!node || lastAppliedKeyRef.current === appendKey) {
      return;
    }
    lastAppliedKeyRef.current = appendKey;
    node.scrollTo({ top: node.scrollHeight, behavior: "auto" });
  }, [appendKey, containerRef, enabled]);
}

