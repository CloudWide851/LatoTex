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
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders the file preview surface without inline share comments in the preview pane", async () => {
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
          previewFocusRequest={null}
          terminalVisible={false}
          t={(key) => String(key)}
        />,
      );
    });

    expect(container.querySelector("[data-testid='file-preview-pane']")).not.toBeNull();
    expect(container.querySelector("[data-testid='workspace-preview-content']")?.className).toContain("min-h-0");
    expect(container.querySelector("[data-testid='workspace-preview-content']")?.className).toContain("flex-1");
    expect(container.textContent).not.toContain("share.commentsInPreview");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
