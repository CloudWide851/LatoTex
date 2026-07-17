import type { ShareCommentItem, ShareSessionInfo } from "../../../shared/types/app";
import { authenticatedDesktopShareFetch } from "../../hooks/shareHttpAuth";
import { ShareUiError, shareUiErrorFromStatus } from "../../../shared/utils/shareUiError";

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
  const sessionId = session?.sessionId?.trim();
  if (!sessionId) {
    throw new ShareUiError("session_missing");
  }
  const payload = createShareCommentItem(draft);
  const response = await authenticatedDesktopShareFetch(
    session,
    "/api/comments/post",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sid: sessionId, ...payload }),
    },
    draft.username,
  );
  if (!response.ok) {
    throw shareUiErrorFromStatus(response.status);
  }
  return payload;
}
