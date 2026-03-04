import { Workbook } from "exceljs";
import Papa from "papaparse";
import { pdfjs } from "react-pdf";
import {
  libraryCitationSummary,
  libraryResolvePdfPreview,
  readFile,
  readFileBinary,
} from "../../shared/api/desktop";
import { ensureReactPdfWorker } from "../components/pdf/reactPdfSetup";

export type AnalysisSourceSnapshot = {
  path: string;
  kind: "csv" | "excel" | "json" | "text" | "paper";
  summary: string;
  excerpt: string;
  rows?: number;
  columns?: number;
  numericSeries?: { label: string; value: number }[];
};

const DATA_EXTENSIONS = new Set([
  "csv",
  "tsv",
  "xlsx",
  "xlsm",
  "json",
  "jsonl",
  "txt",
  "md",
  "tex",
]);

function ext(path: string): string {
  const idx = path.lastIndexOf(".");
  if (idx < 0) {
    return "";
  }
  return path.slice(idx + 1).toLowerCase();
}

export function isCandidateDataFile(path: string): boolean {
  return DATA_EXTENSIONS.has(ext(path));
}

export function listCandidateDataFiles(paths: string[]): string[] {
  return paths.filter((path) => isCandidateDataFile(path)).sort((a, b) => a.localeCompare(b));
}

function toSeriesFromRows(rows: string[][]): { label: string; value: number }[] {
  if (rows.length < 2) {
    return [];
  }
  const headers = rows[0] ?? [];
  const body = rows.slice(1);
  const out: { label: string; value: number }[] = [];
  const width = Math.min(24, Math.max(headers.length, ...(body.map((row) => row.length))));
  for (let col = 0; col < width; col += 1) {
    let sum = 0;
    let count = 0;
    for (const row of body) {
      const n = Number(row[col] ?? "");
      if (Number.isFinite(n)) {
        sum += n;
        count += 1;
      }
    }
    if (count > 0) {
      out.push({
        label: headers[col] || `col_${col + 1}`,
        value: Number((sum / count).toFixed(4)),
      });
    }
  }
  return out.slice(0, 12);
}

async function loadCsvSnapshot(
  projectId: string,
  path: string,
): Promise<AnalysisSourceSnapshot> {
  const file = await readFile(projectId, path);
  const delimiter = path.toLowerCase().endsWith(".tsv") ? "\t" : ",";
  const parsed = Papa.parse<string[]>(file.content, {
    delimiter,
    skipEmptyLines: false,
  });
  const rows = parsed.data
    .filter((row) => Array.isArray(row))
    .slice(0, 1200)
    .map((row) => row.map((cell) => String(cell ?? "")));
  const cols = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const excerpt = rows
    .slice(0, 12)
    .map((row) => row.slice(0, 10).join(" | "))
    .join("\n")
    .slice(0, 4000);
  return {
    path,
    kind: "csv",
    summary: `rows=${rows.length}, columns=${cols}`,
    excerpt,
    rows: rows.length,
    columns: cols,
    numericSeries: toSeriesFromRows(rows),
  };
}

async function loadExcelSnapshot(
  projectId: string,
  path: string,
): Promise<AnalysisSourceSnapshot> {
  const binary = await readFileBinary(projectId, path);
  const workbook = new Workbook();
  const bytes = Uint8Array.from(binary.bytes);
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const first = workbook.worksheets[0];
  if (!first) {
    return {
      path,
      kind: "excel",
      summary: "empty workbook",
      excerpt: "",
      rows: 0,
      columns: 0,
      numericSeries: [],
    };
  }
  const rowLimit = Math.min(Math.max(first.rowCount, first.actualRowCount || 0), 1200);
  const rows: string[][] = [];
  for (let r = 1; r <= rowLimit; r += 1) {
    const row = first.getRow(r);
    const out: string[] = [];
    const colLimit = Math.min(Math.max(row.cellCount, row.actualCellCount || 0, 1), 60);
    for (let c = 1; c <= colLimit; c += 1) {
      const value = row.getCell(c).value;
      if (value == null) {
        out.push("");
      } else if (typeof value === "object" && "result" in value && value.result != null) {
        out.push(String(value.result));
      } else if (typeof value === "object" && "text" in value && typeof value.text === "string") {
        out.push(value.text);
      } else {
        out.push(String(value));
      }
    }
    rows.push(out);
  }
  const cols = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const excerpt = rows
    .slice(0, 12)
    .map((row) => row.slice(0, 10).join(" | "))
    .join("\n")
    .slice(0, 4000);
  return {
    path,
    kind: "excel",
    summary: `sheet=${first.name}, rows=${rows.length}, columns=${cols}`,
    excerpt,
    rows: rows.length,
    columns: cols,
    numericSeries: toSeriesFromRows(rows),
  };
}

