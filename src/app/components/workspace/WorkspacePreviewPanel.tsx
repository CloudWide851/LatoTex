import { AlertTriangle, Download, ListChecks, Minus, Plus, RotateCcw } from "lucide-react";
import { FilePreviewPane } from "../FilePreviewPane";
import { TablePreviewPane } from "../table/TablePreviewPane";
import type { ShareCommentItem } from "../../../shared/types/app";

type TranslationFn = (key: any) => string;
type LogTab = "events" | "status";

export function WorkspacePreviewPanel(props: {
  activeProjectId: string | null;
  selectedFile: string | null;
  selectedIsCsv: boolean;
  selectedIsMarkdown: boolean;
  selectedIsSvg: boolean;
  selectedIsTabular: boolean;
  editorContent: string;
  compiledPdfUrl: string | null;
  previewMode: "pdf" | "markdown" | "svg" | "empty";
  previewPdfUrl: string | null;
  canZoomPreview: boolean;
  previewZoom: number;
  compileErrorLine: string | null;
  onEditorChange: (value: string) => void;
  onOpenLogs: (tab: LogTab) => void;
  onExportPdf: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onPreviewZoomChange: (nextZoom: number) => void;
  shareComments: ShareCommentItem[];
  onJumpToShareComment: (page: number) => void;
  previewFocusRequest: { page: number; token: number } | null;
  t: TranslationFn;
}) {
  const {
    activeProjectId,
    selectedFile,
    selectedIsCsv,
    selectedIsMarkdown,
    selectedIsSvg,
    selectedIsTabular,
    editorContent,
    compiledPdfUrl,
    previewMode,
    previewPdfUrl,
    canZoomPreview,
    previewZoom,
    compileErrorLine,
    onEditorChange,
    onOpenLogs,
    onExportPdf,
    onZoomIn,
    onZoomOut,
    onZoomReset,
    onPreviewZoomChange,
    shareComments,
    onJumpToShareComment,
    previewFocusRequest,
    t,
  } = props;

  const composeTitleWithShortcut = (label: string, shortcut: string) => `${label} (${shortcut})`;

  return (
    <aside className="h-full min-h-0 overflow-hidden rounded-lg border border-slate-200 bg-white p-2 shadow-soft motion-slide-up">
      <div className="panel-topbar mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">{t("preview.title")}</h2>
        <div className="flex items-center gap-1">
          <button
            className="panel-topbar-btn rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
            title={t("preview.diagnostics")}
            onClick={() => onOpenLogs("status")}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
          </button>
          <button
            className="panel-topbar-btn rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
            title={t("preview.events")}
            onClick={() => onOpenLogs("events")}
          >
            <ListChecks className="h-3.5 w-3.5" />
          </button>
          {!selectedIsTabular ? (
            <>
              <button
                className="panel-topbar-btn rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                title={composeTitleWithShortcut(t("preview.savePdf"), t("shortcut.exportPdf"))}
                aria-label={composeTitleWithShortcut(t("preview.savePdf"), t("shortcut.exportPdf"))}
                onClick={onExportPdf}
                disabled={!compiledPdfUrl}
              >
                <Download className="h-3.5 w-3.5" />
              </button>
              <button
                className="panel-topbar-btn rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                title={t("preview.zoomOut")}
                aria-label={t("preview.zoomOut")}
                onClick={onZoomOut}
                disabled={!canZoomPreview || previewZoom <= 0.5}
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <button
                className="panel-topbar-btn rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                title={t("preview.zoomIn")}
                aria-label={t("preview.zoomIn")}
                onClick={onZoomIn}
                disabled={!canZoomPreview || previewZoom >= 3}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button
                className="panel-topbar-btn rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                title={t("preview.zoomReset")}
                aria-label={t("preview.zoomReset")}
                onClick={onZoomReset}
                disabled={!canZoomPreview}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </>
          ) : null}
        </div>
      </div>
      {compileErrorLine && (
        <button
          className="mb-2 w-full truncate rounded border border-rose-300 bg-rose-50 px-2 py-1 text-left text-xs text-rose-700"
          onClick={() => onOpenLogs("status")}
          title={compileErrorLine}
        >
          {compileErrorLine}
        </button>
      )}
      <div className="h-[calc(100%-52px)]">
        {selectedIsTabular ? (
          <TablePreviewPane
            projectId={activeProjectId}
            selectedPath={selectedFile}
            csvText={selectedIsCsv ? editorContent : ""}
            onCsvTextChange={onEditorChange}
            t={t}
          />
        ) : (
          <FilePreviewPane
            mode={previewMode}
            pdfUrl={previewPdfUrl ?? null}
            markdownContent={selectedIsMarkdown ? editorContent : ""}
            svgContent={selectedIsSvg ? editorContent : ""}
            title={t("preview.title")}
            emptyText={selectedIsMarkdown || selectedIsSvg ? t("preview.markdownEmpty") : t("preview.empty")}
            pdfZoom={previewZoom}
            onPdfZoomChange={onPreviewZoomChange}
            focusRequest={previewFocusRequest}
          />
        )}
      </div>
      {shareComments.length > 0 ? (
        <div className="mt-2 max-h-28 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-2">
          <div className="mb-1 text-[11px] font-semibold text-slate-600">{t("share.commentsInPreview")}</div>
          <div className="space-y-1.5">
            {shareComments.slice(0, 24).map((item) => (
              <button
                key={`${item.id}-${item.createdAt ?? ""}`}
                className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-left text-[11px] text-slate-700 hover:bg-slate-100"
                onClick={() => {
                  if (typeof item.page === "number" && item.page > 0) {
                    onJumpToShareComment(item.page);
                  }
                }}
                title={item.quote || item.text}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold">{item.username}</span>
                  <span className="shrink-0 text-[10px] text-slate-500">
                    {typeof item.page === "number" && item.page > 0 ? `${t("share.commentPage")} ${item.page}` : "-"}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-slate-600">{item.quote || item.text}</div>
                {item.sessionCreatedAt ? (
                  <div className="mt-0.5 truncate text-[10px] text-slate-500">
                    {item.sessionName ? `${item.sessionName} · ` : ""}
                    {item.sessionCreatedAt}
                  </div>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
