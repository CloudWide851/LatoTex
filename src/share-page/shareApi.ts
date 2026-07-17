import type { ShareComment, ShareParticipant } from "./shareTypes";

export type SharePdfStatus = {
  ready: boolean;
  state?: string;
  updatedAt?: string | null;
  sizeBytes?: number;
  version?: string | null;
};

export type ShareParticipantAuth = {
  participantId: string;
  participantToken: string;
};

function authorizedHeaders(participantToken: string, json = false): HeadersInit {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    Authorization: `Bearer ${participantToken}`,
  };
}

export async function postShareJson<T>(path: string, body: unknown, participantToken?: string): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: participantToken
      ? authorizedHeaders(participantToken, true)
      : { "Content-Type": "application/json" },
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

export async function fetchShareSnapshot(sid: string, auth: ShareParticipantAuth): Promise<{ content: string }> {
  const response = await fetch(
    `/api/snapshot?sid=${encodeURIComponent(sid)}&participantId=${encodeURIComponent(auth.participantId)}`,
    { headers: authorizedHeaders(auth.participantToken) },
  );
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<{ content: string }>;
}

export async function pushShareUpdate(params: {
  sid: string;
  clientId: string;
  participantId: string;
  participantToken: string;
  username: string;
  action: string;
  update: string;
}): Promise<void> {
  const { participantToken, ...body } = params;
  await postShareJson("/api/sync/push", body, participantToken);
}

export async function pullShareUpdates(params: {
  sid: string;
  participantId: string;
  participantToken: string;
  cursor: number;
}): Promise<{ events?: Array<{ seq?: number; from?: string; update: string }>; nextCursor?: number }> {
  const response = await fetch(
    `/api/sync/pull?sid=${encodeURIComponent(params.sid)}&participantId=${encodeURIComponent(params.participantId)}&cursor=${params.cursor}`,
    { headers: authorizedHeaders(params.participantToken) },
  );
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<{ events?: Array<{ seq?: number; from?: string; update: string }>; nextCursor?: number }>;
}

export async function pingSharePresence(params: {
  sid: string;
  participantId: string;
  participantToken: string;
  action: string;
}): Promise<{ participants?: ShareParticipant[] }> {
  const { participantToken, ...body } = params;
  return postShareJson("/api/presence/ping", body, participantToken);
}

export async function listShareComments(params: {
  sid: string;
  participantId: string;
  participantToken: string;
}): Promise<{ comments?: ShareComment[] }> {
  const response = await fetch(
    `/api/comments/list?sid=${encodeURIComponent(params.sid)}&participantId=${encodeURIComponent(params.participantId)}&t=${Date.now()}`,
    { headers: authorizedHeaders(params.participantToken) },
  );
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<{ comments?: ShareComment[] }>;
}

export async function postShareComment(params: {
  sid: string;
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
  const { participantToken, ...body } = params;
  return postShareJson("/api/comments/post", body, participantToken);
}

export async function fetchSharePdfStatus(sid: string, auth: ShareParticipantAuth): Promise<SharePdfStatus> {
  const response = await fetch(`/api/pdf/status?sid=${encodeURIComponent(sid)}`, {
    cache: "no-store",
    headers: authorizedHeaders(auth.participantToken),
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

export async function fetchSharePdfBuffer(
  sid: string,
  auth: ShareParticipantAuth,
  version?: string | null,
): Promise<ArrayBuffer> {
  const versionParam = version ? `&v=${encodeURIComponent(version)}` : "";
  const response = await fetch(`/api/pdf?sid=${encodeURIComponent(sid)}${versionParam}`, {
    cache: "force-cache",
    headers: authorizedHeaders(auth.participantToken),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.arrayBuffer();
}
