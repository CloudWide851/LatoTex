import { analysisPyodidePrepare } from "../../../shared/api/local-resources";
import type { AnalysisPyodideCacheInfo } from "../../../shared/types/app";
import { isTauri } from "@tauri-apps/api/core";

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

function toLocalSourceConfig(info: AnalysisPyodideCacheInfo): PyodideSourceConfig | null {
  const moduleUrl = String(info.moduleUrl ?? "").trim();
  const indexURL = String(info.indexUrl ?? "").trim();
  if (!moduleUrl || !indexURL) {
    return null;
  }
  return {
    moduleUrl,
    indexURL,
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
        const localSource = toLocalSourceConfig(info);
        if (!localSource) {
          return [];
        }
        candidates.push({
          name: "local-cache",
          source: localSource,
        });
      } catch {
        return [];
      }
      return candidates;
    }

    candidates.push({
      name: "cdn-fallback",
      source: buildCdnSource(),
    });
    return candidates;
  })();

  return cachedCandidatesPromise;
}
