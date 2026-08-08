import { useMemo } from "react";
import { analysisSaveReport } from "../../shared/api/analysis";
import { getPluginCatalog, installPlugin } from "../../shared/api/plugins";
import type { AppSettings, FsAction, FsScope, WorkspacePage } from "../../shared/types/app";
import type { AgentFileProposal } from "./agentTypes";
import type { ResearchUiCommandContext } from "./researchUiCommandDispatcher";
import { applyResearchSettingsPatch } from "./researchSettingsPatch";
import { EMPTY_DIAGRAM } from "../components/draw/drawWorkspaceConstants";
import { requestDrawAgentExport } from "../components/draw/drawAgentCommandBridge";
import { notifyPluginsChanged } from "../components/plugins/usePluginFileInterfaces";

export function useResearchUiCommandContext(params: {
  projectId: string | null;
  settings: AppSettings | null;
  activeAnalysisRunId: string | null;
  activeAnalysisReportHtml: string;
  setPage: (page: WorkspacePage) => void;
  openWorkspaceFile: (path: string, mode?: "preview" | "pinned") => void;
  selectLibraryPath: (path: string | null) => void;
  runAgentForPath: (path: string, instruction: string) => Promise<AgentFileProposal | null>;
  applyAgentProposal: (path: string, proposalId: string) => Promise<unknown>;
  compilePath: (path: string) => Promise<unknown>;
  runFsAction: (
    scope: FsScope,
    action: FsAction,
    path: string,
    targetPath?: string,
    content?: string,
  ) => Promise<boolean>;
  persistSettings: (settings: AppSettings) => Promise<AppSettings>;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings | null>>;
}): ResearchUiCommandContext {
  return useMemo(() => ({
    projectId: params.projectId,
    setPage: params.setPage,
    openWorkspaceFile: params.openWorkspaceFile,
    selectLibraryPath: params.selectLibraryPath,
    proposeLatex: async (command) => {
      params.openWorkspaceFile(command.path, "pinned");
      params.setPage("latex");
      const proposal = await params.runAgentForPath(command.path, command.instruction);
      if (!proposal) {
        throw new Error("research.ui_command.proposal_not_created");
      }
      return { proposalId: proposal.id, path: proposal.targetPath, summary: proposal.summary };
    },
    applyLatex: async (command) => {
      params.openWorkspaceFile(command.path, "pinned");
      params.setPage("latex");
      return params.applyAgentProposal(command.path, command.proposalId);
    },
    compileLatex: async (command) => {
      params.openWorkspaceFile(command.mainPath, "pinned");
      params.setPage("latex");
      return params.compilePath(command.mainPath);
    },
    generateReport: async (command) => {
      if (!params.projectId || !params.activeAnalysisReportHtml.trim()) {
        throw new Error("research.ui_command.report_source_required");
      }
      const result = await analysisSaveReport({
        projectId: params.projectId,
        runId: params.activeAnalysisRunId ?? undefined,
        title: command.title,
        reportHtml: params.activeAnalysisReportHtml,
      });
      params.setPage("analysis");
      return result;
    },
    createDraw: async (command) => {
      const stem = command.name.trim().replace(/\.drawio$/i, "");
      if (!stem || /[\\/:*?"<>|]/.test(stem)) {
        throw new Error("research.ui_command.draw_name_invalid");
      }
      const path = `drawings/${stem}.drawio`;
      const created = await params.runFsAction("workspace", "create_file", path, undefined, EMPTY_DIAGRAM);
      if (!created) {
        throw new Error("research.ui_command.draw_create_failed");
      }
      params.openWorkspaceFile(path, "pinned");
      params.setPage("draw");
      return { path };
    },
    exportDraw: async (command) => {
      params.openWorkspaceFile(command.path, "pinned");
      params.setPage("draw");
      return requestDrawAgentExport({ sourcePath: command.path, format: command.format });
    },
    sendSubmission: async () => {
      params.setPage("submission");
      throw new Error("research.ui_command.submission_channel_unavailable");
    },
    updatePlugin: async (command) => {
      const catalog = await getPluginCatalog(params.settings?.uiPrefs?.pluginCatalogSources);
      const entry = catalog.items.find((candidate) => candidate.manifest.id === command.pluginId);
      if (!entry || !entry.validation.ok) {
        throw new Error("research.ui_command.plugin_update_unavailable");
      }
      const installed = await installPlugin(entry.manifest, entry.sourceId);
      notifyPluginsChanged();
      return installed;
    },
    changeSettings: async (command) => {
      if (!params.settings) {
        throw new Error("research.ui_command.settings_unavailable");
      }
      const next = applyResearchSettingsPatch(params.settings, command.patch);
      const saved = await params.persistSettings(next);
      params.setSettings(saved);
      return { updated: Object.keys((command.patch as { uiPrefs: object }).uiPrefs) };
    },
  }), [params]);
}
