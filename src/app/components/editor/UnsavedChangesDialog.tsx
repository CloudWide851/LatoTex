import { AlertTriangle } from "lucide-react";
import type { PendingNavigationIntent, UnsavedChangeItem } from "../../../shared/types/app";
import { Button } from "../../../components/ui/button";

type TranslationFn = (key: any) => string;

export function UnsavedChangesDialog(props: {
  open: boolean;
  intent: PendingNavigationIntent;
  items: UnsavedChangeItem[];
  busy: boolean;
  onSaveAndContinue: () => void;
  onDiscardAndContinue: () => void;
  onCancel: () => void;
  t: TranslationFn;
}) {
  const {
    open,
    intent,
    items,
    busy,
    onSaveAndContinue,
    onDiscardAndContinue,
    onCancel,
    t,
  } = props;

  if (!open) {
    return null;
  }

  const intentKeyMap: Record<PendingNavigationIntent, string> = {
    closeTabs: "editor.unsaved.intent.closeTabs",
    closeWindow: "editor.unsaved.intent.closeWindow",
    switchFile: "editor.unsaved.intent.switchFile",
    switchProject: "editor.unsaved.intent.switchProject",
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/55 p-4">
      <div className="w-full max-w-lg rounded-lg border border-slate-300 bg-white p-4 shadow-soft">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-amber-100 p-2 text-amber-700">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-slate-800">{t("editor.unsaved.title")}</h3>
            <p className="mt-1 text-xs text-slate-600">{t(intentKeyMap[intent])}</p>
          </div>
        </div>

        <ul className="mt-3 max-h-56 space-y-1 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
          {items.map((item) => (
            <li key={`${item.tabId ?? "path"}-${item.path}`} className="truncate font-mono">
              {item.path}
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="secondary" size="sm" onClick={onDiscardAndContinue} disabled={busy}>
            {t("editor.unsaved.discardAndContinue")}
          </Button>
          <Button size="sm" onClick={onSaveAndContinue} disabled={busy}>
            {t("editor.unsaved.saveAndContinue")}
          </Button>
        </div>
      </div>
    </div>
  );
}
