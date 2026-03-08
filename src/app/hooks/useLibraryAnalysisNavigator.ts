import { useCallback } from "react";

export function useLibraryAnalysisNavigator(params: {
  setPage: (value: "latex" | "analysis" | "library" | "git" | "settings") => void;
  runPaperAnalysisFromLibrary: (path: string) => Promise<void>;
  analysisRunning: boolean;
}) {
  const { setPage, runPaperAnalysisFromLibrary, analysisRunning } = params;
  return useCallback(
    async (path: string) => {
      if (analysisRunning) {
        return;
      }
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
    [analysisRunning, runPaperAnalysisFromLibrary, setPage],
  );
}
