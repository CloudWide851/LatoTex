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
      <div className="flex items-center gap-1 border-b border-slate-200 bg-white px-2 py-1">
        {(["tex", "docx"] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={[
              "rounded px-2.5 py-1 text-xs font-medium transition",
              mode === item
                ? "bg-[color:var(--app-accent)] text-white"
                : "text-slate-600 hover:bg-slate-100",
            ].join(" ")}
            onClick={() => onModeChange(item)}
          >
            {t(item === "tex" ? "workspace.mode.tex" : "workspace.mode.docx")}
          </button>
        ))}
      </div>
      <div className="min-h-0">{mode === "docx" ? docxWorkspace : texWorkspace}</div>
    </section>
  );
}
