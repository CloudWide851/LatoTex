import { LoaderCircle } from "lucide-react";

type TranslationFn = (key: any) => string;

export function formatLibraryPdfByteCount(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function formatLibraryPdfDownloadAmount(
  downloadedBytes: number | null,
  totalBytes: number | null,
): string {
  if (totalBytes && totalBytes > 0) {
    return `${formatLibraryPdfByteCount(downloadedBytes ?? 0)} / ${formatLibraryPdfByteCount(totalBytes)}`;
  }
  return formatLibraryPdfByteCount(downloadedBytes ?? 0);
}

export function LibraryPdfDownloadToast(props: {
  visible: boolean;
  phase: "downloading" | "preparing";
  downloadedBytes: number | null;
  totalBytes: number | null;
  offsetTopClassName?: string;
  t: TranslationFn;
}) {
  const {
    visible,
    phase,
    downloadedBytes,
    totalBytes,
    offsetTopClassName = "top-3",
    t,
  } = props;

  if (!visible) {
    return null;
  }

  const title = phase === "preparing"
    ? t("library.viewer.preparingPdf")
    : t("library.viewer.downloadingPdf");

  return (
    <div className={`pointer-events-none absolute right-3 ${offsetTopClassName} z-20 w-64 max-w-[calc(100%-1.5rem)] rounded-xl border border-slate-200 bg-white/96 p-3 shadow-lg backdrop-blur-sm`}>
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-700">
          <LoaderCircle className="h-4 w-4 animate-spin" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary-700">
            {t("library.viewer.showPdf")}
          </div>
          <div className="mt-1 text-sm font-medium text-slate-800">{title}</div>
          <div className="mt-2 text-[11px] text-slate-500">
            {t("library.viewer.downloadedBytes")} {formatLibraryPdfDownloadAmount(downloadedBytes, totalBytes)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function LibraryPdfBlockedNotice(props: {
  error: string | null;
  retryAvailable: boolean;
  onRetry: () => void;
  t: TranslationFn;
}) {
  const { error, retryAvailable, onRetry, t } = props;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-slate-700">{t("library.viewer.pdfBlocked")}</div>
          {error ? (
            <div className="mt-1 break-words text-rose-700">
              {t("library.viewer.error")} {error}
            </div>
          ) : null}
        </div>
        {retryAvailable ? (
          <button
            type="button"
            className="inline-flex shrink-0 items-center rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 transition hover:bg-slate-100"
            onClick={onRetry}
          >
            {t("library.viewer.retryPdf")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
