import { useEffect, useMemo, useState, type RefObject } from "react";
import type { ShareComment } from "./shareTypes";

type InlineCommentCard = {
  id: string;
  top: number;
  height: number;
  cardTop: number;
  comment: ShareComment;
};

function offsetToLine(text: string, offset: number): number {
  const end = Math.max(0, Math.min(text.length, Number(offset) || 0));
  let line = 1;
  for (let index = 0; index < end; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
    }
  }
  return line;
}

export function useShareEditorReview(params: {
  textareaRef: RefObject<HTMLTextAreaElement>;
  comments: ShareComment[];
}) {
  const { textareaRef, comments } = params;
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    const refresh = () => setVersion((current) => current + 1);
    textarea.addEventListener("scroll", refresh, { passive: true });
    window.addEventListener("resize", refresh);
    return () => {
      textarea.removeEventListener("scroll", refresh);
      window.removeEventListener("resize", refresh);
    };
  }, [textareaRef]);

  return useMemo(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return [] as InlineCommentCard[];
    }
    void version;
    const style = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(style.lineHeight || "") || 24;
    const paddingTop = Number.parseFloat(style.paddingTop || "") || 0;
    const viewportHeight = textarea.clientHeight;
    let lastCardBottom = -Infinity;
    const texComments = comments
      .filter((item) =>
        item.source === "tex"
          && Number.isFinite(item.start)
          && Number.isFinite(item.end)
          && (item.end ?? 0) > (item.start ?? 0),
      )
      .sort((left, right) => (left.start ?? 0) - (right.start ?? 0))
      .slice(-12);
    return texComments.flatMap((comment) => {
      const startLine = offsetToLine(textarea.value || "", comment.start ?? 0);
      const endLine = offsetToLine(textarea.value || "", Math.max(comment.start ?? 0, (comment.end ?? 1) - 1));
      const top = paddingTop + (startLine - 1) * lineHeight - textarea.scrollTop;
      const height = Math.max(lineHeight, (endLine - startLine + 1) * lineHeight);
      if (top + height < -24 || top > viewportHeight + 96) {
        return [];
      }
      const cardTop = Math.max(top, lastCardBottom + 12);
      lastCardBottom = cardTop + 88;
      return [{
        id: comment.id,
        top,
        height,
        cardTop,
        comment,
      }];
    });
  }, [comments, textareaRef, version]);
}
