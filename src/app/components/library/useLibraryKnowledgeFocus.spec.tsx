// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeDocumentFocusRequest } from "../../../shared/types/app";
import { useLibraryKnowledgeFocus } from "./useLibraryKnowledgeFocus";

let mountedRoot: Root | null = null;

function Probe(props: {
  request: KnowledgeDocumentFocusRequest;
  viewMode: "bib" | "pdf";
  hasPdf: boolean;
  requestPdfOpen: () => void;
  jumpToPage: (page: number) => void;
}) {
  const visible = useLibraryKnowledgeFocus({
    request: props.request,
    projectId: "project-1",
    selectedPath: "paper.bib",
    viewMode: props.viewMode,
    hasPdf: props.hasPdf,
    requestPdfOpen: props.requestPdfOpen,
    jumpToPage: props.jumpToPage,
  });
  return <output>{visible ? `visible:${visible.token}` : "focused"}</output>;
}

describe("useLibraryKnowledgeFocus", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    if (mountedRoot) {
      await act(async () => mountedRoot?.unmount());
      mountedRoot = null;
    }
    document.body.innerHTML = "";
  });

  it("opens the PDF once and jumps to the real evidence page when ready", async () => {
    const requestPdfOpen = vi.fn();
    const jumpToPage = vi.fn();
    const request: KnowledgeDocumentFocusRequest = {
      token: 3,
      projectId: "project-1",
      path: ".latotex/papers/paper.bib",
      anchor: { kind: "page", value: "9", page: 9 },
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;

    await act(async () => root.render(<Probe request={request} viewMode="bib" hasPdf={false} requestPdfOpen={requestPdfOpen} jumpToPage={jumpToPage} />));
    expect(requestPdfOpen).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("visible:3");

    await act(async () => root.render(<Probe request={request} viewMode="pdf" hasPdf requestPdfOpen={requestPdfOpen} jumpToPage={jumpToPage} />));
    expect(requestPdfOpen).toHaveBeenCalledTimes(1);
    expect(jumpToPage).toHaveBeenCalledWith(9);
    expect(container.textContent).toBe("focused");
  });

  it("keeps paragraph anchors visible when exact viewer mapping is unavailable", async () => {
    const request: KnowledgeDocumentFocusRequest = {
      token: 4,
      projectId: "project-1",
      path: ".latotex/papers/paper.bib",
      anchor: { kind: "paragraph", value: "paragraph 4" },
      snippet: "Visible evidence",
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    await act(async () => root.render(<Probe request={request} viewMode="bib" hasPdf={false} requestPdfOpen={() => undefined} jumpToPage={() => undefined} />));
    expect(container.textContent).toBe("visible:4");
  });
});
