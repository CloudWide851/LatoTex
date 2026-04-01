type CodeLanguageInfo = {
  monaco: string;
  highlight: string | null;
};

const CODE_LANGUAGE_BY_EXTENSION: Record<string, CodeLanguageInfo> = {
  tex: { monaco: "latex", highlight: "latex" },
  bib: { monaco: "bibtex", highlight: "latex" },
  sty: { monaco: "latex", highlight: "latex" },
  cls: { monaco: "latex", highlight: "latex" },
  ltx: { monaco: "latex", highlight: "latex" },
  tikz: { monaco: "latex", highlight: "latex" },
  pgf: { monaco: "latex", highlight: "latex" },
  md: { monaco: "markdown", highlight: "markdown" },
  markdown: { monaco: "markdown", highlight: "markdown" },
  txt: { monaco: "plaintext", highlight: null },
  json: { monaco: "json", highlight: "json" },
  jsonl: { monaco: "json", highlight: "json" },
  yaml: { monaco: "yaml", highlight: "yaml" },
  yml: { monaco: "yaml", highlight: "yaml" },
  toml: { monaco: "ini", highlight: "toml" },
  ini: { monaco: "ini", highlight: "ini" },
  xml: { monaco: "xml", highlight: "xml" },
  html: { monaco: "html", highlight: "xml" },
  htm: { monaco: "html", highlight: "xml" },
  css: { monaco: "css", highlight: "css" },
  scss: { monaco: "scss", highlight: "scss" },
  less: { monaco: "less", highlight: "less" },
  js: { monaco: "javascript", highlight: "javascript" },
  jsx: { monaco: "javascript", highlight: "javascript" },
  mjs: { monaco: "javascript", highlight: "javascript" },
  cjs: { monaco: "javascript", highlight: "javascript" },
  ts: { monaco: "typescript", highlight: "typescript" },
  tsx: { monaco: "typescript", highlight: "typescript" },
  py: { monaco: "python", highlight: "python" },
  rs: { monaco: "rust", highlight: "rust" },
  go: { monaco: "go", highlight: "go" },
  java: { monaco: "java", highlight: "java" },
  kt: { monaco: "kotlin", highlight: "kotlin" },
  kts: { monaco: "kotlin", highlight: "kotlin" },
  swift: { monaco: "swift", highlight: "swift" },
  dart: { monaco: "dart", highlight: "dart" },
  c: { monaco: "c", highlight: "c" },
  h: { monaco: "c", highlight: "c" },
  cpp: { monaco: "cpp", highlight: "cpp" },
  cxx: { monaco: "cpp", highlight: "cpp" },
  cc: { monaco: "cpp", highlight: "cpp" },
  hpp: { monaco: "cpp", highlight: "cpp" },
  cs: { monaco: "csharp", highlight: "csharp" },
  sh: { monaco: "shell", highlight: "bash" },
  bash: { monaco: "shell", highlight: "bash" },
  zsh: { monaco: "shell", highlight: "bash" },
  fish: { monaco: "shell", highlight: "bash" },
  ps1: { monaco: "powershell", highlight: "powershell" },
  sql: { monaco: "sql", highlight: "sql" },
  dockerfile: { monaco: "dockerfile", highlight: "dockerfile" },
};

function normalizePath(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/\\/g, "/");
}

export function extensionOfPath(path: string | null | undefined): string {
  const normalized = normalizePath(path).toLowerCase();
  const basename = normalized.split("/").pop() || normalized;
  if (basename === "dockerfile") {
    return "dockerfile";
  }
  const dot = basename.lastIndexOf(".");
  if (dot < 0 || dot === basename.length - 1) {
    return "";
  }
  return basename.slice(dot + 1);
}

export function resolveCodeLanguage(path: string | null | undefined): CodeLanguageInfo {
  const extension = extensionOfPath(path);
  return CODE_LANGUAGE_BY_EXTENSION[extension] ?? { monaco: "plaintext", highlight: null };
}

export function isLatexLikePath(path: string | null | undefined): boolean {
  return ["tex", "bib", "sty", "cls", "ltx", "tikz", "pgf"].includes(extensionOfPath(path));
}

