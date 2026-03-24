import type { SwarmEvent } from "../../shared/types/app";

export type TranslationFn = (key: any) => string;

export type UseAnalysisWorkspaceParams = {
  projectId: string | null;
  selectedFile: string | null;
  editorContent: string;
  fileList: string[];
  locale: "zh-CN" | "en-US";
  analysisModelOverride?: string | null;
  suspended?: boolean;
  events: SwarmEvent[];
  t: TranslationFn;
  setToast: (value: { type: "info" | "error"; message: string } | null) => void;
};
