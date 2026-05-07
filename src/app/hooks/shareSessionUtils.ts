import type { ShareCommentItem, ShareSessionInfo } from "../../shared/types/app";
import { writeFile } from "../../shared/api/workspace";
import type { MutableRefObject } from "react";

export type ShareMode = "local" | "remote";

export type YTextLike = {
  toString: () => string;
  delete: (index: number, length: number) => void;
  insert: (index: number, text: string) => void;
  observe: (cb: () => void) => void;
  unobserve: (cb: () => void) => void;
};

export type YDocLike = {
  getText: (name: string) => YTextLike;
  on: (event: "update", cb: (update: Uint8Array, origin: unknown) => void) => void;
  off: (event: "update", cb: (update: Uint8Array, origin: unknown) => void) => void;
  transact: (fn: () => void, origin?: unknown) => void;
  destroy: () => void;
};

export function isShareReady(status: ShareSessionInfo, mode: ShareMode): boolean {
  if (status.status !== "ready") {
    return false;
  }
  if (mode === "local") {
    return Boolean(status.localJoinUrl || status.activeJoinUrl);
  }
  return Boolean(status.remoteJoinUrl || status.tunnelUrl || status.activeJoinUrl);
}

export function toShareCommentItems(rawItems: any[]): ShareCommentItem[] {
  if (!Array.isArray(rawItems)) {
    return [];
  }
  return rawItems
    .map((item, index) => {
      const pageRaw = Number(item?.page);
      const startRaw = Number(item?.start);
      const endRaw = Number(item?.end);
      return {
        id: String(item?.id ?? `comment-${index + 1}`),
        username: String(item?.username ?? "Guest"),
        text: String(item?.text ?? ""),
        quote: typeof item?.quote === "string" ? item.quote : undefined,
        source: typeof item?.source === "string" ? item.source : undefined,
        sessionName: typeof item?.sessionName === "string" ? item.sessionName : undefined,
        sessionCreatedAt: typeof item?.sessionCreatedAt === "string" ? item.sessionCreatedAt : undefined,
        page: Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : undefined,
        start: Number.isFinite(startRaw) && startRaw >= 0 ? startRaw : undefined,
        end: Number.isFinite(endRaw) && endRaw >= 0 ? endRaw : undefined,
        createdAt: typeof item?.createdAt === "string" ? item.createdAt : undefined,
      } satisfies ShareCommentItem;
    })
    .filter((item) => item.text.trim().length > 0 || (item.quote?.trim().length ?? 0) > 0)
    .slice(-120)
    .reverse();
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]!);
  }
  return btoa(binary);
}

export function fromBase64(raw: string): Uint8Array {
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function postJson(url: string, payload: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `HTTP ${response.status}`);
  }
  return response.json();
}

export async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForShareSessionReady(params: {
  expectedSessionId: string;
  mode: ShareMode;
  refreshShareStatus: () => Promise<ShareSessionInfo | null>;
  startTimeoutMessage: string;
}): Promise<ShareSessionInfo> {
  const timeoutMs = params.mode === "local" ? 18_000 : 120_000;
  const startedAt = Date.now();
  let waitMs = 620;
  let lastSeen: ShareSessionInfo | null = null;
  while (Date.now() - startedAt < timeoutMs) {
    const next = await params.refreshShareStatus();
    if (!next || next.sessionId !== params.expectedSessionId) {
      await wait(waitMs);
      waitMs = Math.min(1_800, waitMs + 120);
      continue;
    }
    lastSeen = next;
    if (isShareReady(next, params.mode)) {
      return next;
    }
    if (next.status === "failed") {
      throw new Error(next.tunnelError || "share tunnel failed");
    }
    await wait(waitMs);
    waitMs = Math.min(1_800, waitMs + 120);
  }
  if (lastSeen?.sessionId === params.expectedSessionId) {
    return lastSeen;
  }
  throw new Error(params.startTimeoutMessage);
}

export function matchPath(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) {
    return false;
  }
  return left.replace(/\\/g, "/") === right.replace(/\\/g, "/");
}

export function applyYTextDelta(
  target: { delete: (index: number, length: number) => void; insert: (index: number, text: string) => void },
  current: string,
  next: string,
) {
  if (current === next) {
    return;
  }
  let start = 0;
  const maxStart = Math.min(current.length, next.length);
  while (start < maxStart && current[start] === next[start]) {
    start += 1;
  }
  let endCurrent = current.length;
  let endNext = next.length;
  while (
    endCurrent > start
    && endNext > start
    && current[endCurrent - 1] === next[endNext - 1]
  ) {
    endCurrent -= 1;
    endNext -= 1;
  }
  const removeLen = endCurrent - start;
  const insert = next.slice(start, endNext);
  if (removeLen > 0) {
    target.delete(start, removeLen);
  }
  if (insert.length > 0) {
    target.insert(start, insert);
  }
}

export function scheduleShareFileWriteBack(params: {
  projectId: string | null;
  path: string | null;
  content: string;
  timerRef: MutableRefObject<number | null>;
  lastWriteRef: MutableRefObject<{ path: string; content: string } | null>;
  clearTimer: (timerRef: MutableRefObject<number | null>) => void;
  markPathSaved: (path: string, content: string) => void;
  onError?: (error: unknown) => void;
}) {
  const { projectId, path, content, timerRef, lastWriteRef, clearTimer, markPathSaved, onError } = params;
  if (!projectId || !path) {
    return;
  }
  const previous = lastWriteRef.current;
  if (previous?.path === path && previous.content === content) {
    return;
  }
  clearTimer(timerRef);
  timerRef.current = Number(window.setTimeout(() => {
    const targetPath = path;
    const targetContent = content;
    void writeFile(projectId, targetPath, targetContent)
      .then(() => {
        lastWriteRef.current = { path: targetPath, content: targetContent };
        markPathSaved(targetPath, targetContent);
      })
      .catch((error) => onError?.(error));
  }, 520));
}
