import { describe, expect, it, vi } from "vitest";
import {
  dispatchResearchUiCommand,
  researchRunRecoveryCandidates,
} from "./useResearchAgentRuntime";

function context() {
  return {
    projectId: "project-1",
    setPage: vi.fn(),
    openWorkspaceFile: vi.fn(),
    selectLibraryPath: vi.fn(),
    proposeLatex: vi.fn().mockResolvedValue({ proposalId: "proposal-1" }),
    applyLatex: vi.fn().mockResolvedValue({ applied: true }),
    compileLatex: vi.fn().mockResolvedValue({ status: "ok" }),
    generateReport: vi.fn().mockResolvedValue({ reportId: "report-1" }),
    createDraw: vi.fn().mockResolvedValue({ path: "drawings/figure.drawio" }),
    exportDraw: vi.fn().mockResolvedValue({ savedPath: "drawings/figure.svg" }),
    sendSubmission: vi.fn().mockRejectedValue(new Error("research.ui_command.submission_channel_unavailable")),
    updatePlugin: vi.fn().mockResolvedValue({ pluginId: "plugin-1" }),
    changeSettings: vi.fn().mockResolvedValue({ updated: ["theme"] }),
  };
}

describe("research UI capability dispatch", () => {
  it("recovers persisted running work only once per mounted project", () => {
    const run = {
      runId: "research-run-1",
      projectId: "project-1",
      taskId: "task-1",
      planVersion: 1,
      status: "running",
      currentStepId: null,
      completedSteps: 0,
      totalSteps: 2,
      lastOperation: null,
      evidenceCount: 0,
      diagnosticCode: null,
      startedAt: "2026-08-07T00:00:00Z",
      updatedAt: "2026-08-07T00:00:00Z",
      finishedAt: null,
    };
    expect(researchRunRecoveryCandidates([run], new Set())).toEqual([run]);
    expect(researchRunRecoveryCandidates([run], new Set([run.runId]))).toEqual([]);
    expect(researchRunRecoveryCandidates([{ ...run, status: "paused" }], new Set())).toEqual([]);
  });

  it("navigates only to registered workspace pages and opens the requested resource", async () => {
    const target = context();
    await dispatchResearchUiCommand(
      { command: "ui.navigate", pageId: "latex", resource: "paper/main.tex" },
      target,
    );
    expect(target.openWorkspaceFile).toHaveBeenCalledWith("paper/main.tex", "pinned");
    expect(target.setPage).toHaveBeenCalledWith("latex");

    await expect(dispatchResearchUiCommand(
      { command: "ui.navigate", pageId: "browser-console" },
      target,
    )).rejects.toThrow("research.ui_command.page_invalid");
  });

  it("keeps literature navigation project-local and delegates registered page actions", async () => {
    const target = context();
    await dispatchResearchUiCommand(
      { command: "literature.open", path: ".latotex/papers/topic/paper.bib" },
      target,
    );
    expect(target.selectLibraryPath).toHaveBeenCalledWith("topic/paper.bib");
    expect(target.setPage).toHaveBeenCalledWith("library");

    await dispatchResearchUiCommand(
      { command: "workspace.compile", mainPath: "main.tex" },
      target,
    );
    expect(target.compileLatex).toHaveBeenCalledWith({ command: "workspace.compile", mainPath: "main.tex" });
  });

  it("covers every UI-owned capability without a generic unsupported result", async () => {
    const target = context();
    await dispatchResearchUiCommand(
      { command: "workspace.propose_latex", path: "main.tex", instruction: "Clarify the method" },
      target,
    );
    await dispatchResearchUiCommand(
      { command: "workspace.apply_latex", path: "main.tex", proposalId: "latest" },
      target,
    );
    await dispatchResearchUiCommand({ command: "report.generate", title: "Methods report" }, target);
    await dispatchResearchUiCommand({ command: "draw.create", name: "flow" }, target);
    await dispatchResearchUiCommand({ command: "draw.export", path: "drawings/flow.drawio", format: "svg" }, target);
    await dispatchResearchUiCommand({ command: "plugin.update", pluginId: "plugin-1" }, target);
    await dispatchResearchUiCommand({ command: "settings.change", patch: { uiPrefs: { theme: "dark" } } }, target);

    expect(target.proposeLatex).toHaveBeenCalledTimes(1);
    expect(target.applyLatex).toHaveBeenCalledTimes(1);
    expect(target.generateReport).toHaveBeenCalledTimes(1);
    expect(target.createDraw).toHaveBeenCalledTimes(1);
    expect(target.exportDraw).toHaveBeenCalledTimes(1);
    expect(target.updatePlugin).toHaveBeenCalledTimes(1);
    expect(target.changeSettings).toHaveBeenCalledTimes(1);
    await expect(dispatchResearchUiCommand(
      { command: "submission.send", artifactId: "pack-1", channel: "email" },
      target,
    )).rejects.toThrow("research.ui_command.submission_channel_unavailable");
  });

  it("rejects backend-only and unknown commands at the UI boundary", async () => {
    const target = context();
    await expect(dispatchResearchUiCommand(
      { command: "workspace.read", path: "main.tex" },
      target,
    )).rejects.toThrow("research.ui_command.backend_only");
    await expect(dispatchResearchUiCommand(
      { command: "shell.exec" } as never,
      target,
    )).rejects.toThrow("research.ui_command.unsupported");
  });
});
