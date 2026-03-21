export type CompileInstallProgress = {
  active: boolean;
  percent: number;
  stage: "installing" | "retrying";
  currentPackage: string | null;
  completed: number;
  total: number;
  message: string;
};

const COMPILE_SKIP_EXTENSIONS = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "webp",
  "ico",
  "svg",
  "zip",
  "7z",
  "rar",
  "mp4",
  "mp3",
  "wav",
  "ogg",
  "mov",
  "avi",
  "wasm",
  "dll",
  "exe",
  "bin",
]);

const COMBINED_DIAGNOSTIC_SPLIT_RE = /(\.xdv)(No output PDF file written(?:\.[A-Za-z0-9_-]+)?\.?)/gi;

export function shouldIncludeCompileFile(path: string): boolean {
  const normalized = path.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  const dot = normalized.lastIndexOf(".");
  if (dot < 0 || dot === normalized.length - 1) {
    return true;
  }
  const extension = normalized.slice(dot + 1);
  return !COMPILE_SKIP_EXTENSIONS.has(extension);
}

export function splitDiagnosticLines(value: string): string[] {
  const text = String(value || "").replace(COMBINED_DIAGNOSTIC_SPLIT_RE, "$1\n$2");
  return text
    .split(/\r?\n/)
    .map((line) => String(line || "").trim())
    .filter((line) => line.length > 0);
}

export function normalizeFontName(input: string): string {
  return String(input || "")
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function isLikelyFontFamily(input: string): boolean {
  const normalized = normalizeFontName(input);
  if (normalized.length < 3) {
    return false;
  }
  return /[a-z]/i.test(normalized);
}