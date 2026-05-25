import { PAGE_ITEMS } from "./app-config";
import type { WorkspacePage } from "../shared/types/app";

export const DEFAULT_PAGE_ORDER: WorkspacePage[] = PAGE_ITEMS.map((item) => item.id);

export function normalizeSidebarPageOrder(rawOrder: unknown): WorkspacePage[] {
  const valid = new Set<WorkspacePage>(DEFAULT_PAGE_ORDER);
  const next: WorkspacePage[] = [];
  if (Array.isArray(rawOrder)) {
    for (const value of rawOrder) {
      if (!valid.has(value as WorkspacePage) || next.includes(value as WorkspacePage)) {
        continue;
      }
      next.push(value as WorkspacePage);
    }
  }
  for (const page of DEFAULT_PAGE_ORDER) {
    if (!next.includes(page)) {
      next.push(page);
    }
  }
  return next;
}

export function moveSidebarPageOrderItem(
  order: WorkspacePage[],
  page: WorkspacePage,
  direction: -1 | 1,
): WorkspacePage[] {
  const normalized = normalizeSidebarPageOrder(order);
  const index = normalized.indexOf(page);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= normalized.length) {
    return normalized;
  }
  const next = [...normalized];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
