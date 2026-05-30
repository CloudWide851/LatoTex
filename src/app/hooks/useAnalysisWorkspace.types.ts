import type { SwarmEvent } from "../../shared/types/app";
import type { Locale } from "../../i18n";

export type TranslationFn = (key: any) => string;

export type UseAnalysisWorkspaceParams = {
  projectId: string | null;
  selectedFile: string | null;
  editorContent: string;
  fileList: string[];
  locale: Locale;
  analysisModelOverride?: string | null;
  suspended?: boolean;
  events: SwarmEvent[];
  t: TranslationFn;
  setToast: (value: { type: "info" | "error"; message: string } | null) => void;
};
