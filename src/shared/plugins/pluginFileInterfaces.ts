import { extensionOfPath } from "../utils/codeLanguage";
import type { InstalledPlugin, PluginContribution, PluginManifest } from "./pluginTypes";

export type PluginFileInterfaceResolution = {
  editorLanguage: string | null;
  openWith: string | null;
  previewMode: string | null;
  pluginId: string | null;
  contributionId: string | null;
};

export function enabledPluginManifests(plugins: InstalledPlugin[]): PluginManifest[] {
  return plugins
    .filter((plugin) => plugin.enabled)
    .map((plugin) => plugin.manifest);
}

export function resolvePluginFileInterface(
  path: string | null | undefined,
  manifests: PluginManifest[],
): PluginFileInterfaceResolution {
  const empty: PluginFileInterfaceResolution = {
    editorLanguage: null,
    openWith: null,
    previewMode: null,
    pluginId: null,
    contributionId: null,
  };
  const normalizedPath = normalizePath(path);
  if (!normalizedPath) {
    return empty;
  }
  let resolved = empty;
  for (const manifest of manifests) {
    for (const contribution of manifest.contributions ?? []) {
      const next = resolveContribution(normalizedPath, manifest.id, contribution, resolved);
      if (next !== resolved) {
        resolved = next;
      }
      if (resolved.editorLanguage && resolved.openWith && resolved.previewMode) {
        return resolved;
      }
    }
  }
  return resolved;
}

export function textBackedPluginPreviewMode(mode: string | null | undefined): "markdown" | "html" | "csv" | null {
  const normalized = String(mode ?? "").trim().toLowerCase();
  if (normalized === "markdown" || normalized === "md") {
    return "markdown";
  }
  if (normalized === "html") {
    return "html";
  }
  if (normalized === "csv" || normalized === "tsv") {
    return "csv";
  }
  return null;
}

function resolveContribution(
  normalizedPath: string,
  pluginId: string,
  contribution: PluginContribution,
  current: PluginFileInterfaceResolution,
): PluginFileInterfaceResolution {
  if (contribution.kind === "languageSupport" && contribution.languageSupport) {
    const language = contribution.languageSupport;
    if (!matchesPath(normalizedPath, language.extensions, language.filenames, language.patterns)) {
      return current;
    }
    return {
      ...current,
      editorLanguage: current.editorLanguage ?? language.editorLanguage ?? language.language,
      previewMode: current.previewMode ?? language.previewMode ?? null,
      pluginId: current.pluginId ?? pluginId,
      contributionId: current.contributionId ?? contribution.id,
    };
  }
  if (contribution.kind === "previewProvider" && contribution.previewProvider) {
    const provider = contribution.previewProvider;
    if (!matchesPath(normalizedPath, provider.extensions, provider.filenames, provider.patterns)) {
      return current;
    }
    return {
      ...current,
      previewMode: current.previewMode ?? provider.previewMode,
      pluginId: current.pluginId ?? pluginId,
      contributionId: current.contributionId ?? contribution.id,
    };
  }
  if (contribution.kind === "fileOpenHandler" && contribution.fileOpenHandler) {
    const handler = contribution.fileOpenHandler;
    if (!matchesPath(normalizedPath, handler.extensions, handler.filenames, handler.patterns)) {
      return current;
    }
    return {
      ...current,
      openWith: current.openWith ?? handler.openWith,
      pluginId: current.pluginId ?? pluginId,
      contributionId: current.contributionId ?? contribution.id,
    };
  }
  return current;
}

function matchesPath(
  normalizedPath: string,
  extensions: string[] | null | undefined,
  filenames: string[] | null | undefined,
  patterns: string[] | null | undefined,
): boolean {
  const extension = extensionOfPath(normalizedPath).toLowerCase();
  const basename = normalizedPath.split("/").pop()?.toLowerCase() ?? normalizedPath;
  if ((extensions ?? []).some((item) => normalizeExtension(item) === extension)) {
    return true;
  }
  if ((filenames ?? []).some((item) => normalizePath(item).toLowerCase() === basename)) {
    return true;
  }
  return (patterns ?? []).some((pattern) => globToRegExp(pattern).test(normalizedPath));
}

function normalizePath(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
}

function normalizeExtension(value: string): string {
  return String(value ?? "").trim().toLowerCase().replace(/^\./, "");
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizePath(pattern).toLowerCase();
  let output = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === "*" && next === "*") {
      const after = normalized[index + 2];
      if (after === "/") {
        output += "(?:.*/)?";
        index += 2;
      } else {
        output += ".*";
        index += 1;
      }
      continue;
    }
    if (char === "*") {
      output += "[^/]*";
      continue;
    }
    if (char === "?") {
      output += "[^/]";
      continue;
    }
    output += escapeRegExp(char);
  }
  output += "$";
  return new RegExp(output);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}
