const LIBRARY_ROOT = ".latotex/papers";

export function toLibraryWorkspacePath(relativePath: string): string {
  const normalized = relativePath.trim().replace(/^\/+/, "");
  if (!normalized) {
    return LIBRARY_ROOT;
  }
  return `${LIBRARY_ROOT}/${normalized}`;
}

