import { FileCheck2, FileCode2, FileText } from "lucide-react";
import type { ReactNode } from "react";

type TranslationFn = (key: any) => string;
export type LatexWorkspaceMode = "tex" | "docx" | "submission";

const MODE_ITEMS: Array<{
  id: LatexWorkspaceMode;
  labelKey: "workspace.mode.tex" | "workspace.mode.docx" | "workspace.mode.submission";
  icon: typeof FileCode2;
}> = [
  { id: "tex", labelKey: "workspace.mode.tex", icon: FileCode2 },
  { id: "docx", labelKey: "workspace.mode.docx", icon: FileText },
  { id: "submission", labelKey: "workspace.mode.submission", icon: FileCheck2 },
];

export function LatexWorkspaceModeShell(props: {
  mode: LatexWorkspaceMode;
  onModeChange: (mode: LatexWorkspaceMode) => void;
  texWorkspace: ReactNode;
  docxWorkspace: ReactNode;
  submissionWorkspace: ReactNode;
  t: TranslationFn;
}) {
  const { mode, onModeChange, texWorkspace, docxWorkspace, submissionWorkspace, t } = props;
  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <div className="editor-toolbar-shell flex items-center justify-start px-3 py-2">
        <div className="inline-flex max-w-full items-center gap-1 rounded-full border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-widget-bg)] p-1 shadow-[0_10px_24px_rgba(15,23,42,0.10)]">
          {MODE_ITEMS.map((item) => {
            const Icon = item.icon;
            const label = t(item.labelKey);
            return (
              <button
                key={item.id}
                type="button"
                className={[
                  "flex h-8 w-8 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[color:var(--editor-widget-bg)]",
                  mode === item.id
                    ? "bg-[color:var(--app-accent)] text-white shadow-sm"
                    : "text-[color:var(--editor-tab-muted)] hover:bg-[color:var(--editor-tab-hover-bg)] hover:text-[color:var(--editor-tab-text)]",
                ].join(" ")}
                title={label}
                aria-label={label}
                aria-pressed={mode === item.id}
                onClick={() => onModeChange(item.id)}
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-h-0">
        {mode === "docx" ? docxWorkspace : mode === "submission" ? submissionWorkspace : texWorkspace}
      </div>
    </section>
  );
}
