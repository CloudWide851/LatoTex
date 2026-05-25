import { Suspense, lazy, useEffect, type CSSProperties } from "react";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { AppOverlays } from "./AppOverlays";
import { AppTopbar } from "./AppTopbar";
import { SleepWakeScreen } from "./SleepWakeScreen";
import { UnsavedChangesDialog } from "./editor/UnsavedChangesDialog";
import { useBackgroundImageObjectUrl } from "../hooks/useBackgroundImageObjectUrl";

const AppWorkspaceShell = lazy(async () => {
  const module = await import("./AppWorkspaceShell");
  return { default: module.AppWorkspaceShell };
});

const ACCENT_COLORS: Record<string, string> = {
  emerald: "#22c55e",
  blue: "#3b82f6",
  violet: "#8b5cf6",
  rose: "#f43f5e",
  amber: "#f59e0b",
};

const THEME_PRESETS: Record<string, {
  accent: string;
  background: string;
  surface: string;
  scrollbarTrack: string;
}> = {
  default: { accent: ACCENT_COLORS.emerald, background: "#f1f5f9", surface: "#ffffff", scrollbarTrack: "#e2e8f0" },
  graphite: { accent: "#475569", background: "#e5e7eb", surface: "#f8fafc", scrollbarTrack: "#cbd5e1" },
  paper: { accent: "#b45309", background: "#f5f1e8", surface: "#fffaf0", scrollbarTrack: "#e7dcc6" },
  forest: { accent: "#15803d", background: "#edf7ef", surface: "#fbfff9", scrollbarTrack: "#cfe8d3" },
  ocean: { accent: "#0284c7", background: "#edf7fb", surface: "#f8fdff", scrollbarTrack: "#cfe7f3" },
  rose: { accent: "#e11d48", background: "#fff1f5", surface: "#fffafb", scrollbarTrack: "#f8cddd" },
  amber: { accent: "#d97706", background: "#fff7ed", surface: "#fffdf7", scrollbarTrack: "#f5d8aa" },
  highContrast: { accent: "#0f172a", background: "#f8fafc", surface: "#ffffff", scrollbarTrack: "#94a3b8" },
};

