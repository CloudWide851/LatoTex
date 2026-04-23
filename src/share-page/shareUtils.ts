import type { ShareComment, ShareQuote } from "./shareTypes";

export function toBase64(uint8: Uint8Array): string {
  let binary = "";
  for (const byte of uint8) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function fromBase64(raw: string): Uint8Array {
  const bin = atob(raw);
  const out = new Uint8Array(bin.length);
  for (let index = 0; index < bin.length; index += 1) {
    out[index] = bin.charCodeAt(index);
  }
  return out;
}

export function avatarColor(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) | 0;
  }
  return `hsl(${Math.abs(hash) % 360} 70% 45%)`;
}

export function trimQuote(raw: string, max = 320): string {
  const value = String(raw || "").replace(/\s+/g, " ").trim();
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}...`;
}

export function normalizeComment(raw: any, fallbackGuest: string): ShareComment {
  const quote = typeof raw?.quote === "string" ? raw.quote : "";
  const page = Number(raw?.page);
  const start = Number(raw?.start);
  const end = Number(raw?.end);
  const source = raw?.source === "pdf" || raw?.source === "tex"
    ? raw.source
    : Number.isFinite(page) && page > 0
      ? "pdf"
      : "tex";
  return {
    id: String(raw?.id || `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
    username: String(raw?.username || fallbackGuest),
    text: String(raw?.text || ""),
    quote,
    source,
    sessionName: typeof raw?.sessionName === "string" ? raw.sessionName : "",
    sessionCreatedAt: typeof raw?.sessionCreatedAt === "string" ? raw.sessionCreatedAt : "",
    page: Number.isFinite(page) && page > 0 ? page : undefined,
    start: Number.isFinite(start) && start >= 0 ? start : undefined,
    end: Number.isFinite(end) && end >= 0 ? end : undefined,
    createdAt: typeof raw?.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
  };
}

export function deriveSelectionQuote(text: string, start: number, end: number): ShareQuote | null {
  if (end <= start) {
    return null;
  }
  const selected = trimQuote(text.slice(start, end));
  if (!selected) {
    return null;
  }
  return { source: "tex", text: selected, start, end };
}
