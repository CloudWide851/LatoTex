const LIBRARY_ROOT = ".latotex/papers";

export function toLibraryWorkspacePath(relativePath: string): string {
  const normalized = relativePath.trim().replace(/^\/+/, "");
  if (!normalized) {
    return LIBRARY_ROOT;
  }
  if (normalized === LIBRARY_ROOT || normalized.startsWith(`${LIBRARY_ROOT}/`)) {
    return normalized;
  }
  return `${LIBRARY_ROOT}/${normalized}`;
}
