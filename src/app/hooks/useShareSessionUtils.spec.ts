import { describe, expect, it } from "vitest";
import type { ShareSessionInfo } from "../../shared/types/app";
import { isShareReady } from "./shareSessionUtils";

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

  it("requires both remote access and pdf readiness for remote mode", () => {
    expect(isShareReady(buildSession({ status: "ready", remoteJoinUrl: "https://share.example", pdfState: "ready" }), "remote")).toBe(true);
    expect(isShareReady(buildSession({ status: "ready", remoteJoinUrl: "https://share.example", pdfState: "empty" }), "remote")).toBe(false);
  });
});
