import type {
  AnalysisPyodideCacheInfo,
  BusyTexCacheInfo,
  BusyTexInstallPackageResult,
  DrawioCacheInfo,
  LocalResourceProbeResponse,
} from "../types/app";
import { invokeCommand } from "./core";

export function busytexCachePrepare(policy: "install-first" | "appdata-only"): Promise<BusyTexCacheInfo> {
  return invokeCommand<BusyTexCacheInfo>("busytex_cache_prepare", { input: { policy } });
}

export function busytexInstallMissingPackage(input: {
  styleFile: string;
  policy?: "install-first" | "appdata-only";
  cacheOnly?: boolean;
}): Promise<BusyTexInstallPackageResult> {
  return invokeCommand<BusyTexInstallPackageResult>("busytex_install_missing_package", { input });
}

export function analysisPyodidePrepare(policy: "install-first" | "appdata-only"): Promise<AnalysisPyodideCacheInfo> {
  return invokeCommand<AnalysisPyodideCacheInfo>("analysis_pyodide_prepare", { input: { policy } });
}

export function drawioCachePrepare(policy: "install-first" | "appdata-only"): Promise<DrawioCacheInfo> {
  return invokeCommand<DrawioCacheInfo>("drawio_cache_prepare", { input: { policy } });
}

export function localResourceProbe(policy: "install-first" | "appdata-only" = "install-first"): Promise<LocalResourceProbeResponse> {
  return invokeCommand<LocalResourceProbeResponse>("local_resource_probe", { input: { policy } });
}
