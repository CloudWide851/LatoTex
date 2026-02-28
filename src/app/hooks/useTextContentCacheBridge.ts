import { useCallback } from "react";
import { isPdfPath } from "../../shared/utils/fileKind";

export function useTextContentCacheBridge(params: {
  workingContentByPathRef: React.MutableRefObject<Record<string, string>>;
  savedContentByPathRef: React.MutableRefObject<Record<string, string>>;
  dirtyByPathRef: React.MutableRefObject<Record<string, boolean>>;
}) {
  const { workingContentByPathRef, savedContentByPathRef, dirtyByPathRef } = params;

  const getCachedTextContent = useCallback(
    (relativePath: string) => {
      if (isPdfPath(relativePath)) {
        return null;
      }
      const cached = workingContentByPathRef.current[relativePath];
      return typeof cached === "string" ? cached : null;
    },
    [workingContentByPathRef],
  );

  const handleTextFileLoaded = useCallback(
    (relativePath: string, content: string) => {
      savedContentByPathRef.current[relativePath] = content;
      if (!dirtyByPathRef.current[relativePath]) {
        workingContentByPathRef.current[relativePath] = content;
      }
    },
    [dirtyByPathRef, savedContentByPathRef, workingContentByPathRef],
  );

  return {
    getCachedTextContent,
    handleTextFileLoaded,
  };
}
