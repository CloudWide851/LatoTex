import { shareSessionOwnerAuth } from "../../shared/api/share";
import type { ShareOwnerAuth, ShareSessionInfo } from "../../shared/types/app";

export type DesktopShareAuth = {
  participantId: string;
  participantToken: string;
};

type ShareConnection = {
  active?: boolean | null;
  localUrl?: string | null;
  sessionId?: string | null;
};

const authBySession = new Map<string, DesktopShareAuth>();
const authFlightBySession = new Map<string, Promise<DesktopShareAuth>>();

function requireConnection(session: ShareConnection | ShareSessionInfo | null | undefined) {
  const localUrl = session?.localUrl?.trim().replace(/\/$/, "");
  const sessionId = session?.sessionId?.trim();
  if (!session?.active || !localUrl || !sessionId) {
    throw new Error("share.session_not_ready");
  }
  return {
    key: `${localUrl}|${sessionId}`,
    localUrl,
    sessionId,
  };
}

export function primeDesktopShareAuth(
  session: ShareConnection | ShareSessionInfo,
  ownerAuth: ShareOwnerAuth,
) {
  const connection = requireConnection(session);
  if (!ownerAuth.participantId.trim() || !ownerAuth.participantToken.trim()) {
    throw new Error("share.auth_failed");
  }
  authBySession.set(connection.key, ownerAuth);
}

export function clearDesktopShareAuth(session?: ShareConnection | ShareSessionInfo | null) {
  if (!session) {
    authBySession.clear();
    authFlightBySession.clear();
    return;
  }
  try {
    const { key } = requireConnection(session);
    authBySession.delete(key);
    authFlightBySession.delete(key);
  } catch {
    authBySession.clear();
    authFlightBySession.clear();
  }
}

export async function ensureDesktopShareAuth(
  session: ShareConnection | ShareSessionInfo | null | undefined,
  username = "Desktop",
): Promise<DesktopShareAuth> {
  const connection = requireConnection(session);
  const cached = authBySession.get(connection.key);
  if (cached) {
    return cached;
  }
  const activeFlight = authFlightBySession.get(connection.key);
  if (activeFlight) {
    return activeFlight;
  }
  const flight = shareSessionOwnerAuth(connection.sessionId, username).then((payload) => {
    const participantId = String(payload.participantId || "").trim();
    const participantToken = String(payload.participantToken || "").trim();
    if (!participantId || !participantToken) {
      throw new Error("share.auth_failed");
    }
    const auth = { participantId, participantToken };
    authBySession.set(connection.key, auth);
    return auth;
  }).finally(() => {
    authFlightBySession.delete(connection.key);
  });
  authFlightBySession.set(connection.key, flight);
  return flight;
}

function withBearer(init: RequestInit | undefined, auth: DesktopShareAuth): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${auth.participantToken}`);
  return { ...init, headers };
}

export async function authenticatedDesktopShareFetch(
  session: ShareConnection | ShareSessionInfo | null | undefined,
  path: string,
  init?: RequestInit,
  username = "Desktop",
): Promise<Response> {
  const connection = requireConnection(session);
  const request = async (auth: DesktopShareAuth) => fetch(
    `${connection.localUrl}${path.startsWith("/") ? path : `/${path}`}`,
    withBearer(init, auth),
  );
  const auth = await ensureDesktopShareAuth(session, username);
  const response = await request(auth);
  if (response.status !== 401) {
    return response;
  }
  authBySession.delete(connection.key);
  const refreshed = await ensureDesktopShareAuth(session, username);
  return request(refreshed);
}
