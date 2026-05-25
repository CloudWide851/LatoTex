import { useEffect, useRef } from "react";
import type { ShareSessionInfo } from "../../../shared/types/app";
import type { ShareEditAnnotation } from "../../hooks/shareEditAnnotations";
import { matchPath } from "../../hooks/shareSessionUtils";

type TranslationFn = (key: any) => string;

function toRange(model: any, annotation: ShareEditAnnotation) {
  const maxLength = model?.getValueLength?.() ?? 0;
  const start = Math.max(0, Math.min(annotation.start, maxLength));
  const end = Math.max(start, Math.min(annotation.end, maxLength));
  const startPosition = model.getPositionAt(start);
  const endPosition = model.getPositionAt(end);
  return {
    start,
    end,
    startPosition,
    endPosition,
    range: {
      startLineNumber: startPosition.lineNumber,
      startColumn: startPosition.column,
      endLineNumber: endPosition.lineNumber,
      endColumn: endPosition.column,
    },
  };
}

function compactName(value: string): string {
  const name = String(value || "").trim();
  if (name.length <= 16) {
    return name;
  }
  return `${name.slice(0, 15)}...`;
}

function colorClassName(annotation: ShareEditAnnotation): string {
  return `editor-share-edit-color-${String(annotation.id).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function syncColorStyle(annotations: ShareEditAnnotation[]) {
  if (typeof document === "undefined") {
    return () => undefined;
  }
  const styleId = "latotex-share-edit-colors";
  let style = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = styleId;
    document.head.appendChild(style);
  }
  style.textContent = annotations
    .map((item) => `.${colorClassName(item)}{--share-edit-color:${item.color};}`)
    .join("\n");
  return () => {
    if (style && style.textContent.trim().length === 0) {
      style.remove();
    }
  };
}

export function useWorkspaceEditorShareEditAnnotations(params: {
  editor: any | null;
  selectedFile: string | null;
  shareSession: ShareSessionInfo | null;
  annotations: ShareEditAnnotation[];
  t: TranslationFn;
}) {
  const { editor, selectedFile, shareSession, annotations, t } = params;
  const decorationIdsRef = useRef<string[]>([]);
  const widgetIdsRef = useRef<string[]>([]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    const model = editor.getModel?.();
    if (!model) {
      return;
    }

    const clearWidgets = () => {
      for (const id of widgetIdsRef.current) {
        editor.removeContentWidget({ getId: () => id });
      }
      widgetIdsRef.current = [];
    };
    const clearDecorations = () => {
      decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, []);
    };
    const clearAll = () => {
      clearWidgets();
      clearDecorations();
    };

    if (!shareSession?.active || !matchPath(selectedFile, shareSession.targetPath)) {
      clearAll();
      return clearAll;
    }

    const visible = annotations
      .filter((item) => matchPath(item.path, selectedFile))
      .slice(-12);
    clearWidgets();
    clearDecorations();
    syncColorStyle(visible);
    if (visible.length === 0) {
      return clearAll;
    }

    decorationIdsRef.current = editor.deltaDecorations(
      decorationIdsRef.current,
      visible.map((item) => {
        const rangeInfo = toRange(model, item);
        const lineRange = item.kind === "delete"
          ? {
              startLineNumber: rangeInfo.startPosition.lineNumber,
              startColumn: rangeInfo.startPosition.column,
              endLineNumber: rangeInfo.startPosition.lineNumber,
              endColumn: rangeInfo.startPosition.column,
            }
          : rangeInfo.range;
        return {
          range: lineRange,
          options: {
            className: `editor-share-edit-range ${colorClassName(item)}`,
            inlineClassName: item.kind === "delete" ? undefined : `editor-share-edit-range-inline ${colorClassName(item)}`,
            stickiness: 1,
            isWholeLine: false,
            afterContentClassName: item.kind === "delete"
              ? `editor-share-edit-delete-anchor ${colorClassName(item)}`
              : undefined,
          },
        };
      }),
    );

    for (const item of visible) {
      const rangeInfo = toRange(model, item);
      const node = document.createElement("span");
      node.className = "editor-share-edit-author-widget";
      node.textContent = compactName(item.username);
      node.title = `${t("share.editBy")} ${item.username}`;
      node.style.setProperty("--share-edit-color", item.color);
      const widget = {
        getId: () => `latotex-share-edit-${item.id}`,
        getDomNode: () => node,
        getPosition: () => ({
          position: item.kind === "delete" ? rangeInfo.startPosition : rangeInfo.endPosition,
          preference: [2, 1],
        }),
      };
      widgetIdsRef.current.push(widget.getId());
      editor.addContentWidget(widget);
      editor.layoutContentWidget(widget);
    }

    return clearAll;
  }, [annotations, editor, selectedFile, shareSession, t]);
}
