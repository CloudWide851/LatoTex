import { analysisPyodidePrepare } from "../../../shared/api/desktop";
import type { AnalysisPyodideCacheInfo } from "../../../shared/types/app";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";

export type PyodideSourceConfig = {
  moduleUrl: string;
  indexURL: string;
};

export type PyodideSourceCandidate = {
  name: "local-cache" | "cdn-fallback";
  source: PyodideSourceConfig;
};

const CDN_VERSION = "0.27.2";
const CDN_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${CDN_VERSION}/full/`;

let cachedCandidatesPromise: Promise<PyodideSourceCandidate[]> | null = null;

function toLocalSource(info: AnalysisPyodideCacheInfo): PyodideSourceConfig {
  const normalizedDir = info.actualDir.replace(/\\/g, "/").replace(/\/+$/, "");
  const localBase = convertFileSrc(normalizedDir).replace(/\/+$/, "");
  return {
    moduleUrl: `${localBase}/pyodide.mjs`,
    indexURL: `${localBase}/`,
  };
}

function buildCdnSource(): PyodideSourceConfig {
  return {
    moduleUrl: `${CDN_INDEX_URL}pyodide.mjs`,
    indexURL: CDN_INDEX_URL,
  };
}

export async function resolvePyodideSourceCandidates(): Promise<PyodideSourceCandidate[]> {
  if (cachedCandidatesPromise) {
    return cachedCandidatesPromise;
  }

  cachedCandidatesPromise = (async () => {
    const candidates: PyodideSourceCandidate[] = [];
    if (isTauri()) {
      try {
        const policyRaw = typeof window !== "undefined"
          ? (window.localStorage.getItem("latotex.pyodide.cachePolicy") as "install-first" | "appdata-only" | null)
          : null;
        const info = await analysisPyodidePrepare(policyRaw ?? "install-first");
        if (typeof window !== "undefined") {
          window.localStorage.setItem("latotex.pyodide.cacheDir", info.actualDir);
          window.localStorage.setItem("latotex.pyodide.cachePolicy", info.policy);
        }
        candidates.push({
          name: "local-cache",
          source: toLocalSource(info),
        });
      } catch {
        // fallback to CDN candidate below
      }
    }

    candidates.push({
      name: "cdn-fallback",
      source: buildCdnSource(),
    });
    return candidates;
  })();

  return cachedCandidatesPromise;
}
