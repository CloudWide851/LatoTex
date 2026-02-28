import { pdfjs } from "react-pdf";

let configured = false;

export function ensureReactPdfWorker(): void {
  if (configured) {
    return;
  }
  const workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  if (pdfjs.GlobalWorkerOptions.workerSrc !== workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  }
  configured = true;
}
