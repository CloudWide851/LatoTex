import MonacoEditor, { loader } from "@monaco-editor/react";
import * as monacoEditor from "monaco-editor/esm/vs/editor/editor.api.js";
import { useEffect, useRef, type MutableRefObject } from "react";
import { loadDeferredEditorLanguage, registerEditorCodeLanguages } from "./editorCodeLanguages";
import { registerEditorSurfaceThemes } from "./editorSurfaceTheme";
import { ensureLatexCompletionProvider } from "./latexCompletion";

loader.config({ monaco: monacoEditor });

export function toMonacoModelPath(
  projectId?: string | null,
  path?: string | null,
): string | undefined {
  const normalizedProjectId = String(projectId ?? "").trim();
  const normalizedPath = String(path ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  if (!normalizedProjectId || !normalizedPath) {
    return undefined;
  }
  const encodedProjectId = encodeURIComponent(normalizedProjectId);
  const encodedPath = normalizedPath
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return encodedPath
    ? `latotex://workspace/${encodedProjectId}/${encodedPath}`
    : undefined;
}

export function WorkspaceMonacoEditor(props: {
  projectId: string;
  path?: string;
  language: string;
  theme: string;
  value: string;
  options: any;
  editorInstanceRef: MutableRefObject<any | null>;
  onChange: (value: string) => void;
  onMount: (editor: any, monaco: any) => void;
}) {
  const {
    projectId,
    path,
    language,
    theme,
    value,
    options,
    editorInstanceRef,
    onChange,
    onMount,
  } = props;
  const restoreTextFocusRef = useRef(false);
  const activationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    const rememberTextFocus = () => {
      const editor = editorInstanceRef.current;
      restoreTextFocusRef.current = restoreTextFocusRef.current
        || Boolean(editor?.hasTextFocus?.());
    };
    const refreshAfterActivation = () => {
      if (document.visibilityState === "hidden" || activationFrameRef.current !== null) {
        return;
      }
      activationFrameRef.current = window.requestAnimationFrame(() => {
        activationFrameRef.current = null;
        const editor = editorInstanceRef.current;
        if (!editor) {
          restoreTextFocusRef.current = false;
          return;
        }
        editor.layout?.();
        editor.render?.(true);
        if (restoreTextFocusRef.current) {
          editor.focus?.();
        }
        restoreTextFocusRef.current = false;
      });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        rememberTextFocus();
        return;
      }
      refreshAfterActivation();
    };

    window.addEventListener("blur", rememberTextFocus);
    window.addEventListener("focus", refreshAfterActivation);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("blur", rememberTextFocus);
      window.removeEventListener("focus", refreshAfterActivation);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (activationFrameRef.current !== null) {
        window.cancelAnimationFrame(activationFrameRef.current);
        activationFrameRef.current = null;
      }
    };
  }, [editorInstanceRef]);

  void loadDeferredEditorLanguage(language);

  return (
    <MonacoEditor
      path={toMonacoModelPath(projectId, path)}
      language={language}
      theme={theme}
      value={value}
      saveViewState
      loading={null}
      beforeMount={(monaco) => {
        registerEditorSurfaceThemes(monaco);
        registerEditorCodeLanguages(monaco);
        void loadDeferredEditorLanguage(language);
      }}
      onChange={(nextValue) => onChange(nextValue ?? "")}
      onMount={(editor, monaco) => {
        editorInstanceRef.current = editor;
        let overflowRefreshFrame: number | null = null;
        const refreshOverflowWidgets = () => {
          if (overflowRefreshFrame != null || typeof window === "undefined") {
            return;
          }
          overflowRefreshFrame = window.requestAnimationFrame(() => {
            overflowRefreshFrame = null;
            editor.render?.(true);
          });
        };
        ensureLatexCompletionProvider(monaco);
        editor.addCommand(
          monaco.KeyCode.Tab,
          () => editor.trigger("keyboard", "acceptSelectedSuggestion", {}),
          "suggestWidgetVisible",
        );
        editor.addCommand(
          monaco.KeyCode.Tab,
          () => editor.trigger("keyboard", "acceptInlineSuggestion", {}),
          "inlineSuggestionVisible",
        );
        editor.updateOptions(options);
        editor.layout();
        const disposables = [
          editor.onDidChangeCursorPosition(refreshOverflowWidgets),
          editor.onDidScrollChange(refreshOverflowWidgets),
          editor.onDidLayoutChange(refreshOverflowWidgets),
        ];
        editor.onDidDispose(() => {
          if (overflowRefreshFrame != null && typeof window !== "undefined") {
            window.cancelAnimationFrame(overflowRefreshFrame);
          }
          disposables.forEach((disposable: any) => disposable.dispose());
          if (editorInstanceRef.current === editor) {
            editorInstanceRef.current = null;
          }
        });
        onMount(editor, monaco);
      }}
      options={options}
    />
  );
}
