type TranslationFn = (key: any) => string;

export function LatexWorkspaceModeShell(props: {
  mode: "tex" | "docx";
  onModeChange: (mode: "tex" | "docx") => void;
  texWorkspace: React.ReactNode;
  docxWorkspace: React.ReactNode;
  t: TranslationFn;
}) {
  const { mode, onModeChange, texWorkspace, docxWorkspace, t } = props;
  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <div className="editor-toolbar-shell flex items-center justify-start px-3 py-2">
        <div className="inline-flex max-w-full items-center gap-1 rounded-full border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-widget-bg)] p-1 shadow-[0_10px_24px_rgba(15,23,42,0.10)]">
          {(["tex", "docx"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={[
                "h-7 min-w-16 rounded-full px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[color:var(--editor-widget-bg)]",
                mode === item
                  ? "bg-[color:var(--app-accent)] text-white shadow-sm"
                  : "text-[color:var(--editor-tab-muted)] hover:bg-[color:var(--editor-tab-hover-bg)] hover:text-[color:var(--editor-tab-text)]",
              ].join(" ")}
              onClick={() => onModeChange(item)}
            >
              {t(item === "tex" ? "workspace.mode.tex" : "workspace.mode.docx")}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0">{mode === "docx" ? docxWorkspace : texWorkspace}</div>
    </section>
  );
}
