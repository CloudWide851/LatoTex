import { useCallback, useRef } from "react";
import { isPdfPath } from "../../shared/utils/fileKind";

const TEXT_CACHE_MAX_FILES = 140;
const TEXT_CACHE_MAX_TOTAL_CHARS = 4_000_000;

export function useTextContentCacheBridge(params: {
  workingContentByPathRef: React.MutableRefObject<Record<string, string>>;
  savedContentByPathRef: React.MutableRefObject<Record<string, string>>;
  dirtyByPathRef: React.MutableRefObject<Record<string, boolean>>;
}) {
  const { workingContentByPathRef, savedContentByPathRef, dirtyByPathRef } = params;
  const accessOrderRef = useRef(new Map<string, number>());

  const pruneCacheIfNeeded = useCallback(() => {
    const working = workingContentByPathRef.current;
    const order = accessOrderRef.current;
    const keys = Object.keys(working);
    let totalChars = 0;
    for (const key of keys) {
      const text = working[key];
      if (typeof text === "string") {
        totalChars += text.length;
      }
    }
    if (keys.length <= TEXT_CACHE_MAX_FILES && totalChars <= TEXT_CACHE_MAX_TOTAL_CHARS) {
      return;
    }
    const sorted = keys
      .map((path) => ({ path, ts: order.get(path) ?? 0 }))
      .sort((left, right) => left.ts - right.ts);
    for (const entry of sorted) {
      if (
        Object.keys(working).length <= TEXT_CACHE_MAX_FILES
        && totalChars <= TEXT_CACHE_MAX_TOTAL_CHARS
      ) {
        break;
      }
      const removed = working[entry.path];
      delete working[entry.path];
      delete savedContentByPathRef.current[entry.path];
      delete dirtyByPathRef.current[entry.path];
      order.delete(entry.path);
      if (typeof removed === "string") {
        totalChars = Math.max(0, totalChars - removed.length);
      }
    }
  }, [dirtyByPathRef, savedContentByPathRef, workingContentByPathRef]);

  const getCachedTextContent = useCallback(
    (relativePath: string) => {
      if (isPdfPath(relativePath)) {
        return null;
      }
      const isDirty = Boolean(dirtyByPathRef.current[relativePath]);
      const saved = savedContentByPathRef.current[relativePath];
      if (!isDirty && typeof saved !== "string") {
        return null;
      }
      const cached = workingContentByPathRef.current[relativePath];
      if (typeof cached === "string") {
        accessOrderRef.current.set(relativePath, Date.now());
      }
      return typeof cached === "string" ? cached : null;
    },
    [dirtyByPathRef, savedContentByPathRef, workingContentByPathRef],
  );

  const handleTextFileLoaded = useCallback(
    (relativePath: string, content: string) => {
      savedContentByPathRef.current[relativePath] = content;
      if (!dirtyByPathRef.current[relativePath]) {
        workingContentByPathRef.current[relativePath] = content;
      }
      accessOrderRef.current.set(relativePath, Date.now());
      pruneCacheIfNeeded();
    },
    [dirtyByPathRef, pruneCacheIfNeeded, savedContentByPathRef, workingContentByPathRef],
  );

  return {
    getCachedTextContent,
    handleTextFileLoaded,
  };
}
