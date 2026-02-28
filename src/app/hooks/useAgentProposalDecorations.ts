import { useCallback, useEffect, useRef } from "react";
import type { AgentFileProposal } from "./agentTypes";

export function useAgentProposalDecorations(params: {
  editorRef: React.MutableRefObject<any>;
  selectedFile: string | null;
  activeProposal: AgentFileProposal | null;
}) {
  const { editorRef, selectedFile, activeProposal } = params;
  const decorationIdsRef = useRef<string[]>([]);

  const clearDecorations = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) {
      decorationIdsRef.current = [];
      return;
    }
    if (decorationIdsRef.current.length === 0) {
      return;
    }
    decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, []);
  }, [editorRef]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !selectedFile || !activeProposal?.previewApplied) {
      clearDecorations();
      return;
    }
    if (activeProposal.targetPath !== selectedFile) {
      clearDecorations();
      return;
    }
    const model = editor.getModel?.();
    if (!model) {
      clearDecorations();
      return;
    }
    const modelLineCount = Math.max(1, Number(model.getLineCount?.() ?? 1));
    const blocks = activeProposal.diffBlocks ?? [];
    if (blocks.length === 0) {
      clearDecorations();
      return;
    }
    const decorations = blocks.map((block) => {
      const start = Math.max(1, Math.min(modelLineCount, block.lineStart));
      const end = Math.max(start, Math.min(modelLineCount, block.lineEnd));
      const className =
        block.kind === "add"
          ? "agent-proposal-line-add"
          : block.kind === "delete"
            ? "agent-proposal-line-delete"
            : "agent-proposal-line-modify";
      const linesDecorationsClassName =
        block.kind === "add"
          ? "agent-proposal-gutter-add"
          : block.kind === "delete"
            ? "agent-proposal-gutter-delete"
            : "agent-proposal-gutter-modify";
      return {
        range: {
          startLineNumber: start,
          startColumn: 1,
          endLineNumber: end,
          endColumn: 1,
        },
        options: {
          isWholeLine: true,
          className,
          linesDecorationsClassName,
        },
      };
    });
    decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, decorations);
    return () => {
      clearDecorations();
    };
  }, [activeProposal, clearDecorations, editorRef, selectedFile]);
}