async function loadTextLikeSnapshot(
  projectId: string,
  path: string,
): Promise<AnalysisSourceSnapshot> {
  const file = await readFile(projectId, path);
  const excerpt = file.content.slice(0, 6000);
  return {
    path,
    kind: ext(path) === "json" || ext(path) === "jsonl" ? "json" : "text",
    summary: `chars=${file.content.length}`,
    excerpt,
  };
}

export async function loadDataSnapshots(
  projectId: string,
  selectedFiles: string[],
): Promise<AnalysisSourceSnapshot[]> {
  const out: AnalysisSourceSnapshot[] = [];
  for (const path of selectedFiles) {
    const extension = ext(path);
    try {
      if (extension === "csv" || extension === "tsv") {
        out.push(await loadCsvSnapshot(projectId, path));
      } else if (extension === "xlsx" || extension === "xlsm") {
        out.push(await loadExcelSnapshot(projectId, path));
      } else {
        out.push(await loadTextLikeSnapshot(projectId, path));
      }
    } catch (error) {
      out.push({
        path,
        kind: "text",
        summary: `load failed: ${String(error)}`,
        excerpt: "",
      });
    }
  }
  return out;
}

type PaperChunk = {
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  text: string;
};

export type PaperAnalysisContext = {
  sourcePath: string;
  title: string;
  metadataBlock: string;
  chunks: PaperChunk[];
  pdfRelativePath?: string;
};

function normalizePdfPageText(raw: string): string {
  return raw
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function chunkPaperTextByPages(
  pages: Array<{ page: number; text: string }>,
  maxCharsPerChunk = 10_000,
): PaperChunk[] {
  const chunks: PaperChunk[] = [];
  let buffer = "";
  let start = 1;
  let end = 1;
  let chunkIndex = 0;
  for (const item of pages) {
    const pageBlock = `\n\n[Page ${item.page}]\n${item.text}`;
    if (buffer.length > 0 && buffer.length + pageBlock.length > maxCharsPerChunk) {
      chunks.push({
        chunkIndex,
        pageStart: start,
        pageEnd: end,
        text: buffer.trim(),
      });
      chunkIndex += 1;
      buffer = pageBlock;
      start = item.page;
      end = item.page;
    } else {
      if (!buffer) {
        start = item.page;
      }
      buffer += pageBlock;
      end = item.page;
    }
  }
  if (buffer.trim()) {
    chunks.push({
      chunkIndex,
      pageStart: start,
      pageEnd: end,
      text: buffer.trim(),
    });
  }
  return chunks;
}

export async function buildPaperAnalysisContext(
  projectId: string,
  sourcePath: string,
): Promise<PaperAnalysisContext> {
  const citation = await libraryCitationSummary(projectId, sourcePath);
  const preview = await libraryResolvePdfPreview(projectId, sourcePath);
  const title = citation.title?.trim() || sourcePath.split("/").pop() || sourcePath;
  const metadata = [
    `Title: ${citation.title ?? "-"}`,
    `Authors: ${(citation.authors ?? []).join(", ") || "-"}`,
    `Published: ${citation.publishedAt ?? "-"}`,
    `DOI: ${citation.doi ?? "-"}`,
    `ArXiv: ${citation.arxivId ?? "-"}`,
    `Source: ${citation.source ?? "-"}`,
    `URLs: ${(citation.urls ?? []).join(", ") || "-"}`,
  ].join("\n");
  if (!preview.relativePath) {
    return {
      sourcePath,
      title,
      metadataBlock: metadata,
      chunks: [],
    };
  }
  ensureReactPdfWorker();
  const binary = await readFileBinary(projectId, preview.relativePath);
  const bytes = Uint8Array.from(binary.bytes);
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  const pages: Array<{ page: number; text: string }> = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const text = normalizePdfPageText(
      textContent.items
        .map((item) => ("str" in item ? String(item.str ?? "") : ""))
        .join(" "),
    );
    pages.push({ page: i, text });
  }
  const chunks = chunkPaperTextByPages(pages);
  return {
    sourcePath,
    title,
    metadataBlock: metadata,
    chunks,
    pdfRelativePath: preview.relativePath ?? undefined,
  };
}

