import { Workbook, type CellValue, type Worksheet } from "exceljs";
import Papa from "papaparse";
import { Plus, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readFileBinary, writeFileBinary } from "../../../shared/api/workspace";
import { isCsvPath, isExcelPath } from "../../../shared/utils/fileKind";
import { cn } from "../../../lib/utils";

type TranslationFn = (key: any) => string;

type SheetView = {
  name: string;
  rows: string[][];
};

const MAX_EXCEL_ROWS = 180;
const MAX_EXCEL_COLS = 36;

function normalizeRows(rows: string[][]): string[][] {
  const safe = rows.map((row) => row.map((cell) => String(cell ?? "")));
  if (safe.length === 0) {
    return [[""]];
  }
  const width = Math.max(1, ...safe.map((row) => row.length));
  return safe.map((row) => {
    if (row.length >= width) {
      return row;
    }
    return [...row, ...new Array(width - row.length).fill("")];
  });
}

function csvDelimiter(path: string | null): string {
  return path?.toLowerCase().endsWith(".tsv") ? "\t" : ",";
}

function csvParse(text: string, delimiter: string): { rows: string[][]; error: string | null } {
  const parsed = Papa.parse<string[]>(text, {
    delimiter,
    skipEmptyLines: false,
  });
  if (parsed.errors.length > 0) {
    return {
      rows: normalizeRows(parsed.data.filter((row) => Array.isArray(row)).map((row) => row.map(String))),
      error: parsed.errors[0]?.message ?? "CSV parse error",
    };
  }
  return {
    rows: normalizeRows(parsed.data.filter((row) => Array.isArray(row)).map((row) => row.map(String))),
    error: null,
  };
}

function csvSerialize(rows: string[][], delimiter: string): string {
  return Papa.unparse(rows, {
    delimiter,
    newline: "\n",
  });
}

function cellToText(cell: CellValue): string {
  if (cell == null) {
    return "";
  }
  if (typeof cell === "string" || typeof cell === "number" || typeof cell === "boolean") {
    return String(cell);
  }
  if (cell instanceof Date) {
    return cell.toISOString().slice(0, 19).replace("T", " ");
  }
  if (typeof cell === "object") {
    if ("result" in cell && cell.result != null) {
      return String(cell.result);
    }
    if ("formula" in cell && typeof cell.formula === "string") {
      return `=${cell.formula}`;
    }
    if ("text" in cell && typeof cell.text === "string") {
      return cell.text;
    }
    if ("richText" in cell && Array.isArray(cell.richText)) {
      return cell.richText.map((item) => item.text).join("");
    }
  }
  return String(cell);
}

function extractSheetRows(worksheet: Worksheet): string[][] {
  const rowLimit = Math.max(1, Math.min(MAX_EXCEL_ROWS, worksheet.actualRowCount || worksheet.rowCount || 1));
  const widthFromRows = Math.max(
    1,
    ...Array.from({ length: rowLimit }, (_, index) => worksheet.getRow(index + 1).actualCellCount || 1),
  );
  const colLimit = Math.max(1, Math.min(MAX_EXCEL_COLS, widthFromRows));
  const rows: string[][] = [];
  for (let rowIndex = 1; rowIndex <= rowLimit; rowIndex += 1) {
    const row: string[] = [];
    for (let colIndex = 1; colIndex <= colLimit; colIndex += 1) {
      row.push(cellToText(worksheet.getCell(rowIndex, colIndex).value));
    }
    rows.push(row);
  }
  return normalizeRows(rows);
}

