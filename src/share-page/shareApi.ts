import type { ShareComment, ShareParticipant } from "./shareTypes";

export type SharePdfStatus = {
  ready: boolean;
  state?: string;
  updatedAt?: string | null;
  sizeBytes?: number;
  version?: string | null;
};

export async function postShareJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function joinShareSession(params: {
  sid: string;
  pwd: string;
  clientId: string;
  username: string;
}): Promise<{ participantId: string; participantToken: string; participants: ShareParticipant[] }> {
  return postShareJson("/api/join", params);
}

export async function fetchShareSnapshot(sid: string, pwd: string): Promise<{ content: string }> {
  const response = await fetch(`/api/snapshot?sid=${encodeURIComponent(sid)}&pwd=${encodeURIComponent(pwd)}`);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<{ content: string }>;
}

export async function pushShareUpdate(params: {
  sid: string;
  pwd: string;
  clientId: string;
  participantId: string;
  participantToken: string;
  username: string;
  action: string;
  update: string;
}): Promise<void> {
  await postShareJson("/api/sync/push", params);
}

export async function pullShareUpdates(params: {
  sid: string;
  pwd: string;
  participantId: string;
  participantToken: string;
  cursor: number;
}): Promise<{ events?: Array<{ seq?: number; from?: string; update: string }>; nextCursor?: number }> {
  const token = params.participantToken ? `&participantToken=${encodeURIComponent(params.participantToken)}` : "";
  const response = await fetch(
    `/api/sync/pull?sid=${encodeURIComponent(params.sid)}&pwd=${encodeURIComponent(params.pwd)}&participantId=${encodeURIComponent(params.participantId)}${token}&cursor=${params.cursor}`,
  );
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<{ events?: Array<{ seq?: number; from?: string; update: string }>; nextCursor?: number }>;
}

export async function pingSharePresence(params: {
  sid: string;
  pwd: string;
  participantId: string;
  participantToken: string;
  action: string;
}): Promise<{ participants?: ShareParticipant[] }> {
  return postShareJson("/api/presence/ping", params);
}

export async function listShareComments(params: {
  sid: string;
  pwd: string;
  participantId: string;
  participantToken: string;
}): Promise<{ comments?: ShareComment[] }> {
  const token = params.participantToken ? `&participantToken=${encodeURIComponent(params.participantToken)}` : "";
  const response = await fetch(
    `/api/comments/list?sid=${encodeURIComponent(params.sid)}&pwd=${encodeURIComponent(params.pwd)}&participantId=${encodeURIComponent(params.participantId)}${token}&t=${Date.now()}`,
  );
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<{ comments?: ShareComment[] }>;
}

export async function postShareComment(params: {
  sid: string;
  pwd: string;
  participantId: string;
  participantToken: string;
  id: string;
  username: string;
  text: string;
  quote: string;
  source: "pdf" | "tex";
  page?: number;
  start?: number;
  end?: number;
  createdAt: string;
}): Promise<{ comments?: ShareComment[] }> {
  return postShareJson("/api/comments/post", params);
}

export async function fetchSharePdfStatus(sid: string, pwd: string): Promise<SharePdfStatus> {
  const response = await fetch(`/api/pdf/status?sid=${encodeURIComponent(sid)}&pwd=${encodeURIComponent(pwd)}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    return { ready: false };
  }
  const payload = await response.json() as { state?: string; updatedAt?: string | null; sizeBytes?: number; version?: string | null };
  return {
    ready: payload?.state === "ready",
    state: payload?.state,
    updatedAt: payload?.updatedAt ?? null,
    sizeBytes: Number(payload?.sizeBytes || 0),
    version: typeof payload?.version === "string" && payload.version.trim() ? payload.version : null,
  };
}

export async function fetchSharePdfBuffer(sid: string, pwd: string, version?: string | null): Promise<ArrayBuffer> {
  const versionParam = version ? `&v=${encodeURIComponent(version)}` : "";
  const response = await fetch(`/api/pdf?sid=${encodeURIComponent(sid)}&pwd=${encodeURIComponent(pwd)}${versionParam}`, {
    cache: "force-cache",
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.arrayBuffer();
}
