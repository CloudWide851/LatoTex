import type { TerminalTab } from "./terminalTypes";

export type TerminalSuggestion = {
  value: string;
  label: string;
  detail: string;
};

const COMMANDS = [
  "pnpm install",
  "pnpm typecheck",
  "pnpm test:unit",
  "pnpm build",
  "pnpm tauri build --target x86_64-pc-windows-msvc --bundles nsis",
  "cargo test --manifest-path src-tauri/Cargo.toml",
  "git status --short",
  "git diff --check",
  "git log --oneline -10",
];

function pathSuggestions(tab: TerminalTab | null, selectedFile: string | null): string[] {
  const paths = new Set<string>();
  if (tab?.relativePath) {
    paths.add(tab.relativePath);
  }
  if (selectedFile) {
    paths.add(selectedFile);
    const segments = selectedFile.split(/[\\/]/).filter(Boolean);
    for (let index = 1; index < segments.length; index += 1) {
      paths.add(segments.slice(0, index).join("/"));
    }
  }
  return Array.from(paths);
}

export function nextTerminalInputLine(current: string, data: string): string {
  if (data === "\r") {
    return "";
  }
  if (data === "\u007f" || data === "\b") {
    return current.slice(0, -1);
  }
  if (/^\x1b/.test(data) || data < " ") {
    return current;
  }
  return `${current}${data}`.slice(-240);
}

export function buildTerminalSuggestions(input: string, options: {
  tab: TerminalTab | null;
  selectedFile: string | null;
  history: string[];
}): TerminalSuggestion[] {
  const query = input.trimStart();
  if (query.length < 2) {
    return [];
  }
  const candidates = [
    ...options.history.slice().reverse(),
    ...COMMANDS,
    ...pathSuggestions(options.tab, options.selectedFile),
  ];
  const seen = new Set<string>();
  return candidates
    .filter((value) => value.toLowerCase().startsWith(query.toLowerCase()))
    .filter((value) => {
      if (seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    })
    .slice(0, 6)
    .map((value) => ({
      value,
      label: value,
      detail: value.includes("/") || value.includes("\\") ? "path" : "command",
    }));
}
