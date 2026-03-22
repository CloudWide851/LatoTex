import { describe, expect, it } from "vitest";
import {
  appendLocalResourceBaseVariants,
  buildLocalResourceBaseCandidates,
  buildLocalResourceEntryCandidates,
  isSameOriginResourceCandidate,
  orderLocalResourceCandidatesByOrigin,
  prioritizeReachableLocalResourceCandidates,
} from "./localResourceProbe";

describe("localResourceProbe", () => {
  it("normalizes encoded Windows asset.localhost candidates", () => {
    const candidates = buildLocalResourceBaseCandidates(
      "F:\\LatoTex\\drawio-cache",
      () => "http://asset.localhost/F%3A%2FLatoTex%2Fdrawio-cache",
    );

    expect(candidates[0]).toBe("http://asset.localhost/F:/LatoTex/drawio-cache");
  });

  it("appends normalized and raw base variants once", () => {
    const values: string[] = [];
    appendLocalResourceBaseVariants(values, "http://asset.localhost/F%3A%2FLatoTex%2Fdrawio-cache/");

    expect(values).toEqual([
      "http://asset.localhost/F%3A%2FLatoTex%2Fdrawio-cache",
      "http://asset.localhost/F:/LatoTex/drawio-cache",
    ]);
  });

  it("builds entry candidates from base candidates", () => {
    expect(
      buildLocalResourceEntryCandidates(
        ["http://tauri.localhost/drawio", "http://asset.localhost/F:/drawio-cache"],
        "index.html",
      ),
    ).toEqual([
      "http://tauri.localhost/drawio/index.html",
      "http://asset.localhost/F:/drawio-cache/index.html",
    ]);
  });

  it("keeps same-origin candidates ahead of asset.localhost candidates", () => {
    expect(
      orderLocalResourceCandidatesByOrigin([
        "http://asset.localhost/F:/drawio-cache/index.html",
        "/drawio/index.html",
        "http://tauri.localhost/drawio/index.html",
      ]),
    ).toEqual([
      "/drawio/index.html",
      "http://tauri.localhost/drawio/index.html",
      "http://asset.localhost/F:/drawio-cache/index.html",
    ]);
  });

  it("detects same-origin relative and tauri.localhost candidates", () => {
    expect(isSameOriginResourceCandidate("/drawio/index.html")).toBe(true);
    expect(isSameOriginResourceCandidate("http://tauri.localhost/drawio/index.html")).toBe(true);
    expect(isSameOriginResourceCandidate("http://asset.localhost/F:/drawio-cache/index.html")).toBe(false);
  });

  it("promotes the first reachable candidate ahead of broken ones", async () => {
    const reordered = await prioritizeReachableLocalResourceCandidates(
      [
        "/drawio/index.html",
        "http://asset.localhost/F:/drawio-cache/index.html",
      ],
      async (url) => url.includes("asset.localhost"),
    );

    expect(reordered[0]).toBe("http://asset.localhost/F:/drawio-cache/index.html");
  });
});
