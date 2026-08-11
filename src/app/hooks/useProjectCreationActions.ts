import { useCallback } from "react";
import type { MessageKey } from "../../i18n/messages/en-US/index";
import { createProject, initProjectFromFolder } from "../../shared/api/projects";
import { runtimeLogWrite } from "../../shared/api/runtime";
import type { AppSettings, ProjectSummary, ResourceNode } from "../../shared/types/app";

type TranslationFn = (key: MessageKey) => string;

export function useProjectCreationActions(params: {
  setBusy: (value: boolean) => void;
  setProjects: React.Dispatch<React.SetStateAction<ProjectSummary[]>>;
  setActiveProjectId: (value: string | null) => void;
  setTree: React.Dispatch<React.SetStateAction<ResourceNode[]>>;
  setSelectedFile: React.Dispatch<React.SetStateAction<string | null>>;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings | null>>;
  setToast: (value: { type: "info" | "error"; message: string } | null) => void;
  upsertProject: (projects: ProjectSummary[], project: ProjectSummary) => ProjectSummary[];
  t: TranslationFn;
}) {
  const {
    setBusy,
    setProjects,
    setActiveProjectId,
    setTree,
    setSelectedFile,
    setSettings,
    setToast,
    upsertProject,
    t,
  } = params;

  const applySnapshot = useCallback((snapshot: {
    summary: ProjectSummary;
    tree: ResourceNode[];
    mainFile: string;
  }) => {
    setProjects((prev) => upsertProject(prev, snapshot.summary));
    setActiveProjectId(snapshot.summary.id);
    setTree(snapshot.tree);
    setSelectedFile(snapshot.mainFile);
  }, [setActiveProjectId, setProjects, setSelectedFile, setTree, upsertProject]);

  const handleInitProjectFromFolder = useCallback(async () => {
    setBusy(true);
    try {
      const snapshot = await initProjectFromFolder();
      if (!snapshot) {
        return;
      }
      applySnapshot(snapshot);
      setSettings((prev) => prev ? { ...prev, activeProjectId: snapshot.summary.id } : prev);
      setToast({ type: "info", message: t("toast.projectCreated") });
      await runtimeLogWrite("INFO", `project initialized from folder: ${snapshot.summary.rootPath}`);
    } catch (error) {
      void runtimeLogWrite("ERROR", `project folder initialization failed: ${String(error)}`).catch(() => undefined);
      setToast({ type: "error", message: t("toast.initFailed") });
    } finally {
      setBusy(false);
    }
  }, [applySnapshot, setBusy, setSettings, setToast, t]);

  const handleCreateSampleProject = useCallback(async () => {
    setBusy(true);
    try {
      const snapshot = await createProject(t("workspace.sampleProjectName"), {
        template: "research-paper",
      });
      applySnapshot(snapshot);
      setSettings((prev) => prev ? { ...prev, activeProjectId: snapshot.summary.id } : prev);
      setToast({ type: "info", message: t("toast.projectCreated") });
      await runtimeLogWrite("INFO", `offline research sample created: ${snapshot.summary.id}`);
    } catch (error) {
      void runtimeLogWrite("ERROR", `offline research sample creation failed: ${String(error)}`).catch(() => undefined);
      setToast({ type: "error", message: t("toast.projectCreateFailed") });
    } finally {
      setBusy(false);
    }
  }, [applySnapshot, setBusy, setSettings, setToast, t]);

  return { handleInitProjectFromFolder, handleCreateSampleProject };
}
