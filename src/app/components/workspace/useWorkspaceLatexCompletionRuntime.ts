import { useEffect } from "react";
import { configureLatexCompletionRuntime } from "../editor/latexCompletion";

export function useWorkspaceLatexCompletionRuntime(
  projectId: string | null,
  selectedFile: string | null,
  completionModelId: string | null,
  fileList: string[],
  selectedFileContent: string,
) {
  useEffect(() => {
    configureLatexCompletionRuntime(() => ({
      projectId,
      selectedFile,
      completionModelId,
      fileList,
      selectedFileContent,
    }));
  }, [completionModelId, fileList, projectId, selectedFile, selectedFileContent]);
}
