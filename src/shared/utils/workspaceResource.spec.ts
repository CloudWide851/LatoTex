import { describe, expect, it } from "vitest";
import {
  buildWorkspacePreviewUrl,
  buildWorkspaceResourceUrl,
} from "./workspaceResource";

describe("workspaceResource", () => {
  it("builds a stable workspace resource url without preview cache keys", () => {
    expect(buildWorkspaceResourceUrl("project/one", ".latotex/build/native-output/main.pdf")).toBe(
      "http://latotex-resource.localhost/workspace-file/project%2Fone/.latotex%2Fbuild%2Fnative-output%2Fmain.pdf",
    );
  });

  it("appends a preview cache key for pdf reloads", () => {
    expect(
      buildWorkspacePreviewUrl("project/one", ".latotex/build/native-output/main.pdf", 42),
    ).toBe(
      "http://latotex-resource.localhost/workspace-file/project%2Fone/.latotex%2Fbuild%2Fnative-output%2Fmain.pdf?v=42",
    );
  });

  it("supports string cache keys", () => {
    expect(buildWorkspacePreviewUrl("demo", "out/main.pdf", "preview-refresh")).toBe(
      "http://latotex-resource.localhost/workspace-file/demo/out%2Fmain.pdf?v=preview-refresh",
    );
  });
});
