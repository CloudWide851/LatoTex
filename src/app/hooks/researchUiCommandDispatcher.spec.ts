import { describe, expect, it, vi } from "vitest";
import type { ResearchUiCommandContext } from "./researchUiCommandDispatcher";
import { dispatchResearchUiCommand } from "./researchUiCommandDispatcher";

function createContext(): ResearchUiCommandContext {
  return {
    projectId: "project-1",
    setPage: vi.fn(),
    openWorkspaceFile: vi.fn(),
    selectLibraryPath: vi.fn(),
    proposeLatex: vi.fn(),
    applyLatex: vi.fn(),
    compileLatex: vi.fn(),
    generateReport: vi.fn(),
    createDraw: vi.fn(),
    exportDraw: vi.fn(),
    sendSubmission: vi.fn(),
    updatePlugin: vi.fn(),
    changeSettings: vi.fn(),
  };
}

describe("dispatchResearchUiCommand navigation compatibility", () => {
  it("maps historical overview navigation to the writing workspace", async () => {
    const context = createContext();

    await expect(dispatchResearchUiCommand({
      command: "ui.navigate",
      pageId: "overview",
    }, context)).resolves.toEqual({ pageId: "latex", resource: null });

    expect(context.setPage).toHaveBeenCalledWith("latex");
  });

  it("rejects unknown page ids", async () => {
    const context = createContext();

    await expect(dispatchResearchUiCommand({
      command: "ui.navigate",
      pageId: "unknown-page",
    }, context)).rejects.toThrow("research.ui_command.page_invalid");
  });
});
