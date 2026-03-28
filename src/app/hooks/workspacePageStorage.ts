import type { WorkspacePage } from "../../shared/types/app";

export const DEFAULT_WORKSPACE_PAGE: WorkspacePage = "latex";

const WORKSPACE_PAGE_STORAGE_KEY = "latotex.workspace.page";
const WORKSPACE_PAGES: WorkspacePage[] = ["latex", "analysis", "draw", "library", "git", "settings"];

export function isWorkspacePage(value: unknown): value is WorkspacePage {
  return typeof value === "string" && WORKSPACE_PAGES.includes(value as WorkspacePage);
}

export function loadWorkspacePage(): WorkspacePage {
  if (typeof window === "undefined") {
    return DEFAULT_WORKSPACE_PAGE;
  }
  try {
    const raw = window.sessionStorage.getItem(WORKSPACE_PAGE_STORAGE_KEY);
    return isWorkspacePage(raw) ? raw : DEFAULT_WORKSPACE_PAGE;
  } catch {
    return DEFAULT_WORKSPACE_PAGE;
  }
}

export function persistWorkspacePage(page: WorkspacePage) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(WORKSPACE_PAGE_STORAGE_KEY, page);
  } catch {
    // Ignore sessionStorage failures and keep the in-memory page state.
  }
}
