import { readFile } from "../../shared/api/workspace";
import { isSafeCitationKey, sanitizeCitationKey } from "./researchCitationAssist";

export type LocalCitationSuggestion = {
  key: string;
  title: string;
  author: string;
  year: string;
  sourcePath: string;
};

const LOCAL_CITATION_CACHE_TTL_MS = 12_000;
const LOCAL_CITATION_CACHE_MAX_KEYS = 24;
const localCitationCache = new Map<string, { expiresAt: number; suggestions: LocalCitationSuggestion[] }>();

function readBibField(body: string, name: string): string {
  const match = body.match(new RegExp(`${name}\\s*=\\s*(?:\\{([^}]*)\\}|"([^"]*)"|'([^']*)'|([^,\\n]+))`, "i"));
  return String(match?.[1] ?? match?.[2] ?? match?.[3] ?? match?.[4] ?? "").trim();
}

function stableSourceHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return String(hash >>> 0);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizePath(value: string): string {
  const parts: string[] = [];
  for (const part of value.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+/g, "/").trim().split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function dirname(path: string | null): string {
  const normalized = normalizePath(path ?? "");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "";
}

function resolveRelativePath(baseDir: string, value: string): string {
  const clean = value.replace(/\\/g, "/").replace(/^['"]|['"]$/g, "").trim();
  const withExt = /\.bib$/i.test(clean) ? clean : `${clean}.bib`;
  if (!baseDir || withExt.startsWith(".latotex/")) {
    return normalizePath(withExt);
  }
  return normalizePath(`${baseDir}/${withExt}`);
}

function findKnownPath(candidate: string, fileList: string[]): string {
  const normalized = normalizePath(candidate);
  const lower = normalized.toLowerCase();
  return fileList.find((path) => normalizePath(path).toLowerCase() === lower) ?? normalized;
}

export function extractCitationLookupBibPaths(
  texSource: string,
  selectedFile: string | null,
  fileList: string[],
): string[] {
  const baseDir = dirname(selectedFile);
  const candidates: string[] = [];
  for (const match of texSource.matchAll(/\\bibliography\s*\{([^}]+)\}/g)) {
    for (const item of String(match[1] ?? "").split(",")) {
      candidates.push(resolveRelativePath(baseDir, item));
    }
  }
  for (const match of texSource.matchAll(/\\addbibresource(?:\[[^\]]*])?\s*\{([^}]+)\}/g)) {
    candidates.push(resolveRelativePath(baseDir, String(match[1] ?? "")));
  }
  const declared = unique(candidates.map((item) => findKnownPath(item, fileList)));
  if (declared.length > 0) {
    return declared.slice(0, 20);
  }
  return fileList
    .map(normalizePath)
    .filter((path) => /\.bib$/i.test(path))
    .slice(0, 20);
}

function pruneLocalCitationCache(now = Date.now()) {
  for (const [key, value] of localCitationCache.entries()) {
    if (value.expiresAt <= now) {
      localCitationCache.delete(key);
    }
  }
  while (localCitationCache.size > LOCAL_CITATION_CACHE_MAX_KEYS) {
    const oldest = localCitationCache.keys().next().value as string | undefined;
    if (!oldest) {
      break;
    }
    localCitationCache.delete(oldest);
  }
}

export function clearLocalCitationLookupCacheForTests() {
  localCitationCache.clear();
}

export function parseBibCitationSuggestions(
  bibSources: Record<string, string>,
): LocalCitationSuggestion[] {
  const suggestions: LocalCitationSuggestion[] = [];
  const seen = new Set<string>();
  for (const [sourcePath, source] of Object.entries(bibSources)) {
    for (const match of source.matchAll(/@(\w+)\s*\{\s*([^,\s]+)\s*,([\s\S]*?)(?=\n\s*@\w+\s*\{|$)/g)) {
      const key = sanitizeCitationKey(String(match[2] ?? ""));
      if (!key || !isSafeCitationKey(key) || seen.has(key.toLowerCase())) {
        continue;
      }
      const body = String(match[3] ?? "");
      suggestions.push({
        key,
        title: readBibField(body, "title"),
        author: readBibField(body, "author"),
        year: readBibField(body, "year"),
        sourcePath,
      });
      seen.add(key.toLowerCase());
    }
  }
  return suggestions;
}

function filterCitationSuggestions(
  suggestions: LocalCitationSuggestion[],
  prefix: string,
  limit: number,
): LocalCitationSuggestion[] {
  const normalized = sanitizeCitationKey(prefix).toLowerCase();
  const query = normalized.replace(/^@/, "");
  const scored = suggestions
    .map((item) => {
      const key = item.key.toLowerCase();
      const haystack = `${item.title} ${item.author} ${item.year}`.toLowerCase();
      const score = !query
        ? 0
        : key.startsWith(query)
          ? 3
          : key.includes(query)
            ? 2
            : haystack.includes(query)
              ? 1
              : -1;
      return { item, score };
    })
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score || left.item.key.localeCompare(right.item.key));
  return scored.slice(0, limit).map((entry) => entry.item);
}

export async function loadLocalCitationSuggestions(input: {
  projectId: string | null;
  selectedFile: string | null;
  texSource: string;
  fileList: string[];
  prefix: string;
  limit?: number;
}): Promise<LocalCitationSuggestion[]> {
  const { projectId, selectedFile, texSource, fileList, prefix, limit = 40 } = input;
  if (!projectId) {
    return [];
  }
  const bibPaths = extractCitationLookupBibPaths(texSource, selectedFile, fileList);
  if (bibPaths.length === 0) {
    return [];
  }
  pruneLocalCitationCache();
  const cacheKey = JSON.stringify({
    projectId,
    selectedFile,
    bibPaths,
    sourceHash: stableSourceHash(texSource),
  });
  const cached = localCitationCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return filterCitationSuggestions(cached.suggestions, prefix, limit);
  }
  const sources: Record<string, string> = {};
  const results = await Promise.all(
    bibPaths.map(async (path) => {
      try {
        const response = await readFile(projectId, path);
        return { path, content: response.content ?? "" };
      } catch {
        return { path, content: "" };
      }
    }),
  );
  for (const result of results) {
    if (result.content) {
      sources[result.path] = result.content;
    }
  }
  const suggestions = parseBibCitationSuggestions(sources);
  localCitationCache.set(cacheKey, {
    expiresAt: Date.now() + LOCAL_CITATION_CACHE_TTL_MS,
    suggestions,
  });
  pruneLocalCitationCache();
  return filterCitationSuggestions(suggestions, prefix, limit);
}
