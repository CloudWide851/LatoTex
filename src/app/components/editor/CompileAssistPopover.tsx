import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type TranslationFn = (key: any) => string;

export function CompileAssistPopover(props: {
  visible: boolean;
  diagnostics: string[];
  hint: string;
  onDismiss: () => void;
  onAutoFix: () => void;
  autoFixDisabled?: boolean;
  t: TranslationFn;
}) {
  const {
    visible,
    diagnostics,
    hint,
    onDismiss,
    onAutoFix,
    autoFixDisabled = false,
    t,
  } = props;
  const [copied, setCopied] = useState(false);
  const resetCopiedTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetCopiedTimerRef.current != null) {
      window.clearTimeout(resetCopiedTimerRef.current);
      resetCopiedTimerRef.current = null;
    }
  }, []);

  if (!visible) {
    return null;
  }

  const handleCopyHint = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard || !hint.trim()) {
      return;
    }
    try {
      await navigator.clipboard.writeText(hint);
      setCopied(true);
      if (resetCopiedTimerRef.current != null) {
        window.clearTimeout(resetCopiedTimerRef.current);
      }
      resetCopiedTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        resetCopiedTimerRef.current = null;
      }, 1400);
    } catch {
      setCopied(false);
    }
  };

  const content = (
    <div className="fixed right-4 top-[calc(var(--topbar-height,48px)+12px)] z-[470] w-[min(560px,92vw)] rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 shadow-soft">
      <div className="font-semibold">{t("workspace.compileAssist.title")}</div>
      <div className="mt-1 line-clamp-2 text-[11px]">{t("workspace.compileAssist.description")}</div>
      <pre className="mt-2 max-h-[24vh] overflow-auto whitespace-pre-wrap rounded border border-amber-200 bg-white p-1 text-[10px] text-slate-700">
        {diagnostics.slice(0, 3).join("\n")}
      </pre>
      <pre className="mt-2 max-h-[40vh] overflow-auto whitespace-pre-wrap rounded border border-amber-200 bg-white p-1 text-[10px] text-slate-700">
        {hint}
      </pre>
      <div className="mt-2 flex justify-end gap-1">
        <button
          className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
          onClick={onDismiss}
        >
          {t("workspace.compileAssist.dismiss")}
        </button>
        <button
          className="rounded border border-amber-600 bg-amber-600 px-2 py-1 text-[11px] text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onAutoFix}
          disabled={autoFixDisabled}
        >
          {t("workspace.compileAssist.autoFix")}
        </button>
        <button
          className="rounded border border-primary-600 bg-primary-600 px-2 py-1 text-[11px] text-white hover:bg-primary-700"
          onClick={() => {
            void handleCopyHint();
          }}
          disabled={!hint.trim()}
        >
          {copied ? t("workspace.compileAssist.copySuccess") : t("workspace.compileAssist.copyHint")}
        </button>
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return content;
  }

  return createPortal(content, document.body);
}
