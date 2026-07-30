const LATEX_LANGUAGE_ID = "latex";
const BIBTEX_LANGUAGE_ID = "bibtex";
const CSV_LANGUAGE_ID = "csv";
const IGNORE_LANGUAGE_ID = "ignore";
const EDITORCONFIG_LANGUAGE_ID = "editorconfig";
const MATLAB_LANGUAGE_ID = "matlab";
const JULIA_LANGUAGE_ID = "julia";
const registeredMonacoInstances = new WeakSet<object>();
const loadedDeferredLanguages = new Set<string>();

const DEFERRED_LANGUAGE_LOADERS: Record<string, () => Promise<unknown>> = {
  bat: () => import("monaco-editor/esm/vs/basic-languages/bat/bat.contribution.js"),
  cpp: () => import("monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js"),
  csharp: () => import("monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution.js"),
  css: () => import("monaco-editor/esm/vs/basic-languages/css/css.contribution.js"),
  dart: () => import("monaco-editor/esm/vs/basic-languages/dart/dart.contribution.js"),
  dockerfile: () => import("monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.contribution.js"),
  fsharp: () => import("monaco-editor/esm/vs/basic-languages/fsharp/fsharp.contribution.js"),
  go: () => import("monaco-editor/esm/vs/basic-languages/go/go.contribution.js"),
  graphql: () => import("monaco-editor/esm/vs/basic-languages/graphql/graphql.contribution.js"),
  hcl: () => import("monaco-editor/esm/vs/basic-languages/hcl/hcl.contribution.js"),
  html: () => import("monaco-editor/esm/vs/basic-languages/html/html.contribution.js"),
  ini: () => import("monaco-editor/esm/vs/basic-languages/ini/ini.contribution.js"),
  java: () => import("monaco-editor/esm/vs/basic-languages/java/java.contribution.js"),
  javascript: () => import("monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js"),
  kotlin: () => import("monaco-editor/esm/vs/basic-languages/kotlin/kotlin.contribution.js"),
  less: () => import("monaco-editor/esm/vs/basic-languages/less/less.contribution.js"),
  lua: () => import("monaco-editor/esm/vs/basic-languages/lua/lua.contribution.js"),
  markdown: () => import("monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js"),
  mdx: () => import("monaco-editor/esm/vs/basic-languages/mdx/mdx.contribution.js"),
  perl: () => import("monaco-editor/esm/vs/basic-languages/perl/perl.contribution.js"),
  php: () => import("monaco-editor/esm/vs/basic-languages/php/php.contribution.js"),
  powershell: () => import("monaco-editor/esm/vs/basic-languages/powershell/powershell.contribution.js"),
  protobuf: () => import("monaco-editor/esm/vs/basic-languages/protobuf/protobuf.contribution.js"),
  python: () => import("monaco-editor/esm/vs/basic-languages/python/python.contribution.js"),
  r: () => import("monaco-editor/esm/vs/basic-languages/r/r.contribution.js"),
  ruby: () => import("monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution.js"),
  rust: () => import("monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js"),
  scss: () => import("monaco-editor/esm/vs/basic-languages/scss/scss.contribution.js"),
  shell: () => import("monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js"),
  sql: () => import("monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js"),
  swift: () => import("monaco-editor/esm/vs/basic-languages/swift/swift.contribution.js"),
  typescript: () => import("monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js"),
  xml: () => import("monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js"),
  yaml: () => import("monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js"),
};

const LATEX_CONFIGURATION = {
  comments: { lineComment: "%" },
  brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: "$", close: "$" },
  ],
};

