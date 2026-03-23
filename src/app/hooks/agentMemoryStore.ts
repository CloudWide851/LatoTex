import { readFile, writeFile } from "../../shared/api/workspace";
import type { AgentChatMessage, AgentSessionSummary } from "./agentTypes";

type AgentMemoryIndexFileEntry = {
  currentSessionId: string | null;
  sessions: AgentSessionSummary[];
};

type AgentMemoryIndex = {
  version: number;
  updatedAt: string;
  files: Record<string, AgentMemoryIndexFileEntry>;
};

const MEMORY_ROOT = ".latotex/memory";
const MEMORY_MAIN_PATH = ".latotex/MEMORY.md";
const MEMORY_INDEX_PATH = `${MEMORY_ROOT}/index.json`;
const DAILY_DIR = `${MEMORY_ROOT}/daily`;
const TRANSLATION_GLOSSARY_PATH = `${MEMORY_ROOT}/translation-glossary.md`;
const SESSION_JSON_START = "<!-- LATOTEX_SESSION_JSON_START -->";
const SESSION_JSON_END = "<!-- LATOTEX_SESSION_JSON_END -->";

const DEFAULT_MEMORY_MAIN = [
  "# Project Memory",
  "",
  "## Goals",
  "- Track stable product decisions and long-term context.",
  "",
  "## Constraints",
  "- Keep i18n keys synchronized between en-US and zh-CN.",
  "- Use append-only notes for important decision history.",
  "",
  "## Recent Decisions",
  "- Initialized memory structure.",
  "",
  "## Open Questions",
  "- None.",
  "",
].join("\n");

const DEFAULT_MEMORY_README = [
  "# Memory Layout",
  "",
  "- `.latotex/MEMORY.md`: project-level long-term memory.",
  "- `.latotex/memory/daily/YYYY-MM-DD.md`: daily append-only log.",
  "- `.latotex/memory/files/<encoded>/summary.md`: per-file long-term summary.",
  "- `.latotex/memory/files/<encoded>/sessions/<session-id>.md`: per-session transcript.",
  "- `.latotex/memory/index.json`: machine index of file sessions.",
  "",
].join("\n");

function nowIso(): string {
  return new Date().toISOString();
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function toBase64Url(raw: string): string {
  const bytes = new TextEncoder().encode(raw);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fileSummaryPath(filePath: string): string {
  return `${MEMORY_ROOT}/files/${toBase64Url(filePath)}/summary.md`;
}

function sessionPath(filePath: string, sessionId: string): string {
  return `${MEMORY_ROOT}/files/${toBase64Url(filePath)}/sessions/${sessionId}.md`;
}

function dailyPath(): string {
  return `${DAILY_DIR}/${todayKey()}.md`;
}

function normalizeMessages(messages: AgentChatMessage[]): AgentChatMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    text: message.text,
    format: message.format ?? "plain",
  }));
}

function defaultFileSummary(filePath: string): string {
  return [
    `# Memory for ${filePath}`,
    "",
    "## Stable Notes",
    "- Add durable facts about this file here.",
    "",
    "## Known Risks",
    "- None.",
    "",
  ].join("\n");
}

function defaultDailyDoc(): string {
  return [`# Daily Memory ${todayKey()}`, "", "## Timeline", ""].join("\n");
}

function createSessionId(): string {
  const seed = Math.random().toString(36).slice(2, 8);
  return `session-${Date.now()}-${seed}`;
}

function defaultSessionTitle(index: number): string {
  return `Session ${index}`;
}

function defaultIndex(): AgentMemoryIndex {
  return {
    version: 1,
    updatedAt: nowIso(),
    files: {},
  };
}

async function readText(projectId: string, relativePath: string): Promise<string | null> {
  try {
    const response = await readFile(projectId, relativePath);
    return response.content ?? "";
  } catch {
    return null;
  }
}

async function ensureTextFile(projectId: string, relativePath: string, content: string): Promise<void> {
  const existing = await readText(projectId, relativePath);
  if (existing !== null) {
    return;
  }
  await writeFile(projectId, relativePath, content);
}

function safeParseIndex(content: string | null): AgentMemoryIndex {
  if (!content || !content.trim()) {
    return defaultIndex();
  }
  try {
    const parsed = JSON.parse(content) as Partial<AgentMemoryIndex>;
    if (!parsed || typeof parsed !== "object") {
      return defaultIndex();
    }
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : nowIso(),
      files: parsed.files && typeof parsed.files === "object" ? parsed.files : {},
    };
  } catch {
    return defaultIndex();
  }
}

