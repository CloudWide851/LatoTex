import { Plus, X } from "lucide-react";
import type { TerminalTab, TranslationFn } from "./terminalTypes";

function terminalStatusClass(tab: TerminalTab) {
  if (tab.error || tab.status === "failed") {
    return "bg-rose-500";
  }
  if (tab.status === "running") {
    return "bg-emerald-500";
  }
  if (tab.status === "starting") {
    return "bg-amber-500";
  }
  return "bg-slate-400";
}

export function TerminalSessionRail(props: {
  tabs: TerminalTab[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  t: TranslationFn;
}) {
  const { tabs, activeTabId, onSelect, onClose, onNew, t } = props;

  return (
    <aside className="library-scrollbar flex w-24 shrink-0 flex-col border-r border-[color:var(--editor-shell-divider)] bg-[color:var(--editor-widget-bg)]">
      <div className="flex min-h-9 items-center justify-between border-b border-[color:var(--editor-shell-divider)] px-2">
        <span className="truncate text-[11px] font-semibold text-[color:var(--editor-tab-muted)]">
          {t("terminal.title")}
        </span>
        <button
          type="button"
          className="panel-topbar-btn editor-toolbar-btn h-6 w-6"
          onClick={onNew}
          title={t("terminal.new")}
          aria-label={t("terminal.new")}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-1">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={`group flex w-full min-w-0 items-center gap-1 rounded-md border text-[11px] transition ${
                active
                  ? "border-primary-400 bg-primary-50 text-primary-900"
                  : "border-transparent text-[color:var(--editor-tab-muted)] hover:border-[color:var(--editor-widget-border)] hover:bg-[color:var(--editor-paper-bg)]"
              }`}
              title={tab.cwd || tab.relativePath || tab.title}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1 px-1.5 py-1 text-left"
                onClick={() => onSelect(tab.id)}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${terminalStatusClass(tab)}`} />
                <span className="min-w-0 flex-1 truncate">{tab.title}</span>
              </button>
              <button
                type="button"
                className="mr-1 hidden h-4 w-4 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-white/70 hover:text-rose-600 group-hover:flex"
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(tab.id);
                }}
                title={t("terminal.close")}
                aria-label={t("terminal.close")}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
