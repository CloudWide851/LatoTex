import type { KnowledgeDocumentFocusRequest } from "../../../shared/types/app";

export type LibraryDocumentViewMode = "bib" | "pdf" | "compare";

export type LibraryDocumentViewerProps = {
  projectId: string | null;
  selectedPath: string | null;
  active: boolean;
  focusRequest?: KnowledgeDocumentFocusRequest | null;
  onAnalyzePaper: (path: string) => void;
  analysisRunning: boolean;
  persistedViewMode?: LibraryDocumentViewMode | null;
  onPersistViewMode?: (mode: LibraryDocumentViewMode) => void;
  translationModelId?: string | null;
  paperBriefEngine: "auto" | "pdfjs" | "python";
  bibLayout?: number[];
  onBibLayoutChange?: (layout: number[]) => void;
  t: (key: any) => string;
};
