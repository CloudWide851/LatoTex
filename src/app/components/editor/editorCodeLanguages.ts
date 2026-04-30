import "monaco-editor/esm/vs/basic-languages/bat/bat.contribution";
import "monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution";
import "monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution";
import "monaco-editor/esm/vs/basic-languages/css/css.contribution";
import "monaco-editor/esm/vs/basic-languages/dart/dart.contribution";
import "monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.contribution";
import "monaco-editor/esm/vs/basic-languages/fsharp/fsharp.contribution";
import "monaco-editor/esm/vs/basic-languages/go/go.contribution";
import "monaco-editor/esm/vs/basic-languages/graphql/graphql.contribution";
import "monaco-editor/esm/vs/basic-languages/hcl/hcl.contribution";
import "monaco-editor/esm/vs/basic-languages/html/html.contribution";
import "monaco-editor/esm/vs/basic-languages/ini/ini.contribution";
import "monaco-editor/esm/vs/basic-languages/java/java.contribution";
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution";
import "monaco-editor/esm/vs/basic-languages/kotlin/kotlin.contribution";
import "monaco-editor/esm/vs/basic-languages/less/less.contribution";
import "monaco-editor/esm/vs/basic-languages/lua/lua.contribution";
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution";
import "monaco-editor/esm/vs/basic-languages/mdx/mdx.contribution";
import "monaco-editor/esm/vs/basic-languages/perl/perl.contribution";
import "monaco-editor/esm/vs/basic-languages/php/php.contribution";
import "monaco-editor/esm/vs/basic-languages/powershell/powershell.contribution";
import "monaco-editor/esm/vs/basic-languages/protobuf/protobuf.contribution";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution";
import "monaco-editor/esm/vs/basic-languages/r/r.contribution";
import "monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution";
import "monaco-editor/esm/vs/basic-languages/rust/rust.contribution";
import "monaco-editor/esm/vs/basic-languages/scss/scss.contribution";
import "monaco-editor/esm/vs/basic-languages/shell/shell.contribution";
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution";
import "monaco-editor/esm/vs/basic-languages/swift/swift.contribution";
import "monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution";
import "monaco-editor/esm/vs/basic-languages/xml/xml.contribution";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution";

const LATEX_LANGUAGE_ID = "latex";
const BIBTEX_LANGUAGE_ID = "bibtex";
const CSV_LANGUAGE_ID = "csv";
const IGNORE_LANGUAGE_ID = "ignore";
const EDITORCONFIG_LANGUAGE_ID = "editorconfig";
const registeredMonacoInstances = new WeakSet<object>();

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
  monaco.languages.setLanguageConfiguration(LATEX_LANGUAGE_ID, LATEX_CONFIGURATION);
  monaco.languages.setMonarchTokensProvider(LATEX_LANGUAGE_ID, LATEX_TOKENS);
  monaco.languages.setLanguageConfiguration(BIBTEX_LANGUAGE_ID, BIBTEX_CONFIGURATION);
  monaco.languages.setMonarchTokensProvider(BIBTEX_LANGUAGE_ID, BIBTEX_TOKENS);
  monaco.languages.setMonarchTokensProvider(CSV_LANGUAGE_ID, CSV_TOKENS);
  monaco.languages.setLanguageConfiguration(IGNORE_LANGUAGE_ID, IGNORE_TOKENS);
  monaco.languages.setMonarchTokensProvider(IGNORE_LANGUAGE_ID, IGNORE_TOKENS);
  monaco.languages.setLanguageConfiguration(EDITORCONFIG_LANGUAGE_ID, EDITORCONFIG_TOKENS);
  monaco.languages.setMonarchTokensProvider(EDITORCONFIG_LANGUAGE_ID, EDITORCONFIG_TOKENS);
}
