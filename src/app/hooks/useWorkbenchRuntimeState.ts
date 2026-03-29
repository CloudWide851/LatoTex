import { useCallback, useRef } from "react";
import type { Locale } from "../../i18n";
import type { AppSettings } from "../../shared/types/app";
import { useTrayLabelSync, useCompiledPreviewResetOnProjectChange } from "./useAppContainerRuntimeEffects";
import { useAnalysisWorkspace } from "./useAnalysisWorkspace";
import type { useAppContainerState } from "./useAppContainerState";
import { useIdleSleep } from "./useIdleSleep";
import { useRuntimePressureRelief } from "./useRuntimePressureRelief";
import { useTextContentCacheBridge } from "./useTextContentCacheBridge";
import { useAnalysisEnvPrompt } from "./useAnalysisEnvPrompt";
import { useProjectResourceWarmup } from "@features/workbench";

type AppContainerState = ReturnType<typeof useAppContainerState>;
type TranslationFn = (...args: any[]) => string;

export function useWorkbenchRuntimeState(params: {
  s: AppContainerState;
  isTauriRuntime: boolean;
  locale: Locale;
  t: TranslationFn;
  persistSettings: (settings: AppSettings) => Promise<AppSettings>;
}) {
  const { s, isTauriRuntime, locale, t, persistSettings } = params;

  useTrayLabelSync({ isTauriRuntime, locale, t });
  useCompiledPreviewResetOnProjectChange({
    activeProjectId: s.activeProjectId,
    page: s.page,
    compiledPdfRelativePath: s.compiledPdfRelativePath,
    setPdfUrl: s.setPdfUrl,
    setCompiledPdfRelativePath: s.setCompiledPdfRelativePath,
    setPreferCompiledPreview: s.setPreferCompiledPreview,
  });

  const runtimeBusy = s.busy || Boolean(s.agentRunId) || Boolean(s.gitDownloadTaskId);
  const idleSleep = useIdleSleep({
    blocked: runtimeBusy,
    timeoutMs: 60 * 60 * 1000,
  });

  const analysisWorkspace = useAnalysisWorkspace({
    projectId: s.activeProjectId,
    selectedFile: s.selectedFile,
    editorContent: s.editorContent,
    fileList: s.fileList,
    locale,
    analysisModelOverride: s.settings?.uiPrefs?.featureModelBindings?.analysisAgentModelId ?? null,
    suspended: idleSleep.sleeping,
    events: s.events,
    t,
    setToast: s.setToast,
  });

  useProjectResourceWarmup({
    activeProjectId: s.activeProjectId,
    suspended: idleSleep.sleeping,
  });

  const analysisEnvPrompt = useAnalysisEnvPrompt({
    activeProjectId: s.activeProjectId,
    settings: s.settings,
    persistSettings,
    t,
    setToast: s.setToast,
  });

  const { getCachedTextContent, handleTextFileLoaded } = useTextContentCacheBridge({
    workingContentByPathRef: s.workingContentByPathRef,
    savedContentByPathRef: s.savedContentByPathRef,
    dirtyByPathRef: s.dirtyByPathRef,
  });

  const runtimePressureRelief = useRuntimePressureRelief({
    sleeping: idleSleep.sleeping,
    pdfUrl: s.pdfUrl,
    selectedFilePdfUrl: s.selectedFilePdfUrl,
    selectedImagePreviewUrl: s.selectedImagePreviewUrl,
    setPdfUrl: s.setPdfUrl,
    setSelectedFilePdfUrl: s.setSelectedFilePdfUrl,
    setSelectedImagePreviewUrl: s.setSelectedImagePreviewUrl,
    setEvents: s.setEvents,
  });

  const oomSleepAtRef = useRef(0);
  const handleOutOfMemorySleep = useCallback((_source: "error" | "unhandledrejection" | "memory_guard", _message: string) => {
    const now = Date.now();
    if (now - oomSleepAtRef.current < 5_000) {
      return;
    }
    oomSleepAtRef.current = now;
    runtimePressureRelief.release("oom");
    idleSleep.forceSleep();
  }, [idleSleep.forceSleep, runtimePressureRelief]);

  return {
    idleSleep,
    analysisWorkspace,
    analysisEnvPrompt,
    getCachedTextContent,
    handleTextFileLoaded,
    handleOutOfMemorySleep,
  };
}
