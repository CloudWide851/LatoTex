export type FontFallbackReplacement = {
  missing: string;
  fallback: string;
};

const FONT_FALLBACK_TEXT_EXT_RE = /\.(tex|sty|cls|ltx|cfg|def|fd|bbx|cbx|bst)$/i;

export function collectConfiguredFontsFromCompileMap(
  fileMap: Record<string, string>,
  extractConfiguredSystemFontsFromSource: (source: string) => string[],
  normalizeFontName: (value: string) => string,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const [path, content] of Object.entries(fileMap)) {
    if (!FONT_FALLBACK_TEXT_EXT_RE.test(path)) {
      continue;
    }
    for (const family of extractConfiguredSystemFontsFromSource(content)) {
      const key = normalizeFontName(family);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(family);
    }
  }
  return out;
}

export function applyFontFallbackToCompileMap(
  fileMap: Record<string, string>,
  mainPath: string,
  missingFonts: string[],
  applySystemFontFallbackToSource: (
    source: string,
    missing: string[],
  ) => { patchedSource: string; replacements: FontFallbackReplacement[] },
): {
  mainSource: string;
  overlays: Record<string, string>;
  replacements: FontFallbackReplacement[];
  changed: boolean;
} {
  const overlays: Record<string, string> = {};
  const replacementMap = new Map<string, FontFallbackReplacement>();
  let changed = false;
  let mainSource = fileMap[mainPath] ?? "";

  for (const [path, content] of Object.entries(fileMap)) {
    if (!FONT_FALLBACK_TEXT_EXT_RE.test(path)) {
      continue;
    }
    const patched = applySystemFontFallbackToSource(content, missingFonts);
    if (patched.patchedSource === content || patched.replacements.length === 0) {
      continue;
    }
    changed = true;
    for (const item of patched.replacements) {
      replacementMap.set(`${item.missing}|${item.fallback}`, item);
    }
    if (path === mainPath) {
      mainSource = patched.patchedSource;
    } else {
      overlays[path] = patched.patchedSource;
    }
  }

  return {
    mainSource,
    overlays,
    replacements: Array.from(replacementMap.values()),
    changed,
  };
}