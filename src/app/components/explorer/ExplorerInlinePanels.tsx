import { Check, X } from "lucide-react";

type TranslationFn = (key: any) => string;

export function ExplorerTransferPanel(props: {
  busy?: boolean;
  sourcePath: string;
  targetPath: string;
  onTargetPathChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  t: TranslationFn;
}) {
  const { busy, sourcePath, targetPath, onTargetPathChange, onCancel, onConfirm, t } = props;
  return (
    <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs">
      <div className="truncate text-slate-600">{sourcePath}</div>
      <input
        className="mt-2 w-full rounded border border-slate-300 bg-white px-2 py-1 outline-none focus:border-primary-500"
        value={targetPath}
        placeholder={t("explorer.prompt.targetPath")}
        onChange={(event) => onTargetPathChange(event.target.value)}
      />
      <div className="mt-2 flex justify-end gap-2">
        <button
          className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-600 hover:bg-slate-100"
          onClick={onCancel}
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <button
          className="rounded border border-primary-600 bg-primary-600 px-2 py-1 text-white hover:bg-primary-500 disabled:opacity-50"
          disabled={busy || !targetPath.trim()}
          onClick={() => void onConfirm()}
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function ExplorerLinkDraftPanel(props: {
  busy?: boolean;
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  t: TranslationFn;
}) {
  const { busy, value, onChange, onCancel, onConfirm, t } = props;
  return (
    <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs">
      <div className="text-slate-600">{t("library.action.importLink")}</div>
      <input
        className="mt-2 w-full rounded border border-slate-300 bg-white px-2 py-1 outline-none focus:border-primary-500"
        value={value}
        placeholder={t("library.linkPlaceholder")}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="mt-2 flex justify-end gap-2">
        <button
          className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-600 hover:bg-slate-100"
          onClick={onCancel}
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <button
          className="rounded border border-primary-600 bg-primary-600 px-2 py-1 text-white hover:bg-primary-500 disabled:opacity-50"
          disabled={busy || !value.trim()}
          onClick={onConfirm}
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
