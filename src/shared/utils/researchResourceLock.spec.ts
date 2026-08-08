import { describe, expect, it } from "vitest";
import type { AgentResourceLock } from "../types/researchAgent";
import {
  findResearchWriteLock,
  normalizeResearchResourcePath,
  researchWriteLockPaths,
} from "./researchResourceLock";

function lock(resourcePath: string, mode: "read" | "write"): AgentResourceLock {
  return {
    lockId: `lock-${mode}`,
    projectId: "project-1",
    resourcePath,
    mode,
    runId: "run-1",
    heartbeatAt: "2026-08-07T00:00:00.000Z",
    expiresAt: "2026-08-07T00:01:30.000Z",
  };
}

describe("research resource lock projection", () => {
  it("matches Windows and workspace-relative path forms case-insensitively", () => {
    const writeLock = lock("Papers\\Draft.TEX", "write");
    expect(normalizeResearchResourcePath("./papers/draft.tex/")).toBe("papers/draft.tex");
    expect(findResearchWriteLock([writeLock], "papers/draft.tex")).toBe(writeLock);
  });

  it("projects only distinct write locks", () => {
    expect(researchWriteLockPaths([
      lock("main.tex", "read"),
      lock("MAIN.tex", "write"),
      lock("./main.tex", "write"),
    ])).toEqual(["main.tex"]);
  });
});
