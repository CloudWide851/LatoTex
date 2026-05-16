/// <reference types="vite/client" />

declare global {
  interface Window {
    __LATOTEX_E2E_INVOKE__?: (command: string, args?: Record<string, unknown>) => unknown | Promise<unknown>;
  }
}

export {};
