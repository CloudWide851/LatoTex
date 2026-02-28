export function filenameFromPath(path: string | null): string {
  if (!path) {
    return "";
  }
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}
