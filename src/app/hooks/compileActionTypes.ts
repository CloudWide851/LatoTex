export type CompileActionResult = {
  status: string;
  diagnostics: string[];
  pdfRelativePath: string | null;
  pdfUrl: string | null;
};