function TableGrid(props: {
  rows: string[][];
  editable: boolean;
  onCellChange: (rowIndex: number, colIndex: number, value: string) => void;
}) {
  const { rows, editable, onCellChange } = props;
  return (
    <div className="h-full overflow-auto rounded-md border border-slate-200 bg-white">
      <table className="min-w-full border-separate border-spacing-0 text-xs">
        <thead className="sticky top-0 z-10">
          <tr className="bg-slate-100">
            <th className="w-12 border-b border-r border-slate-200 px-2 py-1 text-right font-semibold text-slate-500">#</th>
            {rows[0]?.map((_, index) => (
              <th
                key={`h-${index}`}
                className="min-w-[140px] border-b border-r border-slate-200 px-2 py-1 text-left font-semibold text-slate-600"
              >
                {String.fromCharCode(65 + (index % 26))}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`r-${rowIndex}`} className={rowIndex % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
              <td className="border-b border-r border-slate-200 px-2 py-1 text-right font-mono text-[11px] text-slate-500">
                {rowIndex + 1}
              </td>
              {row.map((cell, colIndex) => (
                <td key={`c-${rowIndex}-${colIndex}`} className="border-b border-r border-slate-200 p-0">
                  <input
                    className={cn(
                      "h-8 w-full border-0 bg-transparent px-2 py-1 text-xs text-slate-700 outline-none",
                      editable
                        ? "focus:bg-primary-50 focus:ring-1 focus:ring-inset focus:ring-primary-200"
                        : "cursor-default",
                    )}
                    value={cell}
                    readOnly={!editable}
                    onChange={(event) => onCellChange(rowIndex, colIndex, event.target.value)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TablePreviewPane(props: {
  projectId: string | null;
  selectedPath: string | null;
  csvText: string;
  onCsvTextChange: (next: string) => void;
  t: TranslationFn;
}) {
  const { projectId, selectedPath, csvText, onCsvTextChange, t } = props;
  const delimiter = csvDelimiter(selectedPath);
  const parsedCsv = useMemo(() => csvParse(csvText, delimiter), [csvText, delimiter]);
  const workbookRef = useRef<Workbook | null>(null);
  const [excelSheets, setExcelSheets] = useState<SheetView[]>([]);
  const [excelLoading, setExcelLoading] = useState(false);
  const [excelSaving, setExcelSaving] = useState(false);
  const [excelDirty, setExcelDirty] = useState(false);
  const [excelActiveSheet, setExcelActiveSheet] = useState(0);
  const [excelStatus, setExcelStatus] = useState<string | null>(null);
  const [excelStatusTone, setExcelStatusTone] = useState<"success" | "error">("success");

  const isCsv = isCsvPath(selectedPath);
  const isExcel = isExcelPath(selectedPath);
  const isLegacyXls = selectedPath?.toLowerCase().endsWith(".xls") ?? false;

  useEffect(() => {
    if (!isExcel || isLegacyXls || !projectId || !selectedPath) {
      workbookRef.current = null;
      setExcelSheets([]);
      setExcelActiveSheet(0);
      setExcelDirty(false);
      setExcelLoading(false);
      return;
    }
    let cancelled = false;
    setExcelLoading(true);
    setExcelStatus(null);
    readFileBinary(projectId, selectedPath)
      .then(async (file) => {
        if (cancelled) {
          return;
        }
        const workbook = new Workbook();
        const bytes = Uint8Array.from(file.bytes);
        await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        if (cancelled) {
          return;
        }
        workbookRef.current = workbook;
        const sheets = workbook.worksheets.map((sheet) => ({
          name: sheet.name,
          rows: extractSheetRows(sheet),
        }));
        setExcelSheets(sheets);
        setExcelActiveSheet(0);
        setExcelDirty(false);
      })
      .catch((error) => {
        if (!cancelled) {
          setExcelStatusTone("error");
          setExcelStatus(`${t("table.excel.loadError")}: ${String(error)}`);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setExcelLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isExcel, isLegacyXls, projectId, selectedPath, t]);

  const updateCsvCell = useCallback((rowIndex: number, colIndex: number, value: string) => {
    const nextRows = normalizeRows(parsedCsv.rows.map((row) => [...row]));
    if (!nextRows[rowIndex]) {
      nextRows[rowIndex] = [];
    }
    while (nextRows[rowIndex].length <= colIndex) {
      nextRows[rowIndex].push("");
    }
    nextRows[rowIndex][colIndex] = value;
    onCsvTextChange(csvSerialize(nextRows, delimiter));
  }, [delimiter, onCsvTextChange, parsedCsv.rows]);

  const appendCsvRow = useCallback(() => {
    const nextRows = normalizeRows(parsedCsv.rows.map((row) => [...row]));
    const width = nextRows[0]?.length ?? 1;
    nextRows.push(new Array(width).fill(""));
    onCsvTextChange(csvSerialize(nextRows, delimiter));
  }, [delimiter, onCsvTextChange, parsedCsv.rows]);

  const appendCsvColumn = useCallback(() => {
    const nextRows = normalizeRows(parsedCsv.rows.map((row) => [...row]));
    nextRows.forEach((row) => row.push(""));
    onCsvTextChange(csvSerialize(nextRows, delimiter));
  }, [delimiter, onCsvTextChange, parsedCsv.rows]);

  const activeExcelSheet = excelSheets[excelActiveSheet] ?? null;

  const updateExcelCell = useCallback((rowIndex: number, colIndex: number, value: string) => {
    setExcelSheets((prev) => {
      const next = prev.map((sheet) => ({ ...sheet, rows: sheet.rows.map((row) => [...row]) }));
      const active = next[excelActiveSheet];
      if (!active) {
        return prev;
      }
      while (active.rows.length <= rowIndex) {
        active.rows.push(new Array(active.rows[0]?.length ?? 1).fill(""));
      }
      while (active.rows[rowIndex].length <= colIndex) {
        active.rows[rowIndex].push("");
      }
      active.rows[rowIndex][colIndex] = value;
      return next;
    });
    const workbook = workbookRef.current;
    const worksheet = workbook?.worksheets[excelActiveSheet];
    if (worksheet) {
      worksheet.getCell(rowIndex + 1, colIndex + 1).value = value === "" ? null : value;
      setExcelDirty(true);
      setExcelStatus(null);
    }
  }, [excelActiveSheet]);

  const saveExcel = useCallback(async () => {
    if (!projectId || !selectedPath || !workbookRef.current) {
      return;
    }
    setExcelSaving(true);
    setExcelStatus(null);
    try {
      const buffer = await workbookRef.current.xlsx.writeBuffer();
      await writeFileBinary(projectId, selectedPath, new Uint8Array(buffer as ArrayBuffer));
      setExcelDirty(false);
      setExcelStatusTone("success");
      setExcelStatus(t("table.excel.saved"));
    } catch (error) {
      setExcelStatusTone("error");
      setExcelStatus(`${t("table.excel.saveError")}: ${String(error)}`);
    } finally {
      setExcelSaving(false);
    }
  }, [projectId, selectedPath, t]);

  if (isCsv) {
    return (
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2">
        <div className="flex items-center gap-2">
          <button
            className="inline-flex h-8 items-center gap-1 rounded border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-100"
            onClick={appendCsvRow}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("table.csv.addRow")}
          </button>
          <button
            className="inline-flex h-8 items-center gap-1 rounded border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-100"
            onClick={appendCsvColumn}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("table.csv.addColumn")}
          </button>
          {parsedCsv.error ? (
            <span className="truncate text-[11px] text-rose-600">
              {t("table.csv.parseError")}: {parsedCsv.error}
            </span>
          ) : null}
        </div>
        <TableGrid rows={parsedCsv.rows} editable onCellChange={updateCsvCell} />
      </div>
    );
  }

  if (isExcel) {
    if (isLegacyXls) {
      return (
        <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 text-xs text-slate-500">
          {t("table.excel.readonlyXls")}
        </div>
      );
    }
    return (
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {excelSheets.map((sheet, index) => (
            <button
              key={sheet.name}
              className={cn(
                "h-8 shrink-0 rounded border px-2 text-xs",
                index === excelActiveSheet
                  ? "border-primary-500 bg-primary-50 text-primary-700"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100",
              )}
              onClick={() => setExcelActiveSheet(index)}
            >
              {sheet.name}
            </button>
          ))}
          <button
            className="ml-auto inline-flex h-8 shrink-0 items-center gap-1 rounded border border-primary-600 bg-primary-600 px-2 text-xs text-white hover:bg-primary-700 disabled:opacity-50"
            onClick={() => {
              void saveExcel();
            }}
            disabled={excelSaving || !excelDirty}
          >
            <Save className="h-3.5 w-3.5" />
            {excelSaving ? t("table.excel.saving") : t("table.excel.save")}
          </button>
        </div>
        {excelLoading ? (
          <div className="flex h-full items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-500">
            {t("table.excel.loading")}
          </div>
        ) : activeExcelSheet ? (
          <TableGrid rows={activeExcelSheet.rows} editable onCellChange={updateExcelCell} />
        ) : (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
            {t("table.excel.noSheets")}
          </div>
        )}
        {excelStatus ? (
          <p className={cn("text-[11px]", excelStatusTone === "error" ? "text-rose-600" : "text-emerald-600")}>
            {excelStatus}
          </p>
        ) : null}
        {activeExcelSheet && (activeExcelSheet.rows.length >= MAX_EXCEL_ROWS || activeExcelSheet.rows[0]?.length >= MAX_EXCEL_COLS) ? (
          <p className="text-[11px] text-amber-700">{t("table.excel.truncated")}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
      {t("preview.empty")}
    </div>
  );
}
