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

function createSessionStorage(): StorageLike {
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
  let sessionStorage: StorageLike;

  beforeEach(() => {
    sessionStorage = createSessionStorage();
    Object.defineProperty(globalThis, "window", {
      value: { sessionStorage },
      configurable: true,
      writable: true,
    });
    sessionStorage.clear();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("restores a previously persisted valid page", () => {
    persistWorkspacePage("analysis");

    expect(loadWorkspacePage()).toBe("analysis");
  });

  it("falls back to latex when no page is persisted", () => {
    expect(loadWorkspacePage()).toBe(DEFAULT_WORKSPACE_PAGE);
  });

  it("falls back to latex when the persisted value is invalid", () => {
    sessionStorage.setItem("latotex.workspace.page", "unknown-page");

    expect(loadWorkspacePage()).toBe(DEFAULT_WORKSPACE_PAGE);
  });

  it("validates workspace page ids strictly", () => {
    expect(isWorkspacePage("git")).toBe(true);
    expect(isWorkspacePage("unknown-page")).toBe(false);
  });
});
