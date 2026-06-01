import { AlertTriangle } from "lucide-react";
import { Button } from "../../components/ui/button";
import type { ProjectSummary } from "../../shared/types/app";

type TranslationFn = (key: any) => string;

export type ProjectDeleteConfirmIntent = {
  project: ProjectSummary;
  mode: "unregister" | "trashRoot";
} | null;

export function ProjectDeleteConfirmDialog(props: {
  intent: ProjectDeleteConfirmIntent;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  t: TranslationFn;
}) {
  const { intent, busy, onCancel, onConfirm, t } = props;
  if (!intent) {
    return null;
  }
  const destructive = intent.mode === "trashRoot";
  return (
    <div className="fixed inset-0 z-[430] flex items-center justify-center bg-slate-950/62 p-4 motion-overlay-enter">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-4 shadow-soft motion-card-pop motion-panel-glow">
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${destructive ? "border-rose-200 bg-rose-50 text-rose-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">
              {t(destructive ? "topbar.projectMoveToTrashTitle" : "topbar.projectRemoveFromListTitle")}
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              {t(destructive ? "topbar.projectMoveToTrashConfirm" : "topbar.projectRemoveFromListConfirm").replace("{name}", intent.project.name)}
            </p>
          </div>
        </div>
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="truncate text-sm font-medium text-slate-800">{intent.project.name}</div>
          <div className="mt-1 truncate font-mono text-[11px] text-slate-500">{intent.project.rootPath}</div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant={destructive ? "danger" : "secondary"} size="sm" onClick={onConfirm} disabled={busy}>
            {t("common.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
