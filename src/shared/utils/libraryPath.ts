export const LIBRARY_ROOT = ".latotex/papers";

function normalizeLibraryPath(relativePath: string): string {
  return relativePath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
}

export function toLibraryWorkspacePath(relativePath: string): string {
  const normalized = normalizeLibraryPath(relativePath);
  if (!normalized) {
    return LIBRARY_ROOT;
  }
  if (normalized === LIBRARY_ROOT || normalized.startsWith(`${LIBRARY_ROOT}/`)) {
    return normalized;
  }
  return `${LIBRARY_ROOT}/${normalized}`;
}

export function fromLibraryWorkspacePath(relativePath: string): string | null {
  const normalized = normalizeLibraryPath(relativePath);
  if (normalized === LIBRARY_ROOT) {
    return "";
  }
  const prefix = `${LIBRARY_ROOT}/`;
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : null;
}

export function isSameLibraryPath(left: string, right: string): boolean {
  return toLibraryWorkspacePath(left) === toLibraryWorkspacePath(right);
}
