import { FolderOpen } from "lucide-react";
import type { ComponentStartupState } from "../../hooks/startupState";

type TranslationFn = (key: any) => string;

export function NoProjectPanel(props: {
  busy: boolean;
  componentStartupState: ComponentStartupState;
  onOpenFolder: () => void;
  t: TranslationFn;
}) {
  const { busy, componentStartupState, onOpenFolder, t } = props;
  const startupBlocked = componentStartupState !== "ready";
  return (
    <div
      className="flex h-full flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-4 motion-slide-up"
      data-startup-state={componentStartupState}
      aria-busy={startupBlocked}
    >
      <p className="mb-3 text-sm text-slate-600">{t("workspace.noProject")}</p>
      <button
        className="rounded border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        onClick={onOpenFolder}
        disabled={busy || startupBlocked}
        title={t("topbar.openFolder")}
        aria-label={t("topbar.openFolder")}
      >
        <FolderOpen className="h-5 w-5" />
      </button>
    </div>
  );
}
