export type AnalysisContextItem = {
  path: string;
  kind: "text" | "pdf";
  content: string;
  originalChars: number;
  truncated: boolean;
  pageCount?: number | null;
  ocrPageCount?: number | null;
  extractionEngine?: string | null;
  extractionMode?: string | null;
};

export type AnalysisContextIssue = {
  path: string;
  code: string;
};

export type AnalysisContextLoadResponse = {
  items: AnalysisContextItem[];
  issues: AnalysisContextIssue[];
};
