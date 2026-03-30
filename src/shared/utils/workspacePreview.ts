import { buildWorkspacePreviewUrl } from "./workspaceResource";

function appendCacheKey(url: string, cacheKey?: string | number | null): string {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) {
    return "";
  }
  if (cacheKey === null || cacheKey === undefined || String(cacheKey).trim().length === 0) {
    return normalizedUrl;
  }
  const separator = normalizedUrl.includes("?") ? "&" : "?";
  return `${normalizedUrl}${separator}v=${encodeURIComponent(String(cacheKey).trim())}`;
}

export function buildWorkspacePreviewCandidates(params: {
  projectId: string | null;
  relativePath: string | null;
  previewUrl?: string | null;
  cacheKey?: string | number | null;
}): string[] {
  const candidates = new Set<string>();
  const previewUrl = appendCacheKey(params.previewUrl ?? "", params.cacheKey);
  if (previewUrl) {
    candidates.add(previewUrl);
  }
  if (params.projectId && params.relativePath) {
    candidates.add(buildWorkspacePreviewUrl(params.projectId, params.relativePath, params.cacheKey ?? undefined));
  }
  return Array.from(candidates);
}

export async function probeWorkspacePreviewUrl(url: string): Promise<boolean> {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) {
    return false;
  }
  try {
    const headResponse = await fetch(normalizedUrl, {
      method: "HEAD",
      cache: "no-store",
    });
    if (headResponse.ok) {
      return true;
    }
    if (![405, 501].includes(headResponse.status)) {
      return false;
    }
  } catch {
    // Fall through to a small GET range probe below.
  }

  try {
    const rangeResponse = await fetch(normalizedUrl, {
      method: "GET",
      cache: "no-store",
      headers: {
        Range: "bytes=0-0",
      },
    });
    return rangeResponse.ok || rangeResponse.status === 206;
  } catch {
    return false;
  }
}

export async function resolveReachableWorkspacePreviewUrl(params: {
  projectId: string | null;
  relativePath: string | null;
  previewUrl?: string | null;
  cacheKey?: string | number | null;
}): Promise<{ url: string | null; verified: boolean; failureCode: string | null }> {
  const candidates = buildWorkspacePreviewCandidates(params);
  for (const candidate of candidates) {
    if (await probeWorkspacePreviewUrl(candidate)) {
      return {
        url: candidate,
        verified: true,
        failureCode: null,
      };
    }
  }
  return {
    url: candidates[0] ?? null,
    verified: false,
    failureCode: candidates.length > 0 ? "workspace.preview.unreachable" : "workspace.preview.missing",
  };
}
