import type { DrawioCacheInfo } from "../types/app";
import { invokeCommand } from "./core";

export function drawioCachePrepare(policy: "install-first" | "appdata-only"): Promise<DrawioCacheInfo> {
  return invokeCommand<DrawioCacheInfo>("drawio_cache_prepare", { input: { policy } });
}