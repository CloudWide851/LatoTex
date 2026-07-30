// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeScientificCommand } from "../../../shared/api/workspace";
import type { ScientificCommandResponse } from "../../../shared/types/app";
import type { TranslationFn } from "../../types/i18n";
import { ScientificEditorRunControl } from "./ScientificEditorRunControl";

vi.mock("../../../shared/api/workspace", () => ({
  executeScientificCommand: vi.fn(),
}));

const messages: Partial<Record<Parameters<TranslationFn>[0], string>> = {
  "scientific.run.runtime": "Scientific runtime",
  "scientific.run.file": "Run current file",
  "scientific.run.selection": "Run selection",
  "scientific.run.openExternal": "Open externally",
  "scientific.run.outputTitle": "Scientific output",
  "scientific.run.close": "Close output",
  "scientific.run.completed": "Run completed.",
  "scientific.run.opened": "File opened.",
  "scientific.run.failed": "Scientific command failed.",
  "scientific.run.toolchainMissing": "Runtime missing.",
  "scientific.run.selectionEmpty": "Select code first.",
  "scientific.run.pluginDisabled": "Enable the plugin first.",
  "scientific.run.notebookInvalid": "Notebook is invalid.",
  "scientific.run.summary": "Exit {exitCode} · {duration} ms",
  "scientific.run.noOutput": "No output.",
  "scientific.run.truncated": "Output truncated.",
};

const t: TranslationFn = (key) => messages[key] ?? key;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function completedResponse(): ScientificCommandResponse {
  return {
    commandId: "scientific.runFile",
    status: "completed",
    message: "scientific.run_completed",
    output: {
      language: "r",
      status: "completed",
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      durationMs: 12,
      truncated: false,
      runner: "redacted",
    },
  };
}

describe("ScientificEditorRunControl interactions", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(executeScientificCommand).mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("single-flights rapid clicks and releases busy state after completion", async () => {
    const request = deferred<ScientificCommandResponse>();
    vi.mocked(executeScientificCommand).mockReturnValue(request.promise);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ScientificEditorRunControl
          projectId="project-1"
          selectedFile="analysis.R"
          editorContent="print(1)"
          enabledPluginIds={["latotex.science.r"]}
          getSelectedCode={() => ""}
          t={t}
        />,
      );
    });

    const runButton = container.querySelector<HTMLButtonElement>('button[aria-label="Run current file"]');
    expect(runButton).toBeTruthy();
    await act(async () => {
      runButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      runButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(executeScientificCommand).toHaveBeenCalledOnce();

    await act(async () => {
      request.resolve(completedResponse());
      await request.promise;
    });
    expect(container.textContent).toContain("Run completed.");
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Run current file"]')?.disabled).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });

  it("maps backend detail to stable copy and resets busy state after failure", async () => {
    vi.mocked(executeScientificCommand).mockRejectedValue(
      new Error("toolchain_missing password=do-not-render"),
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ScientificEditorRunControl
          projectId="project-1"
          selectedFile="analysis.R"
          editorContent="print(1)"
          enabledPluginIds={["latotex.science.r"]}
          getSelectedCode={() => ""}
          t={t}
        />,
      );
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Run current file"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Runtime missing.");
    expect(container.textContent).not.toContain("do-not-render");
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Run current file"]')?.disabled).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });
});
