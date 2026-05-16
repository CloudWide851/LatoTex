import { invoke } from "@tauri-apps/api/core";

export function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (typeof window !== "undefined" && window.__LATOTEX_E2E_INVOKE__) {
    return Promise.resolve(window.__LATOTEX_E2E_INVOKE__(command, args) as T);
  }
  return invoke<T>(command, args);
}
