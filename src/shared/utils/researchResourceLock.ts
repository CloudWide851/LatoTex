import type { AgentResourceLock } from "../types/researchAgent";

export function normalizeResearchResourcePath(path: string | null | undefined): string {
  return String(path ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
}

export function researchWriteLockPaths(locks: AgentResourceLock[]): string[] {
  return Array.from(new Set(
    locks
      .filter((lock) => lock.mode === "write")
      .map((lock) => normalizeResearchResourcePath(lock.resourcePath))
      .filter(Boolean),
  ));
}

export function findResearchWriteLock(
  locks: AgentResourceLock[],
  path: string | null | undefined,
): AgentResourceLock | null {
  const normalizedPath = normalizeResearchResourcePath(path);
  if (!normalizedPath) {
    return null;
  }
  return locks.find((lock) => (
    lock.mode === "write"
    && normalizeResearchResourcePath(lock.resourcePath) === normalizedPath
  )) ?? null;
}
