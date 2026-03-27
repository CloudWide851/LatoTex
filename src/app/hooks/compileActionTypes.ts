export type CompileActionResult = {
  status: string;
  diagnostics: string[];
  pdfBytes: Uint8Array | null;
};
