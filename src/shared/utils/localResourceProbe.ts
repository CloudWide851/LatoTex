import { convertFileSrc } from "@tauri-apps/api/core";
import { normalizeAssetBasePath } from "./assetPath";

export type LocalResourceProbe = (url: string) => Promise<boolean>;

type PrioritizeLocalResourceOptions = {
  preferSameOrigin?: boolean;
};

function normalizeResourceValue(input: string): string {
  return String(input || "").trim().replace(/\/+$/, "");
}

function resolveRuntimeLocation() {
  if (typeof window !== "undefined" && window.location?.origin && window.location?.href) {
    return {
      origin: window.location.origin,
      href: window.location.href,
    };
  }
  return {
    origin: "http://tauri.localhost",
    href: "http://tauri.localhost/",
  };
}

export function uniqueLocalResourceValues(values: string[]): string[] {
  return Array.from(
    new Set(values.map((item) => normalizeResourceValue(item)).filter((item) => item.length > 0)),
  );
}

export function appendLocalResourceBaseVariants(target: string[], candidate: string) {
  const normalized = normalizeResourceValue(candidate);
  if (!normalized) {
    return;
  }
  target.push(normalized);
  target.push(normalizeResourceValue(normalizeAssetBasePath(normalized)));
}

export function buildLocalResourceBaseCandidates(
  actualDir: string,
  convertFileSrcImpl: (value: string) => string = convertFileSrc,
): string[] {
  const originalDir = String(actualDir || "").trim();
  if (!originalDir) {
    return [];
  }
  const slashDir = originalDir.replace(/\\/g, "/").replace(/\/+$/, "");
  const originalConverted = convertFileSrcImpl(originalDir);
  const slashConverted = convertFileSrcImpl(slashDir);
  return uniqueLocalResourceValues([
    normalizeAssetBasePath(originalConverted),
    normalizeAssetBasePath(slashConverted),
    originalConverted,
    slashConverted,
  ]);
}

export function buildLocalResourceEntryCandidates(
  baseCandidates: string[],
  relativeEntry: string,
): string[] {
  const entry = String(relativeEntry || "").trim().replace(/^\/+/, "");
  if (!entry) {
    return uniqueLocalResourceValues(baseCandidates);
  }
  return uniqueLocalResourceValues(baseCandidates.map((base) => `${normalizeResourceValue(base)}/${entry}`));
}

export function isSameOriginResourceCandidate(candidate: string): boolean {
  const normalized = normalizeResourceValue(candidate);
  if (!normalized) {
    return false;
  }
  const runtime = resolveRuntimeLocation();
  try {
    const resolved = new URL(normalized, runtime.href);
    return resolved.origin === runtime.origin;
  } catch {
    return !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(normalized);
  }
}

export function orderLocalResourceCandidatesByOrigin(candidates: string[]): string[] {
  const sameOrigin: string[] = [];
  const crossOrigin: string[] = [];
  for (const candidate of uniqueLocalResourceValues(candidates)) {
    if (isSameOriginResourceCandidate(candidate)) {
      sameOrigin.push(candidate);
      continue;
    }
    crossOrigin.push(candidate);
  }
  return [...sameOrigin, ...crossOrigin];
}

export async function probeLocalResourceUrl(url: string): Promise<boolean> {
  if (typeof fetch !== "function") {
    return false;
  }
  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      mode: "no-cors",
    });
    return response.type === "opaque" || response.ok;
  } catch {
    return false;
  }
}

export async function prioritizeReachableLocalResourceCandidates(
  candidates: string[],
  probe: LocalResourceProbe = probeLocalResourceUrl,
  options: PrioritizeLocalResourceOptions = {},
): Promise<string[]> {
  const ordered = options.preferSameOrigin === false
    ? uniqueLocalResourceValues(candidates)
    : orderLocalResourceCandidatesByOrigin(candidates);
  for (let index = 0; index < ordered.length; index += 1) {
    const candidate = ordered[index];
    if (!(await probe(candidate))) {
      continue;
    }
    if (index === 0) {
      return ordered;
    }
    return [candidate, ...ordered.filter((item) => item !== candidate)];
  }
  return ordered;
}
