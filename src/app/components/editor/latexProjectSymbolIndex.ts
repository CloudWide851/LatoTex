import { readFile } from "../../../shared/api/desktop";

const INDEXABLE_FILE = /\.(tex|bib|sty|cls|bst|bbx|cbx|ltx|tikz|pgf|md|txt|csv|tsv|json|jsonl)$/i;
const MAX_FILES = 180;
const MAX_FILE_CHARS = 64_000;
const MAX_SYMBOLS = 3_200;

type IndexEntry = {
  stamp: string;
  symbols: string[];
  ready: boolean;
  loading?: Promise<void>;
};

const projectIndex = new Map<string, IndexEntry>();

function collectUniqueMatches(text: string, pattern: RegExp, mapper?: (value: string) => string): string[] {
  const out = new Set<string>();
  let match: RegExpExecArray | null = pattern.exec(text);
  while (match) {
    const mapped = mapper ? mapper(String(match[1] ?? "")) : String(match[1] ?? "");
    const value = mapped.trim();
    if (value) {
      out.add(value);
      if (out.size >= MAX_SYMBOLS) {
        break;
      }
    }
    match = pattern.exec(text);
  }
  return Array.from(out);
}

function extractSymbolsFromText(text: string): string[] {
  const out = new Set<string>();
  const commandDefs = collectUniqueMatches(
    text,
    /\\(?:re)?newcommand\*?\s*\{\\([A-Za-z@]+)\}/g,
    (value) => `\\${value}`,
  );
  const defDefs = collectUniqueMatches(text, /\\def\\([A-Za-z@]+)\b/g, (value) => `\\${value}`);
  const labels = collectUniqueMatches(text, /\\label\{([^}]+)\}/g);
  const cites = collectUniqueMatches(text, /\\cite[a-zA-Z*]*\{([^}]+)\}/g)
    .flatMap((item) => item.split(","))
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const commands = collectUniqueMatches(text, /\\([A-Za-z@]{2,})/g, (value) => `\\${value}`);
  const words = collectUniqueMatches(text, /\b([A-Za-z_][A-Za-z0-9_:-]{2,})\b/g);

  for (const item of [...commandDefs, ...defDefs, ...labels, ...cites, ...commands, ...words]) {
    if (!item) {
      continue;
    }
    out.add(item);
    if (out.size >= MAX_SYMBOLS) {
      break;
    }
  }
  return Array.from(out);
}

function buildStamp(fileList: string[], selectedFile: string | null): string {
  return `${selectedFile ?? ""}::${fileList.slice().sort().join("|")}`;
}

export function scheduleProjectSymbolIndexSync(params: {
  projectId: string | null;
  fileList: string[];
  selectedFile: string | null;
  selectedFileContent: string;
}) {
  const { projectId, fileList, selectedFile, selectedFileContent } = params;
  if (!projectId) {
    return;
  }
  const candidates = fileList
    .filter((path) => INDEXABLE_FILE.test(path))
    .slice(0, MAX_FILES);
  const stamp = buildStamp(candidates, selectedFile);
  const existing = projectIndex.get(projectId);
  if (existing && existing.stamp === stamp && (existing.ready || existing.loading)) {
    return;
  }

  const entry: IndexEntry = {
    stamp,
    symbols: [],
    ready: false,
  };
  const loadPromise = (async () => {
    const out = new Set<string>();
    if (selectedFile && INDEXABLE_FILE.test(selectedFile) && selectedFileContent.trim()) {
      for (const symbol of extractSymbolsFromText(selectedFileContent.slice(0, MAX_FILE_CHARS))) {
        out.add(symbol);
      }
    }
    for (const path of candidates) {
      if (selectedFile && path === selectedFile) {
        continue;
      }
      try {
        const file = await readFile(projectId, path);
        const content = file.content.slice(0, MAX_FILE_CHARS);
        for (const symbol of extractSymbolsFromText(content)) {
          out.add(symbol);
          if (out.size >= MAX_SYMBOLS) {
            break;
          }
        }
        if (out.size >= MAX_SYMBOLS) {
          break;
        }
      } catch {
        // Ignore per-file indexing failure.
      }
    }
    entry.symbols = Array.from(out).sort((a, b) => a.localeCompare(b));
    entry.ready = true;
    entry.loading = undefined;
  })();
  entry.loading = loadPromise;
  projectIndex.set(projectId, entry);
}

export async function getIndexedProjectSymbols(params: {
  projectId: string | null;
  fileList: string[];
  selectedFile: string | null;
  selectedFileContent: string;
  prefix: string;
  limit?: number;
}): Promise<string[]> {
  const { projectId, fileList, selectedFile, selectedFileContent, prefix, limit = 40 } = params;
  if (!projectId) {
    return [];
  }
  scheduleProjectSymbolIndexSync({
    projectId,
    fileList,
    selectedFile,
    selectedFileContent,
  });
  const entry = projectIndex.get(projectId);
  if (!entry) {
    return [];
  }
  if (entry.loading && !entry.ready) {
    await Promise.race([entry.loading, new Promise((resolve) => setTimeout(resolve, 160))]);
  }
  if (!entry.symbols.length) {
    return [];
  }
  const normalizedPrefix = prefix.trim().toLowerCase();
  if (!normalizedPrefix) {
    return entry.symbols.slice(0, limit);
  }
  const startsWith = entry.symbols.filter((item) => item.toLowerCase().startsWith(normalizedPrefix));
  const includes = entry.symbols.filter(
    (item) => !item.toLowerCase().startsWith(normalizedPrefix) && item.toLowerCase().includes(normalizedPrefix),
  );
  return [...startsWith, ...includes].slice(0, limit);
}
