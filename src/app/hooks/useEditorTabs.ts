import { resolveCodeLanguage, resolveCodeLanguageTag } from "../../shared/utils/codeLanguage";
import type { CloseTabsAction, EditorTab } from "../../shared/types/app";

export function buildEditorTab(path: string, pinned: boolean, preview: boolean): EditorTab {
  const parts = path.split("/");
  return {
    id: `${path}::${Date.now()}::${Math.random().toString(16).slice(2, 8)}`,
    path,
    title: parts[parts.length - 1] ?? path,
    pinned,
    preview,
    language: resolveCodeLanguage(path),
    languageTag: resolveCodeLanguageTag(path),
    lastAccessed: Date.now(),
  };
}

export function dedupeEditorTabsByPath(tabs: EditorTab[]): EditorTab[] {
  const byPath = new Map<string, EditorTab>();
  const order: string[] = [];
  for (const tab of tabs) {
    const path = tab.path.trim();
    if (!path) {
      continue;
    }
    const existing = byPath.get(path);
    if (!existing) {
      byPath.set(path, { ...tab, path });
      order.push(path);
      continue;
    }
    byPath.set(path, {
      ...existing,
      pinned: existing.pinned || tab.pinned,
      preview: existing.preview && tab.preview,
      lastAccessed: Math.max(existing.lastAccessed ?? 0, tab.lastAccessed ?? 0),
    });
  }
  return order.map((path) => byPath.get(path)!).filter(Boolean);
}

export function getTabIdsByAction(
  tabs: EditorTab[],
  referenceTabId: string,
  action: CloseTabsAction,
  dirtyByPath: Record<string, boolean>,
): string[] {
  const index = tabs.findIndex((tab) => tab.id === referenceTabId);
  if (index < 0) {
    return [];
  }
  if (action === "close") {
    return [referenceTabId];
  }
  if (action === "closeLeft") {
    return tabs.slice(0, index).map((tab) => tab.id);
  }
  if (action === "closeRight") {
    return tabs.slice(index + 1).map((tab) => tab.id);
  }
  if (action === "closeOthers") {
    return tabs.filter((tab) => tab.id !== referenceTabId).map((tab) => tab.id);
  }
  if (action === "closeAll") {
    return tabs.map((tab) => tab.id);
  }
  return tabs
    .filter((tab) => !dirtyByPath[tab.path])
    .map((tab) => tab.id);
}
