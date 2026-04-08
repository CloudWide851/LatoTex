import { FlatCheckIndicator } from "../../../components/ui/flat-check-indicator";

type TranslationFn = (key: any) => string;

export function AnalysisFilePickerDialog(props: {
  open: boolean;
  files: string[];
  selectedFiles: string[];
  onToggleFile: (path: string) => void;
  onSelectAll: () => void;
  onInvert: () => void;
  onClose: () => void;
  t: TranslationFn;
}) {
  const { open, files, selectedFiles, onToggleFile, onSelectAll, onInvert, onClose, t } = props;
  if (!open) {
    return null;
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="grid h-[min(76vh,640px)] w-full max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] rounded-lg border border-slate-300 bg-white shadow-soft">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-800">{t("analysis.filePickerTitle")}</h3>
          <div className="flex items-center gap-2">
            <button
              className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
              onClick={onSelectAll}
            >
              {t("analysis.selectAll")}
            </button>
            <button
              className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
              onClick={onInvert}
            >
              {t("analysis.invertSelect")}
            </button>
          </div>
        </div>
        <div className="min-h-0 overflow-auto px-3 py-2">
          <div className="space-y-1">
            {files.map((path) => {
              const checked = selectedFiles.includes(path);
              return (
                <button
                  key={path}
                  className="flex w-full items-center gap-2 rounded border border-slate-200 bg-white px-2 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                  onClick={() => onToggleFile(path)}
                >
                  <FlatCheckIndicator checked={checked} />
                  <span className="truncate">{path}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center justify-end border-t border-slate-200 px-4 py-3">
          <button
            className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
            onClick={onClose}
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
