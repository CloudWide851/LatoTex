import { LoaderCircle } from "lucide-react";
import { InfoHint } from "../../../components/ui/info-hint";
import type { TranslationFn } from "./workspaceShellTypes";

export function WorkspaceBootstrapFallback({ t }: { t: TranslationFn }) {
  return (
    <main
      className="app-material-canvas flex min-h-0 flex-1 overflow-hidden p-1"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex h-full min-h-0 w-full gap-0">
        <aside className="app-material-shell w-14 shrink-0 rounded-lg border p-2" aria-hidden>
          <div className="mx-auto mt-1 h-8 w-8 rounded-lg bg-[color:var(--app-material-inset)]" />
        </aside>
        <section className="app-material-shell ml-1 flex min-w-0 flex-1 items-center justify-center rounded-lg border p-6">
          <div className="app-material-inset flex max-w-sm items-center gap-3 rounded-lg border px-4 py-3 text-left">
            <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-[color:var(--app-accent)]" aria-hidden />
            <div className="flex min-w-0 items-center gap-1">
              <div className="text-sm font-medium text-[color:var(--app-text)]">{t("common.loading")}</div>
              <InfoHint content={t("app.startup.lightHint")} label={t("common.loading")} />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
