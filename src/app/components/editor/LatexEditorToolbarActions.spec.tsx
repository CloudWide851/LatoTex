// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranslationFn } from "../../types/i18n";
import { LatexEditorToolbarActions } from "./LatexEditorToolbarActions";

vi.mock("./ScientificEditorRunControl", () => ({
  ScientificEditorRunControl: () => null,
}));

const t: TranslationFn = (key) => key;

function toolbarProps() {
  return {
    activeProjectId: "project-1",
    busy: false,
    compileBusy: false,
    selectedFile: "main.tex",
    selectedIsDraw: false,
    selectedFileWriteLocked: true,
    editorContent: "\\documentclass{article}",
    scientificPluginIds: [],
    terminalVisible: false,
    showCompileAssist: false,
    compileAssistDiagnostics: [],
    compileAssistHint: "",
    compileAssistAutoFixBusy: false,
    getSelectedCode: vi.fn(() => ""),
    onEditorUndo: vi.fn(),
    onEditorRedo: vi.fn(),
    onSaveFile: vi.fn(),
    onTerminalToggle: vi.fn(),
    onOpenDraw: vi.fn(),
    onCompileClick: vi.fn(),
    onCompileAssistDismiss: vi.fn(),
    onCompileAssistAutoFix: vi.fn(),
    t,
  };
}

describe("LatexEditorToolbarActions", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("locks editor mutations while keeping navigation and valid compilation available", async () => {
    const props = toolbarProps();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<LatexEditorToolbarActions {...props} />);
    });

    expect(container.querySelector<HTMLButtonElement>('button[aria-label^="workspace.undo"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('button[aria-label^="workspace.redo"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('button[aria-label^="workspace.save"]')?.disabled).toBe(true);
    const terminalButton = container.querySelector<HTMLButtonElement>('button[aria-label="terminal.title"]');
    const compileButton = container.querySelector<HTMLButtonElement>('button[aria-label^="workspace.compile"]');
    expect(terminalButton?.disabled).toBe(false);
    expect(compileButton?.disabled).toBe(false);

    await act(async () => {
      terminalButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      compileButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(props.onTerminalToggle).toHaveBeenCalledOnce();
    expect(props.onCompileClick).toHaveBeenCalledOnce();

    await act(async () => {
      root.render(<LatexEditorToolbarActions {...props} compileBusy />);
    });
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="terminal.title"]')?.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>('button[aria-label^="workspace.compile"]')?.disabled).toBe(true);

    await act(async () => {
      root.render(
        <LatexEditorToolbarActions
          {...props}
          selectedFile="notes.md"
          selectedFileWriteLocked={false}
        />,
      );
    });
    expect(container.querySelector<HTMLButtonElement>('button[aria-label^="workspace.undo"]')?.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>('button[aria-label^="workspace.compile"]')?.disabled).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });
});
