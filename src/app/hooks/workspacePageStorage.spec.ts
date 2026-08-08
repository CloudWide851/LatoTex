import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_PAGE,
  isWorkspacePage,
  loadWorkspacePage,
  persistWorkspacePage,
} from "./workspacePageStorage";

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  clear: () => void;
};

function createStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    clear: () => {
      store.clear();
    },
  };
}

describe("workspacePageStorage", () => {
  let localStorage: StorageLike;

  beforeEach(() => {
    localStorage = createStorage();
    Object.defineProperty(globalThis, "window", {
      value: { localStorage },
      configurable: true,
      writable: true,
    });
    localStorage.clear();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("restores a previously persisted valid page", () => {
    persistWorkspacePage("analysis");

    expect(loadWorkspacePage()).toBe("analysis");
  });

  it("accepts the plugin marketplace page", () => {
    persistWorkspacePage("plugins");

    expect(loadWorkspacePage()).toBe("plugins");
    expect(isWorkspacePage("plugins")).toBe(true);
  });

  it("accepts overview, submission, and the Agent Studio page", () => {
    for (const page of ["overview", "submission", "agents"] as const) {
      persistWorkspacePage(page);
      expect(loadWorkspacePage()).toBe(page);
      expect(isWorkspacePage(page)).toBe(true);
    }
  });

  it("falls back to overview when no page is persisted", () => {
    expect(loadWorkspacePage()).toBe(DEFAULT_WORKSPACE_PAGE);
  });

  it("falls back to overview when the persisted value is invalid", () => {
    localStorage.setItem("latotex.workspace.page", "unknown-page");

    expect(loadWorkspacePage()).toBe(DEFAULT_WORKSPACE_PAGE);
  });

  it("validates workspace page ids strictly", () => {
    expect(isWorkspacePage("git")).toBe(true);
    expect(isWorkspacePage("unknown-page")).toBe(false);
  });
});
