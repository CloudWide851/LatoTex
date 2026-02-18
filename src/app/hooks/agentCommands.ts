export type AgentSlashCommand = "review" | "check-ref";

export type ParsedAgentPrompt =
  | {
      kind: "command";
      command: AgentSlashCommand;
      args: string;
      raw: string;
    }
  | {
      kind: "plain";
      raw: string;
    };

export const AGENT_COMMAND_TOKENS: ReadonlyArray<`/${AgentSlashCommand}`> = [
  "/review",
  "/check-ref",
] as const;

export function parseAgentPrompt(rawPrompt: string): ParsedAgentPrompt {
  const raw = rawPrompt.trim();
  if (!raw.startsWith("/")) {
    return { kind: "plain", raw };
  }
  const [head, ...rest] = raw.split(/\s+/);
  const args = rest.join(" ").trim();
  if (head === "/review") {
    return { kind: "command", command: "review", args, raw };
  }
  if (head === "/check-ref") {
    return { kind: "command", command: "check-ref", args, raw };
  }
  return { kind: "plain", raw };
}

export function completeAgentCommand(
  currentPrompt: string,
  commandToken: `/${AgentSlashCommand}`,
): string {
  const trimmedStart = currentPrompt.trimStart();
  if (trimmedStart.startsWith("/")) {
    return `${commandToken} `;
  }
  return `${commandToken} `;
}

export function extractReferenceQueries(content: string, userHint = "", max = 12): string[] {
  const values = new Set<string>();
  const pushValue = (value: string) => {
    const normalized = value.trim();
    if (!normalized) {
      return;
    }
    values.add(normalized);
  };

  const doiMatches = content.match(/\b10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+\b/g) ?? [];
  doiMatches.forEach((item) => pushValue(item));

  const arxivMatches =
    content.match(/\barXiv:\s*\d{4}\.\d{4,5}(v\d+)?\b/gi) ??
    content.match(/\b\d{4}\.\d{4,5}(v\d+)?\b/g) ??
    [];
  arxivMatches.forEach((item) => pushValue(item));

  const urlMatches = content.match(/\bhttps?:\/\/[^\s)]+/g) ?? [];
  urlMatches.forEach((item) => pushValue(item));

  const citeRegex = /\\cite[a-zA-Z*]*\{([^}]+)\}/g;
  let citeMatch: RegExpExecArray | null = null;
  while ((citeMatch = citeRegex.exec(content)) !== null) {
    const citeBody = citeMatch[1] ?? "";
    citeBody
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .forEach((item) => pushValue(item));
  }

  if (userHint.trim()) {
    userHint
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .forEach((item) => pushValue(item));
  }

  return Array.from(values).slice(0, max);
}

export function pickCommandSuggestions(input: string): Array<`/${AgentSlashCommand}`> {
  const value = input.trimStart();
  if (!value.startsWith("/")) {
    return [];
  }
  const token = value.split(/\s+/)[0];
  if (token.length <= 1) {
    return [...AGENT_COMMAND_TOKENS];
  }
  return AGENT_COMMAND_TOKENS.filter((candidate) => candidate.startsWith(token as `/${AgentSlashCommand}`));
}
