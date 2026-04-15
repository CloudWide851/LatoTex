import type { ShareCommentItem, ShareSessionInfo } from "../../shared/types/app";

export type ShareMode = "local" | "remote";

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