const LATEX_TOKENS = {
  tokenizer: {
    root: [
      [/%.+$/, "comment"],
      [/\\(?:begin|end)(?=\s*\{)/, "keyword.control"],
      [/\\(?:cite|citep|citet|ref|eqref|label|url|href|includegraphics|input|include|bibliography|addbibresource)\b/, "keyword"],
      [/\\(?:documentclass|usepackage|title|author|date|maketitle|section|subsection|subsubsection|paragraph|caption)\b/, "keyword.declaration"],
      [/\\(?:[a-zA-Z@]+|.)/, "keyword"],
      [/\{(?:document|abstract|figure|table|equation|align|itemize|enumerate|thebibliography|tikzpicture)\}/, "type.identifier"],
      [/\[[^\]]*\]/, "attribute.value"],
      [/\{[^{}]*\}/, "string"],
      [/\$\$?/, "string.delimiter"],
      [/[{}[\]()]/, "delimiter.bracket"],
      [/[&_^#~]/, "operator"],
      [/\d+(?:\.\d+)?/, "number"],
      [/[a-zA-Z]+/, "identifier"],
    ],
  },
};

const BIBTEX_CONFIGURATION = {
  comments: { lineComment: "%" },
  brackets: [["{", "}"], ["(", ")"]],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
  ],
};

const BIBTEX_TOKENS = {
  tokenizer: {
    root: [
      [/%.+$/, "comment"],
      [/@(?:article|book|inproceedings|proceedings|incollection|phdthesis|mastersthesis|techreport|misc|online|comment|preamble|string|[a-zA-Z]+)/, "keyword"],
      [/\b[a-zA-Z][\w:-]*(?=\s*=)/, "attribute.name"],
      [/\b(?:author|title|journal|booktitle|year|doi|url|publisher|volume|number|pages|abstract|keywords)\b(?=\s*=)/, "attribute.name"],
      [/\b\d{4}\b/, "number"],
      [/[{}()]/, "delimiter.bracket"],
      [/=/, "operator"],
      [/"(?:[^"\\]|\\.)*"/, "string"],
      [/[#,]/, "delimiter"],
      [/\\./, "keyword"],
      [/[a-zA-Z][\w:-]*/, "identifier"],
    ],
  },
};

const CSV_TOKENS = {
  tokenizer: {
    root: [
      [/"(?:[^"]|"")*"/, "string"],
      [/\b-?\d+(?:\.\d+)?\b/, "number"],
      [/[,\t;]/, "delimiter"],
      [/[^,\t;]+/, "identifier"],
    ],
  },
};

const IGNORE_TOKENS = {
  comments: { lineComment: "#" },
  tokenizer: {
    root: [
      [/#.*$/, "comment"],
      [/!.*$/, "keyword"],
      [/\*\*|\*|\?/, "operator"],
      [/\//, "delimiter"],
      [/[^#*!?/]+/, "string"],
    ],
  },
};

const EDITORCONFIG_TOKENS = {
  comments: { lineComment: "#" },
  tokenizer: {
    root: [
      [/[#;].*$/, "comment"],
      [/\[[^\]]+\]/, "keyword"],
      [/\b[a-zA-Z_][\w-]*(?=\s*=)/, "attribute.name"],
      [/=.*/, "string"],
    ],
  },
};

const MATLAB_CONFIGURATION = {
  comments: { lineComment: "%" },
  brackets: [["(", ")"], ["[", "]"], ["{", "}"]],
  autoClosingPairs: [
    { open: "(", close: ")" },
    { open: "[", close: "]" },
    { open: "{", close: "}" },
    { open: "\"", close: "\"" },
    { open: "'", close: "'" },
  ],
};

const MATLAB_TOKENS = {
  tokenizer: {
    root: [
      [/%.*$/, "comment"],
      [/\b(?:break|case|catch|classdef|continue|else|elseif|end|for|function|global|if|otherwise|parfor|persistent|return|spmd|switch|try|while)\b/, "keyword"],
      [/\b(?:true|false|NaN|Inf|pi|eps)\b/, "constant"],
      [/\b(?:readtable|writetable|fitlm|anova|ttest|ranksum|corr|mean|median|std|plot|histogram)\b(?=\s*\()/, "type.identifier"],
      [/\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, "number"],
      [/"(?:[^"\\]|\\.)*"/, "string"],
      [/'(?:[^']|'')*'/, "string"],
      [/[+\-*\/\\^=<>~:&|]+/, "operator"],
      [/[a-zA-Z]\w*/, "identifier"],
    ],
  },
};

const JULIA_CONFIGURATION = {
  comments: { lineComment: "#", blockComment: ["#=", "=#"] },
  brackets: [["(", ")"], ["[", "]"], ["{", "}"]],
  autoClosingPairs: [
    { open: "(", close: ")" },
    { open: "[", close: "]" },
    { open: "{", close: "}" },
    { open: "\"", close: "\"" },
  ],
};

const JULIA_TOKENS = {
  tokenizer: {
    root: [
      [/#=.*?=#/, "comment"],
      [/#.*$/, "comment"],
      [/\b(?:baremodule|begin|break|catch|const|continue|do|else|elseif|end|export|finally|for|function|global|if|import|let|local|macro|module|quote|return|struct|try|using|while)\b/, "keyword"],
      [/\b(?:true|false|nothing|missing|NaN|Inf)\b/, "constant"],
      [/\b(?:DataFrame|CSV|Statistics|Distributions|GLM|HypothesisTests)\b/, "type.identifier"],
      [/\d+(?:\.\d+)?(?:[eEfF][+-]?\d+)?/, "number"],
      [/"""[\s\S]*?"""/, "string"],
      [/"(?:[^"\\]|\\.)*"/, "string"],
      [/:[a-zA-Z_]\w*/, "string"],
      [/[+\-*\/\\^=<>!~:&|]+/, "operator"],
      [/[a-zA-Z_]\w*[!?]?/, "identifier"],
    ],
  },
};

function ensureLanguage(monaco: any, id: string) {
  const exists = monaco.languages.getLanguages().some((language: { id: string }) => language.id === id);
  if (!exists) {
    monaco.languages.register({ id });
  }
}

export function registerEditorCodeLanguages(monaco: any) {
  if (!monaco || typeof monaco !== "object") {
    return;
  }
  if (registeredMonacoInstances.has(monaco)) {
    return;
  }
  registeredMonacoInstances.add(monaco);
  ensureLanguage(monaco, LATEX_LANGUAGE_ID);
  ensureLanguage(monaco, BIBTEX_LANGUAGE_ID);
  ensureLanguage(monaco, CSV_LANGUAGE_ID);
  ensureLanguage(monaco, IGNORE_LANGUAGE_ID);
  ensureLanguage(monaco, EDITORCONFIG_LANGUAGE_ID);
  ensureLanguage(monaco, MATLAB_LANGUAGE_ID);
  ensureLanguage(monaco, JULIA_LANGUAGE_ID);
  monaco.languages.setLanguageConfiguration(LATEX_LANGUAGE_ID, LATEX_CONFIGURATION);
  monaco.languages.setMonarchTokensProvider(LATEX_LANGUAGE_ID, LATEX_TOKENS);
  monaco.languages.setLanguageConfiguration(BIBTEX_LANGUAGE_ID, BIBTEX_CONFIGURATION);
  monaco.languages.setMonarchTokensProvider(BIBTEX_LANGUAGE_ID, BIBTEX_TOKENS);
  monaco.languages.setMonarchTokensProvider(CSV_LANGUAGE_ID, CSV_TOKENS);
  monaco.languages.setLanguageConfiguration(IGNORE_LANGUAGE_ID, IGNORE_TOKENS);
  monaco.languages.setMonarchTokensProvider(IGNORE_LANGUAGE_ID, IGNORE_TOKENS);
  monaco.languages.setLanguageConfiguration(EDITORCONFIG_LANGUAGE_ID, EDITORCONFIG_TOKENS);
  monaco.languages.setMonarchTokensProvider(EDITORCONFIG_LANGUAGE_ID, EDITORCONFIG_TOKENS);
  monaco.languages.setLanguageConfiguration(MATLAB_LANGUAGE_ID, MATLAB_CONFIGURATION);
  monaco.languages.setMonarchTokensProvider(MATLAB_LANGUAGE_ID, MATLAB_TOKENS);
  monaco.languages.setLanguageConfiguration(JULIA_LANGUAGE_ID, JULIA_CONFIGURATION);
  monaco.languages.setMonarchTokensProvider(JULIA_LANGUAGE_ID, JULIA_TOKENS);
}

export async function loadDeferredEditorLanguage(language: string | null | undefined) {
  const normalized = String(language ?? "").trim();
  if (!normalized || loadedDeferredLanguages.has(normalized)) {
    return;
  }
  const loader = DEFERRED_LANGUAGE_LOADERS[normalized];
  if (!loader) {
    return;
  }
  loadedDeferredLanguages.add(normalized);
  try {
    await loader();
  } catch {
    loadedDeferredLanguages.delete(normalized);
  }
}