function ensureFileEntry(index: AgentMemoryIndex, filePath: string): AgentMemoryIndexFileEntry {
  const current = index.files[filePath];
  if (current) {
    return current;
  }
  const created: AgentMemoryIndexFileEntry = {
    currentSessionId: null,
    sessions: [],
  };
  index.files[filePath] = created;
  return created;
}

function serializeSession(
  summary: AgentSessionSummary,
  messages: AgentChatMessage[],
): string {
  const payload = {
    id: summary.id,
    filePath: summary.filePath,
    title: summary.title,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    messageCount: messages.length,
    messages: normalizeMessages(messages),
  };
  return [
    `# ${summary.title}`,
    "",
    `- Session ID: \`${summary.id}\``,
    `- File: \`${summary.filePath}\``,
    `- Created At: ${summary.createdAt}`,
    `- Updated At: ${summary.updatedAt}`,
    "",
    "## Transcript JSON",
    "",
    SESSION_JSON_START,
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
    SESSION_JSON_END,
    "",
  ].join("\n");
}

function parseSessionMessages(content: string | null): AgentChatMessage[] {
  if (!content) {
    return [];
  }
  const markerPattern = new RegExp(
    `${SESSION_JSON_START}[\\s\\S]*?\\\`\\\`\\\`json\\s*([\\s\\S]*?)\\\`\\\`\\\`[\\s\\S]*?${SESSION_JSON_END}`,
  );
  const matched = content.match(markerPattern);
  if (!matched || !matched[1]) {
    return [];
  }
  try {
    const parsed = JSON.parse(matched[1]) as { messages?: AgentChatMessage[] };
    if (!Array.isArray(parsed.messages)) {
      return [];
    }
    return normalizeMessages(parsed.messages);
  } catch {
    return [];
  }
}

async function loadIndex(projectId: string): Promise<AgentMemoryIndex> {
  const raw = await readText(projectId, MEMORY_INDEX_PATH);
  return safeParseIndex(raw);
}

