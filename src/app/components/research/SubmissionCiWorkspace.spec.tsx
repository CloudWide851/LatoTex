// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubmissionCiWorkspace } from "./SubmissionCiWorkspace";

const messages: Record<string, string> = {
  "research.citation.quickLookupLabel": "Citation lookup",
  "research.submission.texRequired": "Select an editable .tex manuscript.",
  "research.email.configureTitle": "Connect submission mail",
  "research.email.configureDescription": "Configure Channels first.",
  "research.email.configureAction": "Open Channels settings",
  "research.email.empty": "No submission mail",
  "research.email.queue": "Submission mail",
  "research.email.sync": "Sync submission mail",
};

const t = (key: any) => messages[String(key)] ?? String(key);

describe("SubmissionCiWorkspace accessibility", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = "";
  });

  it("names the citation field, exposes focus treatment, and explains unavailable manuscript actions", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SubmissionCiWorkspace
          projectId="project-1"
          selectedFile={null}
          selectedLibraryPath={null}
          editorContent=""
          fileList={[]}
          compileDiagnostics={[]}
          busy={false}
          canCompileSelectedFile={false}
          emailConfigured={false}
          onCompileRepair={vi.fn()}
          onReferenceCheck={vi.fn()}
          onAnalyzePaper={vi.fn()}
          onOpenLibrary={vi.fn()}
          onOpenEmailSettings={vi.fn()}
          onOpenTexMode={vi.fn()}
          onRebuttalReply={vi.fn()}
          onSubmissionPreflight={vi.fn()}
          t={t}
        />,
      );
    });

    const citationInput = container.querySelector<HTMLInputElement>('input[aria-label="Citation lookup"]');
    expect(citationInput).toBeTruthy();
    expect(citationInput?.closest("label")?.className).toContain("focus-within:ring-2");
    expect(container.textContent).toContain("Select an editable .tex manuscript.");

    await act(async () => root.unmount());
  });
});
