export function toBase64(uint8) {
  let binary = "";
  for (const byte of uint8) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(raw) {
  const bin = atob(raw);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(hash) % 360} 70% 45%)`;
}

export function escapeHtml(raw) {
  return String(raw)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function normalizeComment(raw, fallbackGuest) {
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

export async function postJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json();
}

export function trimQuote(raw, max = 320) {
  const value = String(raw || "").replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}
