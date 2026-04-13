// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspacePreviewPanel } from "./WorkspacePreviewPanel";

vi.mock("../FilePreviewPane", () => ({
  FilePreviewPane: () => <div data-testid="file-preview-pane" />,
}));

vi.mock("../table/TablePreviewPane", () => ({
  TablePreviewPane: () => <div data-testid="table-preview-pane" />,
}));

describe("WorkspacePreviewPanel", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }));
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts desktop comments through the local share endpoint", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <WorkspacePreviewPanel
          activeProjectId="project-1"
          selectedFile="main.tex"
          selectedIsCsv={false}
          selectedIsMarkdown={false}
          selectedIsImage={false}
          selectedIsSvg={false}
          selectedIsTabular={false}
          selectedIsCode={false}
          editorContent=""
          compiledPdfUrl={null}
          previewMode="empty"
          previewPdfUrl={null}
          previewPdfFallbackRelativePath={null}
          imagePreviewUrl={null}
          canZoomPreview={false}
          previewZoom={1}
          compileErrorLine={null}
          compileInstallProgress={null}
          onEditorChange={() => undefined}
          onOpenLogs={() => undefined}
          onExportPdf={() => undefined}
          onZoomIn={() => undefined}
          onZoomOut={() => undefined}
          onZoomReset={() => undefined}
          onPreviewZoomChange={() => undefined}
          shareSession={{
            active: true,
            localUrl: "http://127.0.0.1:4021",
            sessionId: "sid-1",
            password: "pwd-1",
          }}
          shareComments={[]}
          onJumpToShareComment={() => undefined}
          previewFocusRequest={null}
          t={(key) => String(key)}
        />,
      );
    });

    const textarea = container.querySelector("textarea");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "Need to adjust theorem wording.");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const button = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent === "share.postComment",
    );
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:4021/api/comments/post",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect((fetch as any).mock.calls[0][1].body).toContain("\"sid\":\"sid-1\"");
    expect((fetch as any).mock.calls[0][1].body).toContain("\"text\":\"Need to adjust theorem wording.\"");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
