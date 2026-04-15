import { useEffect, useRef } from "react";
import type { ShareCommentItem, ShareSessionInfo } from "../../../shared/types/app";
import { matchPath } from "../../hooks/shareSessionUtils";
import { postShareComment } from "../workspace/shareCommentApi";

type TranslationFn = (key: any) => string;

type SelectionSnapshot = {
  start: number;
  end: number;
  quote: string;
  lineNumber: number;
  column: number;
};

type NormalizedEditorComment = ShareCommentItem & {
  start: number;
  end: number;
  startLine: number;
  endLine: number;
};

const COMMENT_ZONE_BASE_HEIGHT = 96;
const COMMENT_ZONE_QUOTE_HEIGHT = 28;
const COMMENT_ZONE_MAX = 14;

function escapeHtml(value: string): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function trimQuote(input: string, max = 220): string {
  const normalized = input.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max)}...`;
}

function toNormalizedComment(model: any, item: ShareCommentItem): NormalizedEditorComment | null {
  const start = Number(item.start);
  const end = Number(item.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < 0) {
    return null;
  }
  const maxLength = model?.getValueLength?.() ?? 0;
  if (start >= maxLength || end > maxLength) {
    return null;
  }
  const startPos = model.getPositionAt(start);
  const endPos = model.getPositionAt(end);
  return {
    ...item,
    start,
    end,
    startLine: startPos.lineNumber,
    endLine: endPos.lineNumber,
  };
}

function readSelectionSnapshot(editor: any): SelectionSnapshot | null {
  const model = editor?.getModel?.();
  const selection = editor?.getSelection?.();
  if (!model || !selection || selection.isEmpty?.()) {
    return null;
  }
  const start = model.getOffsetAt(selection.getStartPosition());
  const end = model.getOffsetAt(selection.getEndPosition());
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }
  const rawQuote = model.getValueInRange(selection);
  const quote = trimQuote(String(rawQuote ?? ""));
  if (!quote) {
    return null;
  }
  const endPosition = selection.getEndPosition();
  return {
    start,
    end,
    quote,
    lineNumber: endPosition.lineNumber,
    column: endPosition.column,
  };
}

export function useWorkspaceEditorShareComments(params: {
  editor: any | null;
  selectedFile: string | null;
  shareSession: ShareSessionInfo | null;
  shareComments: ShareCommentItem[];
  t: TranslationFn;
}) {
  const { editor, selectedFile, shareSession, shareComments, t } = params;
  const decorationIdsRef = useRef<string[]>([]);
  const commentZoneIdsRef = useRef<string[]>([]);
  const composerZoneIdsRef = useRef<string[]>([]);
  const triggerWidgetRef = useRef<any | null>(null);
  const selectionRef = useRef<SelectionSnapshot | null>(null);
  const shareCommentsRef = useRef<ShareCommentItem[]>(shareComments);
  const optimisticCommentsRef = useRef<ShareCommentItem[]>([]);

  shareCommentsRef.current = shareComments;

  const canRenderInlineComments = Boolean(
    editor
      && shareSession?.active
      && matchPath(selectedFile, shareSession?.targetPath),
  );

  useEffect(() => {
    if (!shareSession?.active) {
      optimisticCommentsRef.current = [];
    }
  }, [shareSession?.active]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    const model = editor.getModel?.();
    if (!model) {
      return;
    }

    const clearDecorations = () => {
      decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, []);
    };

    const clearZones = (zoneIds: { current: string[] }) => {
      if (zoneIds.current.length === 0) {
        return;
      }
      editor.changeViewZones((accessor: any) => {
        for (const id of zoneIds.current) {
          accessor.removeZone(id);
        }
      });
      zoneIds.current = [];
    };

    const clearTriggerWidget = () => {
      if (triggerWidgetRef.current) {
        editor.removeContentWidget(triggerWidgetRef.current);
        triggerWidgetRef.current = null;
      }
    };

    const getMergedComments = () => {
      const actualComments = shareCommentsRef.current;
      const actualIds = new Set(actualComments.map((item) => item.id));
      const optimisticComments = optimisticCommentsRef.current.filter((item) => !actualIds.has(item.id));
      return [...actualComments, ...optimisticComments];
    };

    const focusCommentRange = (comment: NormalizedEditorComment) => {
      const currentModel = editor.getModel?.();
      if (!currentModel) {
        return;
      }
      const startPosition = currentModel.getPositionAt(comment.start);
      const endPosition = currentModel.getPositionAt(comment.end);
      editor.focus();
      editor.setSelection({
        startLineNumber: startPosition.lineNumber,
        startColumn: startPosition.column,
        endLineNumber: endPosition.lineNumber,
        endColumn: endPosition.column,
      });
      editor.revealRangeInCenter({
        startLineNumber: startPosition.lineNumber,
        startColumn: startPosition.column,
        endLineNumber: endPosition.lineNumber,
        endColumn: endPosition.column,
      });
    };

    const renderCommentZones = () => {
      clearDecorations();
      clearZones(commentZoneIdsRef);
      if (!canRenderInlineComments) {
        return;
      }
      const normalizedComments = getMergedComments()
        .filter((item) => item.source !== "pdf")
        .map((item) => toNormalizedComment(model, item))
        .filter((item): item is NormalizedEditorComment => Boolean(item))
        .slice(-COMMENT_ZONE_MAX);

      if (normalizedComments.length === 0) {
        return;
      }

      decorationIdsRef.current = editor.deltaDecorations(
        decorationIdsRef.current,
        normalizedComments.map((item) => ({
          range: {
            startLineNumber: item.startLine,
            startColumn: model.getPositionAt(item.start).column,
            endLineNumber: item.endLine,
            endColumn: model.getPositionAt(item.end).column,
          },
          options: {
            className: "editor-share-comment-range",
            inlineClassName: "editor-share-comment-range-inline",
            stickiness: 1,
          },
        })),
      );

      editor.changeViewZones((accessor: any) => {
        commentZoneIdsRef.current = normalizedComments.map((item) => {
          const node = document.createElement("div");
          node.className = "editor-share-comment-zone";
          node.innerHTML = `
            <button type="button" class="editor-share-comment-card" title="${t("share.commentReveal")}">
              <div class="editor-share-comment-card__header">
                <span class="editor-share-comment-card__author">${escapeHtml(item.username)}</span>
                <span class="editor-share-comment-card__badge">${t("share.commentsInline")}</span>
              </div>
              ${item.quote ? `<div class="editor-share-comment-card__quote">${escapeHtml(item.quote)}</div>` : ""}
              <div class="editor-share-comment-card__text">${escapeHtml(item.text || item.quote || "")}</div>
            </button>
          `;
          const button = node.querySelector("button");
          button?.addEventListener("click", () => focusCommentRange(item));
          return accessor.addZone({
            afterLineNumber: item.endLine,
            heightInPx: COMMENT_ZONE_BASE_HEIGHT + (item.quote ? COMMENT_ZONE_QUOTE_HEIGHT : 0),
            domNode: node,
          });
        });
      });
    };

    const closeComposer = () => {
      clearZones(composerZoneIdsRef);
      renderTriggerWidget();
      editor.focus();
    };

    const submitSelectionComment = async (draftText: string) => {
      const selection = selectionRef.current;
      if (!selection || !shareSession) {
        return;
      }
      const item = await postShareComment(shareSession, {
        username: t("share.desktopUser"),
        text: draftText,
        quote: selection.quote,
        source: "tex",
        start: selection.start,
        end: selection.end,
      });
      optimisticCommentsRef.current = [...optimisticCommentsRef.current, item].slice(-COMMENT_ZONE_MAX);
      closeComposer();
      renderCommentZones();
    };

    const openComposer = () => {
      const selection = selectionRef.current;
      if (!selection || !canRenderInlineComments) {
        return;
      }
      clearTriggerWidget();
      clearZones(composerZoneIdsRef);
      editor.changeViewZones((accessor: any) => {
        const node = document.createElement("div");
        node.className = "editor-share-comment-zone";
        node.innerHTML = `
          <div class="editor-share-composer-card">
            <div class="editor-share-composer-card__quote">${escapeHtml(selection.quote)}</div>
            <textarea class="editor-share-composer-card__input" placeholder="${t("share.commentPlaceholder")}"></textarea>
            <div class="editor-share-composer-card__actions">
              <button type="button" class="editor-share-composer-card__submit">${t("share.postComment")}</button>
              <button type="button" class="editor-share-composer-card__cancel">${t("common.cancel")}</button>
            </div>
          </div>
        `;
        const textarea = node.querySelector("textarea") as HTMLTextAreaElement | null;
        const submitButton = node.querySelector(".editor-share-composer-card__submit");
        const cancelButton = node.querySelector(".editor-share-composer-card__cancel");
        submitButton?.addEventListener("click", async () => {
          const nextText = textarea?.value?.trim() ?? "";
          if (!nextText) {
            textarea?.focus();
            return;
          }
          try {
            await submitSelectionComment(nextText);
          } catch {
            textarea?.focus();
          }
        });
        cancelButton?.addEventListener("click", closeComposer);
        composerZoneIdsRef.current = [
          accessor.addZone({
            afterLineNumber: selection.lineNumber,
            heightInPx: 156,
            domNode: node,
          }),
        ];
        window.requestAnimationFrame(() => textarea?.focus());
      });
    };

    const renderTriggerWidget = () => {
      clearTriggerWidget();
      if (!canRenderInlineComments) {
        return;
      }
      const selection = selectionRef.current;
      if (!selection) {
        return;
      }
      const widget = {
        getId: () => "latotex-share-comment-trigger",
        getDomNode: () => {
          if (!widget.domNode) {
            const node = document.createElement("button");
            node.type = "button";
            node.className = "editor-share-comment-trigger";
            node.textContent = t("share.addInlineComment");
            node.addEventListener("click", openComposer);
            widget.domNode = node;
          }
          return widget.domNode;
        },
        getPosition: () => ({
          position: {
            lineNumber: selection.lineNumber,
            column: selection.column,
          },
          preference: [2, 1],
        }),
        domNode: null as HTMLButtonElement | null,
      };
      triggerWidgetRef.current = widget;
      editor.addContentWidget(widget);
      editor.layoutContentWidget(widget);
    };

    const handleSelectionChange = () => {
      selectionRef.current = canRenderInlineComments ? readSelectionSnapshot(editor) : null;
      renderTriggerWidget();
    };

    renderCommentZones();
    handleSelectionChange();

    const selectionDisposable = editor.onDidChangeCursorSelection(handleSelectionChange);
    const modelDisposable = editor.onDidChangeModelContent(() => {
      renderCommentZones();
      handleSelectionChange();
    });

    return () => {
      selectionDisposable?.dispose?.();
      modelDisposable?.dispose?.();
      clearTriggerWidget();
      clearZones(commentZoneIdsRef);
      clearZones(composerZoneIdsRef);
      clearDecorations();
    };
  }, [canRenderInlineComments, editor, selectedFile, shareComments, shareSession, t]);
}