async function saveIndex(projectId: string, index: AgentMemoryIndex): Promise<void> {
  index.updatedAt = nowIso();
  await writeFile(projectId, MEMORY_INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`);
}

export async function ensureAgentMemoryScaffold(projectId: string, filePath?: string): Promise<void> {
  await ensureTextFile(projectId, MEMORY_MAIN_PATH, `${DEFAULT_MEMORY_MAIN}\n`);
  await ensureTextFile(projectId, `${MEMORY_ROOT}/README.md`, `${DEFAULT_MEMORY_README}\n`);
  await ensureTextFile(projectId, dailyPath(), `${defaultDailyDoc()}\n`);
  await ensureTextFile(projectId, MEMORY_INDEX_PATH, `${JSON.stringify(defaultIndex(), null, 2)}\n`);
  if (filePath) {
    await ensureTextFile(projectId, fileSummaryPath(filePath), `${defaultFileSummary(filePath)}\n`);
  }
}

function findSession(entry: AgentMemoryIndexFileEntry, sessionId: string): AgentSessionSummary | null {
  return entry.sessions.find((item) => item.id === sessionId) ?? null;
}

async function createSessionInternal(
  projectId: string,
  index: AgentMemoryIndex,
  filePath: string,
  title?: string,
): Promise<AgentSessionSummary> {
  const entry = ensureFileEntry(index, filePath);
  const now = nowIso();
  const summary: AgentSessionSummary = {
    id: createSessionId(),
    filePath,
    title: title ?? defaultSessionTitle(entry.sessions.length + 1),
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  };
  entry.sessions = [summary, ...entry.sessions];
  entry.currentSessionId = summary.id;
  await ensureTextFile(projectId, fileSummaryPath(filePath), `${defaultFileSummary(filePath)}\n`);
  await writeFile(projectId, sessionPath(filePath, summary.id), serializeSession(summary, []));
  await saveIndex(projectId, index);
  return summary;
}

export async function ensureCurrentFileSession(projectId: string, filePath: string): Promise<{
  sessions: AgentSessionSummary[];
  currentSessionId: string;
}> {
  await ensureAgentMemoryScaffold(projectId, filePath);
  const index = await loadIndex(projectId);
  const entry = ensureFileEntry(index, filePath);
  if (entry.sessions.length === 0) {
    const created = await createSessionInternal(projectId, index, filePath);
    return { sessions: [created], currentSessionId: created.id };
  }
  if (!entry.currentSessionId || !findSession(entry, entry.currentSessionId)) {
    entry.currentSessionId = entry.sessions[0].id;
    await saveIndex(projectId, index);
  }
  return {
    sessions: entry.sessions,
    currentSessionId: entry.currentSessionId ?? entry.sessions[0].id,
  };
}

export async function createNewFileSession(projectId: string, filePath: string): Promise<{
  sessions: AgentSessionSummary[];
  currentSessionId: string;
}> {
  await ensureAgentMemoryScaffold(projectId, filePath);
  const index = await loadIndex(projectId);
  const created = await createSessionInternal(projectId, index, filePath);
  const entry = ensureFileEntry(index, filePath);
  return {
    sessions: entry.sessions,
    currentSessionId: created.id,
  };
}

export async function resumeFileSession(
  projectId: string,
  filePath: string,
  sessionId: string,
): Promise<{
  sessions: AgentSessionSummary[];
  currentSessionId: string;
}> {
  const index = await loadIndex(projectId);
  const entry = ensureFileEntry(index, filePath);
  if (!findSession(entry, sessionId)) {
    throw new Error("session.notFound");
  }
  entry.currentSessionId = sessionId;
  await saveIndex(projectId, index);
  return {
    sessions: entry.sessions,
    currentSessionId: sessionId,
  };
}

export async function loadSessionMessages(
  projectId: string,
  filePath: string,
  sessionId: string,
): Promise<AgentChatMessage[]> {
  const raw = await readText(projectId, sessionPath(filePath, sessionId));
  return parseSessionMessages(raw);
}

export async function saveSessionMessages(
  projectId: string,
  filePath: string,
  sessionId: string,
  messages: AgentChatMessage[],
): Promise<AgentSessionSummary[] | null> {
  const index = await loadIndex(projectId);
  const entry = ensureFileEntry(index, filePath);
  const existing = findSession(entry, sessionId);
  if (!existing) {
    return null;
  }
  const updated: AgentSessionSummary = {
    ...existing,
    updatedAt: nowIso(),
    messageCount: messages.length,
  };
  entry.sessions = [updated, ...entry.sessions.filter((item) => item.id !== sessionId)];
  entry.currentSessionId = sessionId;
  await writeFile(projectId, sessionPath(filePath, sessionId), serializeSession(updated, messages));
  await saveIndex(projectId, index);
  return entry.sessions;
}

export async function ensureProjectMemoryDocument(projectId: string): Promise<string> {
  await ensureAgentMemoryScaffold(projectId);
  return MEMORY_MAIN_PATH;
}

function trimSection(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}\n...[trimmed]...`;
}

function summarizeRecentMessages(messages: AgentChatMessage[], maxItems = 12): string {
  const picked = messages.slice(-maxItems);
  return picked
    .map((item) => `${item.role.toUpperCase()}: ${item.text.replace(/\s+/g, " ").slice(0, 240)}`)
    .join("\n");
}

export async function buildAgentMemoryContext(
  projectId: string,
  filePath: string,
  sessionId?: string | null,
): Promise<string> {
  await ensureAgentMemoryScaffold(projectId, filePath);
  const index = await loadIndex(projectId);
  const entry = ensureFileEntry(index, filePath);
  const activeSessionId = sessionId ?? entry.currentSessionId;
  const [mainDoc, dailyDoc, fileDoc, glossaryDoc, sessionMessages] = await Promise.all([
    readText(projectId, MEMORY_MAIN_PATH),
    readText(projectId, dailyPath()),
    readText(projectId, fileSummaryPath(filePath)),
    readText(projectId, TRANSLATION_GLOSSARY_PATH),
    activeSessionId ? loadSessionMessages(projectId, filePath, activeSessionId) : Promise.resolve([]),
  ]);
  const recent = summarizeRecentMessages(sessionMessages, 10);
  const chunks = [
    ["PROJECT_MEMORY", trimSection(mainDoc ?? "", 2200)],
    ["DAILY_MEMORY", trimSection(dailyDoc ?? "", 1600)],
    ["FILE_MEMORY", trimSection(fileDoc ?? "", 1800)],
    ["TRANSLATION_GLOSSARY", trimSection(glossaryDoc ?? "", 1600)],
    ["RECENT_SESSION", trimSection(recent, 1200)],
  ].filter((item) => item[1].trim().length > 0);
  if (chunks.length === 0) {
    return "";
  }
  return chunks
    .map(([label, content]) => `[${label}]\n${content.trim()}`)
    .join("\n\n");
}

export async function appendDailyMemoryPrompt(
  projectId: string,
  filePath: string,
  prompt: string,
): Promise<void> {
  await ensureAgentMemoryScaffold(projectId, filePath);
  const path = dailyPath();
  const existing = (await readText(projectId, path)) ?? defaultDailyDoc();
  const now = new Date().toISOString().slice(11, 19);
  const entry = `- ${now} [${filePath}] ${prompt.replace(/\s+/g, " ").slice(0, 260)}`;
  const next = existing.trimEnd().length === 0 ? `${defaultDailyDoc()}\n${entry}\n` : `${existing.trimEnd()}\n${entry}\n`;
  await writeFile(projectId, path, next);
}

