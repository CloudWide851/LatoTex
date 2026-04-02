const LATEX_LANGUAGE_ID = "latex";
const BIBTEX_LANGUAGE_ID = "bibtex";
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
      [/\\(?:[a-zA-Z@]+|.)/, "keyword"],
      [/\$\$?/, "string"],
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
      [/@(?:comment|preamble|string|[a-zA-Z]+)/, "keyword"],
      [/\b[a-zA-Z][\w:-]*(?=\s*=)/, "attribute.name"],
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
  monaco.languages.setLanguageConfiguration(LATEX_LANGUAGE_ID, LATEX_CONFIGURATION);
  monaco.languages.setMonarchTokensProvider(LATEX_LANGUAGE_ID, LATEX_TOKENS);
  monaco.languages.setLanguageConfiguration(BIBTEX_LANGUAGE_ID, BIBTEX_CONFIGURATION);
  monaco.languages.setMonarchTokensProvider(BIBTEX_LANGUAGE_ID, BIBTEX_TOKENS);
}
