import type { WorkspacePage } from "../../shared/types/app";

export const WORKSPACE_LAYOUT_REFRESH_EVENT = "latotex.workspace.layout.refresh";

export type WorkspaceLayoutRefreshReason =
  | "page-change"
  | "panel-layout"
  | "startup-ready";

export type WorkspaceLayoutRefreshDetail = {
  page: WorkspacePage;
  reason: WorkspaceLayoutRefreshReason;
  token: number;
};

function nextRefreshDetail(
  page: WorkspacePage,
  reason: WorkspaceLayoutRefreshReason,
): WorkspaceLayoutRefreshDetail {
  return {
    page,
    reason,
    token: Date.now(),
  };
}

export function emitWorkspaceLayoutRefresh(
  page: WorkspacePage,
  reason: WorkspaceLayoutRefreshReason,
) {
  if (typeof window === "undefined") {
    return;
  }
  const detail = nextRefreshDetail(page, reason);
  window.dispatchEvent(
    new CustomEvent<WorkspaceLayoutRefreshDetail>(WORKSPACE_LAYOUT_REFRESH_EVENT, {
      detail,
    }),
  );
  window.requestAnimationFrame(() => {
    window.dispatchEvent(new Event("resize"));
  });
}

