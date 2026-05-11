import { describe, expect, it } from "vitest";
import type { ShareSessionInfo } from "../../shared/types/app";
import { detectShareConflict, isShareReady } from "./shareSessionUtils";

function buildSession(partial: Partial<ShareSessionInfo>): ShareSessionInfo {
  return {
    active: false,
    status: "starting",
    ...partial,
  };
}

describe("isShareReady", () => {
  it("requires a join URL for local mode", () => {
    expect(isShareReady(buildSession({ status: "ready", localJoinUrl: "http://127.0.0.1/share" }), "local")).toBe(true);
    expect(isShareReady(buildSession({ status: "ready" }), "local")).toBe(false);
  });

  it("requires remote access but no longer blocks collaboration on pending pdf preparation", () => {
    expect(isShareReady(buildSession({ status: "ready", remoteJoinUrl: "https://share.example", pdfState: "ready" }), "remote")).toBe(true);
    expect(isShareReady(buildSession({ status: "ready", remoteJoinUrl: "https://share.example", pdfState: "empty" }), "remote")).toBe(true);
    expect(isShareReady(buildSession({ status: "ready", pdfState: "ready" }), "remote")).toBe(false);
  });
});

describe("detectShareConflict", () => {
  it("requires both local and remote changes from the same base", () => {
    expect(detectShareConflict({
      path: "main.tex",
      baseContent: "base",
      localContent: "local",
      remoteContent: "remote",
      remoteSeq: 12,
    })?.remoteSeq).toBe(12);
    expect(detectShareConflict({
      path: "main.tex",
      baseContent: "base",
      localContent: "base",
      remoteContent: "remote",
    })).toBeNull();
    expect(detectShareConflict({
      path: "main.tex",
      baseContent: "base",
      localContent: "local",
      remoteContent: "local",
    })).toBeNull();
  });
});
