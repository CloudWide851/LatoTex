const BIBLATEX_RESOURCE_RE = /\\addbibresource(?:\s*\[[^\]]*])?\s*\{([^}]+)\}/gi;
const BIBTEX_RESOURCE_RE = /\\bibliography\s*\{([^}]+)\}/gi;

function normalizeCompilePath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .trim();
}

function withBibExtension(value: string): string {
  const normalized = normalizeCompilePath(value);
  if (!normalized) {
    return "";
  }
  return /\.bib$/i.test(normalized) ? normalized : `${normalized}.bib`;
}

function pushUnique(paths: string[], value: string) {
  const normalized = normalizeCompilePath(value);
  if (!normalized || paths.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
    return;
  }
  paths.push(normalized);
}

export function collectBibliographyResourcePaths(source: string): string[] {
  const paths: string[] = [];
  for (const match of source.matchAll(BIBLATEX_RESOURCE_RE)) {
    pushUnique(paths, withBibExtension(String(match[1] ?? "")));
  }
  for (const match of source.matchAll(BIBTEX_RESOURCE_RE)) {
    const body = String(match[1] ?? "");
    for (const item of body.split(",")) {
      pushUnique(paths, withBibExtension(item));
    }
  }
  return paths;
}

export function collectBibliographyResourcePathsFromFileMap(fileMap: Record<string, string>): string[] {
  const paths: string[] = [];
  for (const [path, source] of Object.entries(fileMap)) {
    if (!/\.(tex|sty|cls)$/i.test(path)) {
      continue;
    }
    for (const bibPath of collectBibliographyResourcePaths(source)) {
      pushUnique(paths, bibPath);
    }
  }
  return paths;
}

export async function appendBibliographyResourcesToFileMap(params: {
  fileMap: Record<string, string>;
  scanFileMap?: Record<string, string>;
  readTextFile: (path: string) => Promise<string>;
  shouldIncludeFile: (path: string) => boolean;
}) {
  const { fileMap, scanFileMap, readTextFile, shouldIncludeFile } = params;
  for (const bibPath of collectBibliographyResourcePathsFromFileMap(scanFileMap ?? fileMap)) {
    if (fileMap[bibPath] || !shouldIncludeFile(bibPath)) {
      continue;
    }
    try {
      fileMap[bibPath] = await readTextFile(bibPath);
    } catch {
      // Let the native LaTeX run report the missing bibliography resource.
    }
  }
}
