export type ShareEditAnnotationKind = "insert" | "delete" | "replace";

export type ShareEditAnnotation = {
  id: string;
  seq: number;
  path: string;
  participantId: string;
  username: string;
  color: string;
  start: number;
  end: number;
  kind: ShareEditAnnotationKind;
  createdAt: string;
};

export type ShareSyncRemoteEvent = {
  seq: number;
  from: string;
  update: string;
  participantId?: string | null;
  username?: string | null;
  action?: string | null;
  createdAt?: string | null;
};

const IDENTITY_COLORS = [
  "#2563eb",
  "#059669",
  "#d97706",
  "#7c3aed",
  "#dc2626",
  "#0891b2",
  "#be185d",
  "#4f46e5",
  "#15803d",
  "#b45309",
];

export const SHARE_EDIT_ANNOTATION_TTL_MS = 10_000;
export const SHARE_EDIT_ANNOTATION_LIMIT = 24;

export function colorForShareIdentity(identity: string): string {
  const value = String(identity || "guest");
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return IDENTITY_COLORS[Math.abs(hash) % IDENTITY_COLORS.length];
}

export function createShareEditAnnotation(params: {
  event: ShareSyncRemoteEvent;
  path: string | null;
  before: string;
  after: string;
  fallbackUsername: string;
}): ShareEditAnnotation | null {
  const { event, path, before, after, fallbackUsername } = params;
  if (!path || before === after) {
    return null;
  }

  let prefix = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (prefix < maxPrefix && before.charCodeAt(prefix) === after.charCodeAt(prefix)) {
    prefix += 1;
  }

  let beforeSuffix = before.length;
  let afterSuffix = after.length;
  while (
    beforeSuffix > prefix
    && afterSuffix > prefix
    && before.charCodeAt(beforeSuffix - 1) === after.charCodeAt(afterSuffix - 1)
  ) {
    beforeSuffix -= 1;
    afterSuffix -= 1;
  }

  const insertedLength = Math.max(afterSuffix - prefix, 0);
  const removedLength = Math.max(beforeSuffix - prefix, 0);
  const kind: ShareEditAnnotationKind = insertedLength > 0
    ? removedLength > 0 ? "replace" : "insert"
    : "delete";
  const participantId = String(event.participantId || event.from || "remote");
  const username = String(event.username || fallbackUsername || participantId).trim() || fallbackUsername;
  const seq = Number(event.seq || Date.now());

  return {
    id: `share-edit-${seq}-${participantId}`,
    seq,
    path,
    participantId,
    username,
    color: colorForShareIdentity(participantId),
    start: prefix,
    end: prefix + insertedLength,
    kind,
    createdAt: String(event.createdAt || new Date().toISOString()),
  };
}

export function mergeShareEditAnnotation(
  current: ShareEditAnnotation[],
  next: ShareEditAnnotation | null,
): ShareEditAnnotation[] {
  if (!next) {
    return current;
  }
  return [
    ...current.filter((item) => item.id !== next.id),
    next,
  ].slice(-SHARE_EDIT_ANNOTATION_LIMIT);
}
