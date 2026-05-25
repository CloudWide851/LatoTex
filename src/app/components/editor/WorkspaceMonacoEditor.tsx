import MonacoEditor, { loader } from "@monaco-editor/react";
import * as monacoEditor from "monaco-editor/esm/vs/editor/editor.api.js";
import type { MutableRefObject } from "react";
import { registerEditorCodeLanguages } from "./editorCodeLanguages";
import { registerEditorSurfaceThemes } from "./editorSurfaceTheme";
import { ensureLatexCompletionProvider } from "./latexCompletion";

loader.config({ monaco: monacoEditor });

export function WorkspaceMonacoEditor(props: {
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
    path,
    language,
    theme,
    value,
    options,
    editorInstanceRef,
    onChange,
    onMount,
  } = props;

  return (
    <MonacoEditor
      path={path}
      language={language}
      theme={theme}
      value={value}
      saveViewState
      loading={null}
      beforeMount={(monaco) => {
        registerEditorSurfaceThemes(monaco);
        registerEditorCodeLanguages(monaco);
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
