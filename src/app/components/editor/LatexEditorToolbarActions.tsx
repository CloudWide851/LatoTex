import { PenTool, Play, Redo2, Save, Terminal, Undo2 } from "lucide-react";
import type { MessageKey } from "../../../i18n/messages/en-US/index";
import { isTexPath } from "../../../shared/utils/fileKind";
import { composeTitleWithShortcut } from "../workspace/workspaceShellUtils";
import { CompileAssistPopover } from "./CompileAssistPopover";
import { ScientificEditorRunControl } from "./ScientificEditorRunControl";

type TranslationFn = (key: MessageKey) => string;

export function LatexEditorToolbarActions(props: {
  activeProjectId: string | null;
  busy: boolean;
  selectedFile: string | null;
  selectedIsDraw: boolean;
  selectedFileWriteLocked: boolean;
  editorContent: string;
  scientificPluginIds: string[];
  terminalVisible: boolean;
  showCompileAssist: boolean;
  compileAssistDiagnostics: string[];
  compileAssistHint: string;
  compileAssistAutoFixBusy: boolean;
  getSelectedCode: () => string;
  onEditorUndo: () => void;
  onEditorRedo: () => void;
  onSaveFile: () => void;
  onTerminalToggle: () => void;
  onOpenDraw: () => void;
  onCompileClick: () => void;
  onCompileAssistDismiss: () => void;
  onCompileAssistAutoFix: () => void;
  t: TranslationFn;
}) {
  const {
    activeProjectId,
    busy,
    selectedFile,
    selectedIsDraw,
    selectedFileWriteLocked,
    editorContent,
    scientificPluginIds,
    terminalVisible,
    showCompileAssist,
    compileAssistDiagnostics,
    compileAssistHint,
    compileAssistAutoFixBusy,
    getSelectedCode,
    onEditorUndo,
    onEditorRedo,
    onSaveFile,
    onTerminalToggle,
    onOpenDraw,
    onCompileClick,
    onCompileAssistDismiss,
    onCompileAssistAutoFix,
    t,
  } = props;
  const editorWriteDisabled = busy || selectedFileWriteLocked;

  return (
    <div className="editor-toolbar-action-group flex min-w-max items-center justify-end gap-2">
      <ScientificEditorRunControl
        projectId={activeProjectId ?? ""}
        selectedFile={selectedFile}
        editorContent={editorContent}
        enabledPluginIds={scientificPluginIds}
        getSelectedCode={getSelectedCode}
        t={t}
      />
      <button
        className="panel-topbar-btn editor-toolbar-btn motion-hover-rise disabled:opacity-50"
        onClick={onEditorUndo}
        disabled={editorWriteDisabled}
        title={composeTitleWithShortcut(t("workspace.undo"), t("shortcut.undo"))}
        aria-label={composeTitleWithShortcut(t("workspace.undo"), t("shortcut.undo"))}
      >
        <Undo2 className="h-4 w-4" />
      </button>
      <button
        className="panel-topbar-btn editor-toolbar-btn motion-hover-rise disabled:opacity-50"
        onClick={onEditorRedo}
        disabled={editorWriteDisabled}
        title={composeTitleWithShortcut(t("workspace.redo"), t("shortcut.redo"))}
        aria-label={composeTitleWithShortcut(t("workspace.redo"), t("shortcut.redo"))}
      >
        <Redo2 className="h-4 w-4" />
      </button>
      <button
        className="panel-topbar-btn editor-toolbar-btn motion-hover-rise disabled:opacity-50"
        onClick={onSaveFile}
        disabled={editorWriteDisabled}
        title={composeTitleWithShortcut(t("workspace.save"), t("shortcut.save"))}
        aria-label={composeTitleWithShortcut(t("workspace.save"), t("shortcut.save"))}
      >
        <Save className="h-4 w-4" />
      </button>
      <button
        className={`panel-topbar-btn editor-toolbar-btn motion-hover-rise disabled:opacity-50 ${terminalVisible ? "editor-tab--active" : ""}`}
        onClick={onTerminalToggle}
        disabled={busy}
        title={t("terminal.title")}
        aria-label={t("terminal.title")}
      >
        <Terminal className="h-4 w-4" />
      </button>
      <div className="relative">
        {selectedIsDraw ? (
          <button
            className="panel-topbar-btn editor-toolbar-btn motion-hover-rise disabled:opacity-50"
            onClick={onOpenDraw}
            disabled={busy}
            title={t("workspace.openDrawPage")}
            aria-label={t("workspace.openDrawPage")}
          >
            <PenTool className="h-4 w-4" />
          </button>
        ) : null}
        <button
          className="panel-topbar-btn editor-toolbar-btn editor-toolbar-btn--primary motion-hover-rise disabled:opacity-50"
          onClick={onCompileClick}
          disabled={busy || !isTexPath(selectedFile)}
          title={composeTitleWithShortcut(t("workspace.compile"), t("shortcut.compile"))}
          aria-label={composeTitleWithShortcut(t("workspace.compile"), t("shortcut.compile"))}
        >
          <Play className="h-4 w-4" />
        </button>
        <CompileAssistPopover
          visible={showCompileAssist}
          diagnostics={compileAssistDiagnostics}
          hint={compileAssistHint}
          onDismiss={onCompileAssistDismiss}
          onAutoFix={() => {
            void onCompileAssistAutoFix();
          }}
          autoFixDisabled={busy || compileAssistAutoFixBusy}
          t={t}
        />
      </div>
    </div>
  );
}
