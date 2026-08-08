import { updateAgentRuntime } from "../../shared/api/agent";
import { analysisExportArtifact, analysisRunPython, referenceCheck } from "../../shared/api/analysis";
import { gitCommit, gitDiffFile, gitStage, gitStatus } from "../../shared/api/git";
import { importLibraryLink } from "../../shared/api/library";
import { listInstalledPlugins } from "../../shared/api/plugins";
import { submissionPackBuild, writeFile } from "../../shared/api/workspace";
import type { AgentRuntimeId } from "../../shared/types/agentControl";
import type { WorkspacePage } from "../../shared/types/app";
import type { AgentAppCommand } from "../../shared/types/researchAgent";
import { isWorkspacePage } from "./workspacePageStorage";

const RUNTIME_IDS = new Set<AgentRuntimeId>(["native", "codex-cli", "claude-code-cli"]);
const BACKEND_ONLY_COMMANDS = new Set<AgentAppCommand["command"]>([
  "project.overview",
  "literature.search",
  "workspace.read",
  "submission.check",
  "runtime.status",
]);

type CommandOf<Name extends AgentAppCommand["command"]> = Extract<AgentAppCommand, { command: Name }>;

export type ResearchUiCommandContext = {
  projectId: string | null;
  setPage: (page: WorkspacePage) => void;
  openWorkspaceFile: (path: string, mode?: "preview" | "pinned") => void;
  selectLibraryPath: (path: string | null) => void;
  proposeLatex: (command: CommandOf<"workspace.propose_latex">) => Promise<unknown>;
  applyLatex: (command: CommandOf<"workspace.apply_latex">) => Promise<unknown>;
  compileLatex: (command: CommandOf<"workspace.compile">) => Promise<unknown>;
  generateReport: (command: CommandOf<"report.generate">) => Promise<unknown>;
  createDraw: (command: CommandOf<"draw.create">) => Promise<unknown>;
  exportDraw: (command: CommandOf<"draw.export">) => Promise<unknown>;
  sendSubmission: (command: CommandOf<"submission.send">) => Promise<unknown>;
  updatePlugin: (command: CommandOf<"plugin.update">) => Promise<unknown>;
  changeSettings: (command: CommandOf<"settings.change">) => Promise<unknown>;
};

function librarySelectionPath(path: string): string {
  const prefix = ".latotex/papers/";
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

export async function dispatchResearchUiCommand(
  command: AgentAppCommand,
  context: ResearchUiCommandContext,
): Promise<unknown> {
  const { projectId } = context;
  if (!projectId) {
    throw new Error("research.ui_command.project_required");
  }
  if (BACKEND_ONLY_COMMANDS.has(command.command)) {
    throw new Error("research.ui_command.backend_only");
  }
  switch (command.command) {
    case "ui.navigate": {
      if (!isWorkspacePage(command.pageId)) {
        throw new Error("research.ui_command.page_invalid");
      }
      if (command.resource) {
        if (command.pageId === "library") {
          context.selectLibraryPath(librarySelectionPath(command.resource));
        } else {
          context.openWorkspaceFile(command.resource, "pinned");
        }
      }
      context.setPage(command.pageId);
      return { pageId: command.pageId, resource: command.resource ?? null };
    }
    case "literature.import": {
      const imported = await importLibraryLink(projectId, command.source);
      context.selectLibraryPath(librarySelectionPath(imported.relativePath));
      context.setPage("library");
      return imported;
    }
    case "literature.open":
      context.selectLibraryPath(librarySelectionPath(command.path));
      context.setPage("library");
      return { path: command.path };
    case "literature.citation_trace":
      return referenceCheck([command.doi], 10, projectId, undefined, undefined, true);
    case "workspace.propose_latex":
      return context.proposeLatex(command);
    case "workspace.apply_latex":
      return context.applyLatex(command);
    case "workspace.write_non_latex":
      return writeFile(projectId, command.path, command.content);
    case "workspace.compile":
      return context.compileLatex(command);
    case "analysis.run":
      return analysisRunPython({
        projectId,
        prompt: command.prompt,
        outputLanguage: "en-US",
        plan: {
          intent: command.prompt,
          inputFiles: command.inputFiles,
          targetColumns: [],
          missingValueStrategy: "complete_case",
          alpha: 0.05,
        },
      });
    case "report.generate":
      return context.generateReport(command);
    case "report.export":
      return analysisExportArtifact(projectId, command.reportId, `${command.reportId}.${command.format}`);
    case "draw.create":
      return context.createDraw(command);
    case "draw.open":
      context.openWorkspaceFile(command.path, "pinned");
      context.setPage("draw");
      return { path: command.path };
    case "draw.export":
      return context.exportDraw(command);
    case "submission.build":
      return submissionPackBuild({
        projectId,
        mainPath: command.mainPath,
        profileId: command.profileId ?? "generic",
        gateIssues: [],
        compileDiagnostics: [],
      });
    case "submission.send":
      return context.sendSubmission(command);
    case "git.status":
      return gitStatus(projectId);
    case "git.diff":
      return command.path ? gitDiffFile(projectId, command.path) : gitStatus(projectId);
    case "git.commit":
      await gitStage(projectId, command.paths);
      return gitCommit(projectId, command.message);
    case "runtime.update": {
      if (!RUNTIME_IDS.has(command.runtimeId as AgentRuntimeId)) {
        throw new Error("research.ui_command.runtime_invalid");
      }
      return updateAgentRuntime(command.runtimeId as AgentRuntimeId);
    }
    case "plugin.status":
      return listInstalledPlugins();
    case "plugin.update":
      return context.updatePlugin(command);
    case "settings.change":
      return context.changeSettings(command);
    default:
      throw new Error("research.ui_command.unsupported");
  }
}
