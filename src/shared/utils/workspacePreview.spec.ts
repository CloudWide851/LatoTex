import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildWorkspacePreviewCandidates,
  probeWorkspacePreviewUrl,
  resolveReachableWorkspacePreviewUrl,
} from "./workspacePreview";

describe("workspacePreview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds explicit and derived preview candidates with cache keys", () => {
    expect(buildWorkspacePreviewCandidates({
      projectId: "project/one",
      relativePath: ".latotex/build/native-output/main.pdf",
      previewUrl: "http://127.0.0.1:1420/assets/main.pdf",
      cacheKey: 7,
    })).toEqual([
      "http://127.0.0.1:1420/assets/main.pdf?v=7",
      "http://latotex-resource.localhost/workspace-file/project%2Fone/.latotex%2Fbuild%2Fnative-output%2Fmain.pdf?v=7",
    ]);
  });

  it("accepts a successful HEAD probe", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(probeWorkspacePreviewUrl("http://127.0.0.1:1420/assets/main.pdf")).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:1420/assets/main.pdf", {
      method: "HEAD",
      cache: "no-store",
    });
  });

  it("falls back to a range GET probe when HEAD is not supported", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 405 })
      .mockResolvedValueOnce({ ok: false, status: 206 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(probeWorkspacePreviewUrl("http://127.0.0.1:1420/assets/main.pdf")).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(2, "http://127.0.0.1:1420/assets/main.pdf", {
      method: "GET",
      cache: "no-store",
      headers: {
        Range: "bytes=0-0",
      },
    });
  });

  it("returns the first reachable fallback candidate", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveReachableWorkspacePreviewUrl({
      projectId: "project/one",
      relativePath: ".latotex/build/native-output/main.pdf",
      previewUrl: "http://127.0.0.1:1420/assets/main.pdf",
      cacheKey: "preview-refresh",
    })).resolves.toEqual({
      url: "http://latotex-resource.localhost/workspace-file/project%2Fone/.latotex%2Fbuild%2Fnative-output%2Fmain.pdf?v=preview-refresh",
      verified: true,
      failureCode: null,
    });
  });

  it("surfaces an unreachable failure when every candidate probe fails", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveReachableWorkspacePreviewUrl({
      projectId: "project/one",
      relativePath: ".latotex/build/native-output/main.pdf",
      previewUrl: "http://127.0.0.1:1420/assets/main.pdf",
      cacheKey: 9,
    })).resolves.toEqual({
      url: "http://127.0.0.1:1420/assets/main.pdf?v=9",
      verified: false,
      failureCode: "workspace.preview.unreachable",
    });
  });
});