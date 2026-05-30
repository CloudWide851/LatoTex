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
  mdx: { monaco: "mdx", highlight: "markdown" },
  txt: { monaco: "plaintext", highlight: null },
  csv: { monaco: "csv", highlight: null },
  tsv: { monaco: "csv", highlight: null },
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
  vue: { monaco: "html", highlight: "xml" },
  svelte: { monaco: "html", highlight: "xml" },
  graphql: { monaco: "graphql", highlight: "graphql" },
  gql: { monaco: "graphql", highlight: "graphql" },
  py: { monaco: "python", highlight: "python" },
  ipynb: { monaco: "json", highlight: "json" },
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
  fs: { monaco: "fsharp", highlight: "fsharp" },
  fsx: { monaco: "fsharp", highlight: "fsharp" },
  sh: { monaco: "shell", highlight: "bash" },
  bash: { monaco: "shell", highlight: "bash" },
  zsh: { monaco: "shell", highlight: "bash" },
  fish: { monaco: "shell", highlight: "bash" },
  ps1: { monaco: "powershell", highlight: "powershell" },
  sql: { monaco: "sql", highlight: "sql" },
  php: { monaco: "php", highlight: "php" },
  rb: { monaco: "ruby", highlight: "ruby" },
  gemspec: { monaco: "ruby", highlight: "ruby" },
  pl: { monaco: "perl", highlight: "perl" },
  pm: { monaco: "perl", highlight: "perl" },
  r: { monaco: "r", highlight: "r" },
  lua: { monaco: "lua", highlight: "lua" },
  makefile: { monaco: "plaintext", highlight: "makefile" },
  mk: { monaco: "plaintext", highlight: "makefile" },
  gradle: { monaco: "groovy", highlight: "gradle" },
  hcl: { monaco: "hcl", highlight: null },
  proto: { monaco: "protobuf", highlight: "protobuf" },
  dockerfile: { monaco: "dockerfile", highlight: "dockerfile" },
  dockerignore: { monaco: "ignore", highlight: null },
  gitignore: { monaco: "ignore", highlight: null },
  editorconfig: { monaco: "editorconfig", highlight: "ini" },
  env: { monaco: "shell", highlight: "bash" },
  npmrc: { monaco: "ini", highlight: "ini" },
  yarnrc: { monaco: "ini", highlight: "ini" },
  log: { monaco: "plaintext", highlight: null },
};

function normalizePath(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/\\/g, "/");
}

export function extensionOfPath(path: string | null | undefined): string {
  const normalized = normalizePath(path).toLowerCase();
  const basename = normalized.split("/").pop() || normalized;
  const special = new Set([
    "dockerfile",
    "makefile",
    "gemfile",
    ".gitignore",
    ".dockerignore",
    ".editorconfig",
    ".npmrc",
    ".yarnrc",
    ".env",
  ]);
  if (special.has(basename)) {
    return basename.replace(/^\./, "");
  }
  if (basename.startsWith(".env.")) {
    return "env";
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

export function resolveCodeLanguageTag(path: string | null | undefined): string {
  const extension = extensionOfPath(path);
  return extension || "plaintext";
}

export function isLatexLikePath(path: string | null | undefined): boolean {
  return ["tex", "bib", "sty", "cls", "ltx", "tikz", "pgf"].includes(extensionOfPath(path));
}

export type { CodeLanguageInfo };