export function AppContainerView(props: any) {
  const {
    status,
    sleeping,
    onWakeFromSleep,
    startupReady,
    suspended,
    logoMark,
    projects,
    activeProjectId,
    busy,
    isTauriRuntime,
    isMaximized,
    projectSearchQuery,
    projectSearchBusy,
    projectSearchSearched,
    projectSearchResults,
    handleProjectChange,
    setProjectSearchQuery,
    handleProjectSearch,
    handleProjectSearchSelect,
    setProjectSearchResults,
    setProjectSearchSearched,
    handleInitProjectFromFolderWithGuard,
    handleWindowControlWithGuard,
    shareSession,
    shareBusy,
    shareSyncing,
    shareConflict,
    shareComments,
    shareMode,
    shareSessionName,
    handleShareModeChange,
    handleShareSessionNameChange,
    handleShareStart,
    handleShareStop,
    handleShareRefresh,
    handleShareConflictResolve,
    t,
    recoverWorkspaceLayout,
    page,
    pageRailItems,
    shellLayout,
    latexLayout,
    latexTerminalLayout,
    analysisLayout,
    libraryLayout,
    libraryBibLayout,
    settings,
    tree,
    libraryTree,
    selectedFile,
    selectedLibraryPath,
    fileList,
    editorContent,
    editorTabs,
    activeTabId,
    dirtyByPath,
    pdfUrl,
    preferCompiledPreview,
    selectedFilePdfUrl,
    selectedImagePreviewUrl,
    previewOverridePath,
    compileErrorLine,
    compileDiagnostics,
    compileInstallProgress,
    agentCollapsed,
    agentPhase,
    agentStatusKey,
    agentPrompt,
    agentMessages,
    agentProposal,
    agentPendingAction,
    agentRunId,
    agentSessions,
    agentSessionPickerOpen,
    agentSessionPickerIndex,
    agentRollbackVisible,
    explorerGitDecorations,
    SHELL_MIN,
    settingsPanel,
    gitPanel,
    analysisPanel,
    setPage,
    handleSelectWorkspacePath,
    setSelectedLibraryPath,
    setEditorContent,
    handleTabSelect,
    handleTabClose,
    handleTabCloseAction,
    handleTabPin,
    editorRef,
    setAgentPrompt,
    setAgentCollapsed,
    handleRunAgent,
    setAgentSessionPickerOpen,
    setAgentSessionPickerIndex,
    handleAgentSessionConfirm,
    handleAgentRollback,
    handleAcceptAgentProposal,
    handleRejectAgentProposal,
    handleResolveAgentPendingAction,
    handleSaveActiveFile,
    handleWriteSelectedFileContent,
    handleCompile,
    handleExportCompiledPdf,
    handleEditorUndo,
    handleEditorRedo,
    setLogsTab,
    setOverlay,
    handleLibraryRescan,
    handleLibraryImportPdf,
    handleLibraryImportLink,
    handleLibrarySyncZotero,
    handleLibraryAnalyzePaper,
    analysisRunning,
    libraryViewMode,
    handleLibraryViewModeChange,
    handleWorkspaceRevealInSystem,
    handleWorkspaceOpenTerminal,
    handleWorkspaceRescan,
    savePanelLayout,
    requestFsAction,
    runFsAction,
    overlay,
    logsTab,
    events,
    modelModalOpen,
    modelModalMode,
    modelModalInitial,
    deleteIntent,
    deleteDontAskAgain,
    integrityIssue,
    themeTransition,
    toast,
    analysisEnvPrompt,
    setModelModalOpen,
    setModelModalInitial,
    setModelModalMode,
    handleModelModalSubmit,
    handleGetModelApiKey,
    setDeleteIntent,
    confirmDelete,
    setDeleteDontAskAgain,
    handleIntegrityCancel,
    handleIntegrityRepair,
    unsavedDialogOpen,
    unsavedDialogIntent,
    unsavedDialogItems,
    unsavedDialogBusy,
    handleUnsavedDialogSaveAndContinue,
    handleUnsavedDialogDiscardAndContinue,
    handleUnsavedDialogCancel,
    closeBehaviorDialogOpen,
    closeBehaviorRememberChoice,
    closeBehaviorDialogBusy,
    setCloseBehaviorRememberChoice,
    handleCloseBehaviorDialogCancel,
    handleCloseBehaviorDialogResolve,
  } = props;
  const completionModelId =
    settings?.uiPrefs?.featureModelBindings?.completionModelId
    || null;
  const chatAgentModelId =
    settings?.uiPrefs?.featureModelBindings?.chatAgentModelId
    || settings?.uiPrefs?.featureModelBindings?.translationModelId
    || null;
  const translationModelId =
    settings?.uiPrefs?.featureModelBindings?.translationModelId
    || null;
  const paperBriefEngine = settings?.uiPrefs?.paperBriefEngine ?? "auto";
  const workspaceExplorerDefaultExpanded = settings?.uiPrefs?.workspaceExplorerDefaultExpanded ?? true;
  const libraryExplorerDefaultExpanded = settings?.uiPrefs?.libraryExplorerDefaultExpanded ?? true;
  const workspaceExplorerExpandedPaths =
    activeProjectId
      ? settings?.uiPrefs?.workspaceExplorerExpandedPathsByProject?.[activeProjectId]
      : undefined;
  const libraryExplorerExpandedPaths =
    activeProjectId
      ? settings?.uiPrefs?.libraryExplorerExpandedPathsByProject?.[activeProjectId]
      : undefined;
  const updateExplorerExpandedPaths = (
    key: "workspaceExplorerExpandedPathsByProject" | "libraryExplorerExpandedPathsByProject",
    paths: string[],
  ) => {
    if (!activeProjectId) {
      return;
    }
    props.setSettings?.((prev: any) => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        uiPrefs: {
          ...(prev.uiPrefs ?? {}),
          [key]: {
            ...(prev.uiPrefs?.[key] ?? {}),
            [activeProjectId]: paths,
          },
        },
      };
    });
  };
  const rawBackgroundPaths: string[] = Array.isArray(settings?.uiPrefs?.backgroundImagePaths)
    ? (settings.uiPrefs.backgroundImagePaths as string[])
    : [];
  const normalizedBackgroundPaths: string[] = Array.from(
    new Set(
      rawBackgroundPaths
        .map((item: string) => String(item ?? "").trim())
        .filter((item: string) => item.length > 0),
    ),
  );
  const selectedBackgroundPath = String(settings?.uiPrefs?.backgroundImagePath ?? "").trim();
  const backgroundPath = selectedBackgroundPath && normalizedBackgroundPaths.includes(selectedBackgroundPath)
    ? selectedBackgroundPath
    : "";
  const backgroundUrl = useBackgroundImageObjectUrl(backgroundPath);
  const rawBlur = Number(settings?.uiPrefs?.backgroundBlurPx ?? 18);
  const backgroundBlurPx = Number.isFinite(rawBlur) ? Math.max(4, Math.min(32, rawBlur)) : 18;
  const themePreset = THEME_PRESETS[String(settings?.uiPrefs?.themePreset ?? "default")] ?? THEME_PRESETS.default;
  const accentChoice = String(settings?.uiPrefs?.accentColor ?? "emerald");
  const accentColor = accentChoice === "custom"
    ? String(settings?.uiPrefs?.accentCustomColor || ACCENT_COLORS.emerald)
    : ACCENT_COLORS[accentChoice] ?? themePreset.accent;
  const hasCustomScrollbarColors = Boolean(
    String(settings?.uiPrefs?.scrollbarThumbColor ?? "").trim()
    || String(settings?.uiPrefs?.scrollbarTrackColor ?? "").trim(),
  );
  const scrollbarColorMode = String(
    settings?.uiPrefs?.scrollbarColorMode ?? (hasCustomScrollbarColors ? "custom" : "accent"),
  );
  const scrollbarThumbColor = scrollbarColorMode === "custom"
    ? String(settings?.uiPrefs?.scrollbarThumbColor || accentColor)
    : accentColor;
  const scrollbarTrackColor = scrollbarColorMode === "custom"
    ? String(settings?.uiPrefs?.scrollbarTrackColor || "")
    : "";
  const scrollbarWidth = Math.max(8, Math.min(18, Number(settings?.uiPrefs?.scrollbarWidthPx ?? 14)));
  const fontScale = Math.max(0.85, Math.min(1.25, Number(settings?.uiPrefs?.fontScale ?? 1)));
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const root = document.documentElement;
    root.style.setProperty("--app-font-scale", String(fontScale));
    return () => {
      root.style.removeProperty("--app-font-scale");
    };
  }, [fontScale]);
  const appBackgroundStyle = {
    ...(backgroundUrl
      ? {
          backgroundImage: `url("${backgroundUrl}")`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          ["--wallpaper-blur" as string]: `${backgroundBlurPx}px`,
        }
      : {}),
    ["--app-accent" as string]: accentColor,
    ["--app-theme-surface" as string]: themePreset.surface,
    ["--control-primary-top" as string]: accentColor,
    ["--control-primary-bottom" as string]: accentColor,
    ["--control-primary-top-hover" as string]: accentColor,
    ["--control-primary-bottom-hover" as string]: accentColor,
    ["--control-primary-border" as string]: accentColor,
    ["--library-scrollbar-thumb" as string]: scrollbarThumbColor,
    ["--library-scrollbar-thumb-hover" as string]: scrollbarColorMode === "custom" ? scrollbarThumbColor : accentColor,
    ["--library-scrollbar-track" as string]: scrollbarTrackColor || themePreset.scrollbarTrack,
    ["--app-scrollbar-size" as string]: `${scrollbarWidth}px`,
    ["--app-glass-opacity" as string]: String(Math.max(0.55, Math.min(1, Number(settings?.uiPrefs?.glassOpacity ?? 0.78)))),
    ["--app-glass-blur" as string]: `${Math.max(0, Math.min(32, Number(settings?.uiPrefs?.glassBlurPx ?? 18)))}px`,
    ["--app-panel-radius" as string]: `${Math.max(4, Math.min(14, Number(settings?.uiPrefs?.panelRadiusPx ?? 8)))}px`,
    ["--app-pdf-page-gap" as string]: `${Math.max(4, Math.min(28, Number(settings?.uiPrefs?.pdfPageGapPx ?? 12)))}px`,
    ["--app-font-scale" as string]: String(fontScale),
    ["--app-log-font-size" as string]: `${Math.max(10, Math.min(16, Number(settings?.uiPrefs?.logFontSizePx ?? 12)))}px`,
    backgroundColor: themePreset.background,
  } as CSSProperties;
  const motionClass = `app-motion-${settings?.uiPrefs?.motionLevel ?? "full"}`;
  const borderClass = `app-border-${settings?.uiPrefs?.panelBorderContrast ?? "normal"}`;

  if (sleeping) {
    return <SleepWakeScreen logoMark={logoMark} t={t} onWake={onWakeFromSleep} />;
  }

  return (
    <div
      className={`relative isolate flex h-screen w-screen flex-col overflow-hidden ${motionClass} ${borderClass} ${backgroundUrl ? "wallpaper-enabled" : ""}`}
      style={appBackgroundStyle}
    >
      <div className="relative z-10 flex h-full w-full flex-col">
        <AppTopbar
          status={status}
          logoMark={logoMark}
          projects={projects}
          activeProjectId={activeProjectId}
          busy={busy}
          isTauriRuntime={isTauriRuntime}
          isMaximized={isMaximized}
          projectSearchQuery={projectSearchQuery}
          projectSearchBusy={projectSearchBusy}
          projectSearchSearched={projectSearchSearched}
          projectSearchResults={projectSearchResults}
          onProjectChange={handleProjectChange}
          onProjectSearchQueryChange={(nextQuery) => {
            setProjectSearchQuery(nextQuery);
            setProjectSearchSearched(false);
            setProjectSearchResults([]);
          }}
          onProjectSearch={handleProjectSearch}
          onProjectSearchSelect={handleProjectSearchSelect}
          onProjectSearchClear={() => {
            setProjectSearchQuery("");
            setProjectSearchResults([]);
            setProjectSearchSearched(false);
          }}
          onOpenFolder={handleInitProjectFromFolderWithGuard}
          onWindowControl={handleWindowControlWithGuard}
          t={t}
        />

        <AppErrorBoundary
          fallbackTitle={t("workspace.crashedTitle")}
          fallbackHint={t("workspace.crashedHint")}
          retryLabel={t("workspace.crashedRetry")}
          onRecover={recoverWorkspaceLayout}
        >
          {!startupReady ? (
            <section className="flex h-full min-h-0 items-center justify-center bg-[color:var(--editor-paper-bg)] text-sm text-[color:var(--editor-tab-muted)]">
              {t("common.loading")}
            </section>
          ) : (
            <Suspense
              fallback={
                <section className="flex h-full min-h-0 items-center justify-center bg-[color:var(--editor-paper-bg)] text-sm text-[color:var(--editor-tab-muted)]">
                  {t("common.loading")}
                </section>
              }
            >
              <AppWorkspaceShell
                page={page}
                pageRailItems={pageRailItems}
                activeProjectId={activeProjectId}
                busy={busy}
                shellLayout={shellLayout}
                latexLayout={latexLayout}
                latexTerminalLayout={latexTerminalLayout}
                analysisLayout={analysisLayout}
                libraryLayout={libraryLayout}
                libraryBibLayout={libraryBibLayout}
                previewDefaultZoom={settings?.uiPrefs?.previewDefaultZoom ?? 1}
                fontScale={fontScale}
                completionModelId={completionModelId}
                chatAgentModelId={chatAgentModelId}
                translationModelId={translationModelId}
                paperBriefEngine={paperBriefEngine}
                workspaceExplorerDefaultExpanded={workspaceExplorerDefaultExpanded}
                libraryExplorerDefaultExpanded={libraryExplorerDefaultExpanded}
                workspaceExplorerExpandedPaths={workspaceExplorerExpandedPaths}
                libraryExplorerExpandedPaths={libraryExplorerExpandedPaths}
                onWorkspaceExplorerExpandedPathsChange={(paths) =>
                  updateExplorerExpandedPaths("workspaceExplorerExpandedPathsByProject", paths)
                }
                onLibraryExplorerExpandedPathsChange={(paths) =>
                  updateExplorerExpandedPaths("libraryExplorerExpandedPathsByProject", paths)
                }
                tree={tree}
                libraryTree={libraryTree}
                selectedFile={selectedFile}
                selectedLibraryPath={selectedLibraryPath}
                fileList={fileList}
                editorContent={editorContent}
                editorTabs={editorTabs}
                activeTabId={activeTabId}
                dirtyByPath={dirtyByPath}
                compiledPdfUrl={pdfUrl}
                compiledPdfRelativePath={props.compiledPdfRelativePath}
                preferCompiledPreview={preferCompiledPreview}
                selectedFilePdfUrl={selectedFilePdfUrl}
                selectedImagePreviewUrl={selectedImagePreviewUrl}
                previewOverridePath={previewOverridePath}
                compileErrorLine={compileErrorLine}
                compileDiagnostics={compileDiagnostics}
                compileInstallProgress={compileInstallProgress}
                agentCollapsed={agentCollapsed}
                agentPhase={agentPhase}
                agentStatusKey={agentStatusKey}
                agentPrompt={agentPrompt}
                agentMessages={agentMessages}
                agentProposal={agentProposal}
                agentPendingAction={agentPendingAction}
                agentRunId={agentRunId}
                agentSessions={agentSessions}
                agentSessionPickerOpen={agentSessionPickerOpen}
                agentSessionPickerIndex={agentSessionPickerIndex}
                agentRollbackVisible={agentRollbackVisible}
                events={events}
                explorerGitDecorations={explorerGitDecorations}
                shellMin={SHELL_MIN}
                settingsPanel={settingsPanel}
                gitPanel={gitPanel}
                analysisPanel={analysisPanel}
                onPageChange={setPage}
                shareSession={shareSession}
                shareBusy={shareBusy}
                shareSyncing={shareSyncing}
                shareConflict={shareConflict}
                shareComments={shareComments}
                channelPrefs={settings?.uiPrefs?.channels ?? null}
                shareMode={shareMode}
                shareSessionName={shareSessionName}
                onShareModeChange={handleShareModeChange}
                onShareSessionNameChange={handleShareSessionNameChange}
                onShareStart={handleShareStart}
                onShareStop={handleShareStop}
                onShareRefresh={handleShareRefresh}
                onShareConflictResolve={handleShareConflictResolve}
                onSelectFile={handleSelectWorkspacePath}
                onSelectLibraryPath={setSelectedLibraryPath}
                onEditorChange={setEditorContent}
                onTabSelect={handleTabSelect}
                onTabClose={handleTabClose}
                onTabCloseAction={handleTabCloseAction}
                onTabPin={handleTabPin}
                onEditorMount={(editor, _monaco) => {
                  editorRef.current = editor;
                }}
                onChatReviewRequest={(prompt) => {
                  setAgentCollapsed(false);
                  void handleRunAgent(prompt, { forceNewSession: true });
                }}
                onAgentPromptChange={setAgentPrompt}
                onAgentToggle={() => setAgentCollapsed((prev: boolean) => !prev)}
                onAgentRun={handleRunAgent}
                onAgentSessionPickerOpenChange={setAgentSessionPickerOpen}
                onAgentSessionPickerIndexChange={setAgentSessionPickerIndex}
                onAgentSessionConfirm={handleAgentSessionConfirm}
                onAgentRollback={handleAgentRollback}
                onAgentAcceptProposal={(withAnalysis) => {
                  void handleAcceptAgentProposal(withAnalysis);
                }}
                onAgentRejectProposal={handleRejectAgentProposal}
                onAgentPendingActionResolve={handleResolveAgentPendingAction}
                onOpenFolder={handleInitProjectFromFolderWithGuard}
                onSaveFile={handleSaveActiveFile}
                onWriteSelectedFileContent={handleWriteSelectedFileContent}
                onCompile={handleCompile}
                onExportPdf={handleExportCompiledPdf}
                onEditorUndo={handleEditorUndo}
                onEditorRedo={handleEditorRedo}
                onOpenLogs={(tab) => {
                  setLogsTab(tab);
                  setOverlay("logs");
                }}
                onLibraryRescan={handleLibraryRescan}
                onLibraryImportPdf={handleLibraryImportPdf}
                onLibraryImportLink={handleLibraryImportLink}
                onLibrarySyncZotero={handleLibrarySyncZotero}
                onLibraryAnalyzePaper={handleLibraryAnalyzePaper}
                analysisRunning={analysisRunning}
                libraryViewMode={libraryViewMode}
                onLibraryViewModeChange={handleLibraryViewModeChange}
                onWorkspaceRevealInSystem={handleWorkspaceRevealInSystem}
                onWorkspaceOpenTerminal={handleWorkspaceOpenTerminal}
                onWorkspaceRescan={handleWorkspaceRescan}
                onSavePanelLayout={(panel, layout) => savePanelLayout(panel, layout)}
                onFsAction={(scope, action, path, targetPath, content) =>
                  requestFsAction(scope, action, path, targetPath, content)
                }
                onRunFsAction={(scope, action, path, targetPath, content) =>
                  runFsAction(scope, action, path, targetPath, content)
                }
                t={t}
                suspended={suspended}
              />
            </Suspense>
          )}
        </AppErrorBoundary>
      </div>

      <AppOverlays
        overlay={overlay}
        logsTab={logsTab}
        events={events}
        compileDiagnostics={compileDiagnostics}
        modelModalOpen={modelModalOpen}
        modelModalMode={modelModalMode}
        modelModalInitial={modelModalInitial}
        settings={settings}
        deleteIntent={deleteIntent}
        deleteDontAskAgain={deleteDontAskAgain}
        integrityIssue={integrityIssue}
        themeTransition={themeTransition}
        toast={toast}
        analysisEnvPrompt={analysisEnvPrompt}
        onOverlayClose={() => setOverlay(null)}
        onLogsTabChange={setLogsTab}
        onModelModalClose={() => {
          setModelModalOpen(false);
          setModelModalInitial(null);
          setModelModalMode("create");
        }}
        onModelSubmit={handleModelModalSubmit}
        onGetModelApiKey={handleGetModelApiKey}
        onDeleteCancel={() => setDeleteIntent(null)}
        onDeleteConfirm={confirmDelete}
        onDeleteDontAskChange={setDeleteDontAskAgain}
        onIntegrityCancel={handleIntegrityCancel}
        onIntegrityRepair={handleIntegrityRepair}
        closeBehaviorDialogOpen={closeBehaviorDialogOpen}
        closeBehaviorRemember={closeBehaviorRememberChoice}
        closeBehaviorDialogBusy={closeBehaviorDialogBusy}
        onCloseBehaviorRememberChange={setCloseBehaviorRememberChoice}
        onCloseBehaviorCancel={handleCloseBehaviorDialogCancel}
        onCloseBehaviorConfirm={handleCloseBehaviorDialogResolve}
        t={t}
      />

      <UnsavedChangesDialog
        open={unsavedDialogOpen}
        intent={unsavedDialogIntent}
        items={unsavedDialogItems}
        busy={unsavedDialogBusy}
        onSaveAndContinue={() => {
          void handleUnsavedDialogSaveAndContinue();
        }}
        onDiscardAndContinue={() => {
          void handleUnsavedDialogDiscardAndContinue();
        }}
        onCancel={handleUnsavedDialogCancel}
        t={t}
      />
    </div>
  );
}

