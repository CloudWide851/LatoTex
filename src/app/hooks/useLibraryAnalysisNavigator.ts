import { useCallback } from "react";

export function useLibraryAnalysisNavigator(params: {
  setPage: (value: "latex" | "analysis" | "library" | "git" | "settings") => void;
  runPaperAnalysisFromLibrary: (path: string) => Promise<void>;
}) {
  const { setPage, runPaperAnalysisFromLibrary } = params;
  return useCallback(
    async (path: string) => {
      setPage("analysis");
      await new Promise<void>((resolve) => {
        if (typeof window === "undefined") {
          resolve();
          return;
        }
        window.requestAnimationFrame(() => resolve());
      });
      await runPaperAnalysisFromLibrary(path);
    },
    [runPaperAnalysisFromLibrary, setPage],
  );
}
