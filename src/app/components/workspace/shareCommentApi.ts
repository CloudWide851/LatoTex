import type { ShareCommentItem, ShareSessionInfo } from "../../../shared/types/app";

export type ShareCommentSource = "tex" | "pdf";

export type ShareCommentDraft = {
  username: string;
  text: string;
  source: ShareCommentSource;
  quote?: string;
  start?: number;
  end?: number;
  page?: number;
};

function requireSessionFields(session: ShareSessionInfo | null | undefined) {
  const localUrl = session?.localUrl?.trim();
  const sessionId = session?.sessionId?.trim();
  const password = session?.password?.trim();
  if (!session?.active || !localUrl || !sessionId || !password) {
    throw new Error("share session is not ready");
  }
  return { localUrl, sessionId, password };
}

export function createShareCommentItem(
  draft: ShareCommentDraft,
  overrides?: Partial<ShareCommentItem>,
): ShareCommentItem {
  const username = draft.username.trim() || "Desktop";
  const text = draft.text.trim();
  const quote = typeof draft.quote === "string" ? draft.quote.trim() : "";
  return {
    id: overrides?.id ?? `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    username,
    text,
    quote: quote || undefined,
    source: draft.source,
    page: draft.source === "pdf" && Number.isFinite(draft.page) ? draft.page : undefined,
    start: Number.isFinite(draft.start) ? Math.max(0, Number(draft.start)) : undefined,
    end: Number.isFinite(draft.end) ? Math.max(0, Number(draft.end)) : undefined,
    createdAt: overrides?.createdAt ?? new Date().toISOString(),
  };
}

export async function postShareComment(
  session: ShareSessionInfo | null | undefined,
  draft: ShareCommentDraft,
): Promise<ShareCommentItem> {
  const { localUrl, sessionId, password } = requireSessionFields(session);
  const payload = createShareCommentItem(draft);
  const response = await fetch(`${localUrl}/api/comments/post`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sid: sessionId,
      pwd: password,
      ...payload,
    }),
  });
  if (!response.ok) {
    throw new Error((await response.text()) || `HTTP ${response.status}`);
  }
  return payload;
}
