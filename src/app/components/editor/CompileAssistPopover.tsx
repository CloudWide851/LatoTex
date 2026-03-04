type TranslationFn = (key: any) => string;

export function CompileAssistPopover(props: {
  visible: boolean;
  diagnostics: string[];
  onDismiss: () => void;
  onAutoFix: () => void;
  t: TranslationFn;
}) {
  const { visible, diagnostics, onDismiss, onAutoFix, t } = props;

  if (!visible) {
    return null;
  }

  return (
    <div className="absolute right-0 top-11 z-20 w-[min(460px,72vw)] rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 shadow-soft">
      <div className="font-semibold">{t("workspace.compileAssist.title")}</div>
      <div className="mt-1 line-clamp-2 text-[11px]">{t("workspace.compileAssist.description")}</div>
      <pre className="mt-2 max-h-20 overflow-auto whitespace-pre-wrap rounded border border-amber-200 bg-white p-1 text-[10px] text-slate-700">
        {diagnostics.slice(0, 3).join("\n")}
      </pre>
      <div className="mt-2 flex justify-end gap-1">
        <button
          className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
          onClick={onDismiss}
        >
          {t("workspace.compileAssist.dismiss")}
        </button>
        <button
          className="rounded border border-primary-600 bg-primary-600 px-2 py-1 text-[11px] text-white hover:bg-primary-700"
          onClick={onAutoFix}
        >
          {t("workspace.compileAssist.autoFix")}
        </button>
      </div>
    </div>
  );
}
