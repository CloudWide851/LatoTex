import { FileText, FolderOpen } from "lucide-react";
import { InfoHint } from "../../../components/ui/info-hint";

type TranslationFn = (key: any) => string;

export function NoProjectPanel(props: {
  busy: boolean;
  onOpenFolder: () => void;
  onCreateSample: () => void;
  t: TranslationFn;
}) {
  const { busy, onOpenFolder, onCreateSample, t } = props;
  return (
    <section
      className="app-material-panel flex h-full flex-col items-center justify-center rounded-lg border border-dashed px-6 py-10 text-center motion-slide-up"
      aria-labelledby="workspace-welcome-title"
    >
      <div className="app-material-inset mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border text-[color:var(--app-accent)] shadow-sm">
        <FolderOpen className="h-7 w-7" aria-hidden="true" />
      </div>
      <div className="flex max-w-xl items-center gap-1.5">
        <h2 id="workspace-welcome-title" className="text-base font-semibold tracking-tight text-slate-900">
          {t("workspace.welcomeTitle")}
        </h2>
        <InfoHint content={t("workspace.welcomeDescription")} label={t("workspace.welcomeTitle")} />
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <span className="inline-flex items-center gap-0.5">
          <button
            className="control-button control-button--primary inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm disabled:opacity-50"
            onClick={onOpenFolder}
            disabled={busy}
            title={t("workspace.openProjectFolder")}
          >
            <FolderOpen className="h-4 w-4" aria-hidden="true" />
            <span>{t("workspace.openProjectFolder")}</span>
          </button>
          <InfoHint content={t("workspace.folderHint")} label={t("workspace.openProjectFolder")} />
        </span>
        <span className="inline-flex items-center gap-0.5">
          <button
            className="control-button control-button--secondary inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm disabled:opacity-50"
            onClick={onCreateSample}
            disabled={busy}
            title={t("workspace.createSample")}
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            <span>{t("workspace.createSample")}</span>
          </button>
          <InfoHint content={t("workspace.sampleHint")} label={t("workspace.createSample")} />
        </span>
      </div>
    </section>
  );
}
