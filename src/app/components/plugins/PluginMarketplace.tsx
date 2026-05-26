import { Download, Power, RefreshCw, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  getPluginCatalog,
  installPlugin,
  listInstalledPlugins,
  setPluginEnabled,
  uninstallPlugin,
} from "../../../shared/api/plugins";
import type { InstalledPlugin, PluginManifest } from "../../../shared/plugins/pluginTypes";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { cn } from "../../../lib/utils";

type TranslationFn = (key: any) => string;

function contributionSummary(plugin: PluginManifest): string {
  return plugin.contributions.map((item) => item.title).join(", ");
}

export function PluginMarketplace(props: { t: TranslationFn }) {
  const { t } = props;
  const [catalogUrl, setCatalogUrl] = useState("");
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<PluginManifest[]>([]);
  const [installed, setInstalled] = useState<InstalledPlugin[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const installedById = useMemo(
    () => new Map(installed.map((item) => [item.manifest.id, item])),
    [installed],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return catalog;
    }
    return catalog.filter((item) =>
      [item.name, item.publisher, item.description, item.id, item.categories.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [catalog, query]);

  const reload = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const [nextCatalog, nextInstalled] = await Promise.all([
        getPluginCatalog(catalogUrl.trim() || undefined),
        listInstalledPlugins(),
      ]);
      setCatalog(nextCatalog.items);
      setWarnings(nextCatalog.warnings);
      setInstalled(nextInstalled);
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const install = async (plugin: PluginManifest) => {
    setBusy(true);
    try {
      const next = await installPlugin(plugin);
      setInstalled((prev) => [next, ...prev.filter((item) => item.manifest.id !== plugin.id)]);
      setStatus(t("plugins.installDone"));
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (plugin: InstalledPlugin) => {
    setBusy(true);
    try {
      const next = await setPluginEnabled(plugin.manifest.id, !plugin.enabled);
      setInstalled((prev) => prev.map((item) => (item.manifest.id === next.manifest.id ? next : item)));
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (pluginId: string) => {
    setBusy(true);
    try {
      await uninstallPlugin(pluginId);
      setInstalled((prev) => prev.filter((item) => item.manifest.id !== pluginId));
      setStatus(t("plugins.uninstallDone"));
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] rounded-lg border border-slate-200 bg-white shadow-soft">
      <div className="border-b border-slate-200 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{t("plugins.title")}</h2>
            <p className="text-xs text-slate-500">{t("plugins.subtitle")}</p>
          </div>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void reload()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            {busy ? t("common.loading") : t("plugins.refresh")}
          </Button>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-[minmax(160px,1fr)_minmax(220px,1.4fr)]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <Input className="h-9 pl-8 text-xs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("plugins.search")} />
          </label>
          <Input className="h-9 text-xs" value={catalogUrl} onChange={(event) => setCatalogUrl(event.target.value)} placeholder={t("plugins.catalogUrl")} />
        </div>
        {status ? <p className="mt-2 text-[11px] text-slate-600">{status}</p> : null}
        {warnings.length > 0 ? <p className="mt-2 text-[11px] text-amber-700">{warnings.join("; ")}</p> : null}
      </div>
      <div className="settings-scrollbar-hidden min-h-0 overflow-auto p-3">
        <div className="grid gap-3 xl:grid-cols-2">
          {filtered.map((plugin) => {
            const installedPlugin = installedById.get(plugin.id);
            return (
              <article key={plugin.id} className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-slate-900">{plugin.name}</h3>
                    <p className="text-[11px] text-slate-500">{plugin.publisher} / {plugin.version}</p>
                  </div>
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[11px]",
                    installedPlugin?.enabled
                      ? "bg-emerald-50 text-emerald-700"
                      : installedPlugin
                        ? "bg-slate-200 text-slate-600"
                        : "bg-white text-slate-500",
                  )}>
                    {installedPlugin?.enabled ? t("plugins.enabled") : installedPlugin ? t("plugins.disabled") : t("plugins.notInstalled")}
                  </span>
                </div>
                <p className="line-clamp-2 text-xs leading-5 text-slate-600">{plugin.description}</p>
                <div className="flex flex-wrap gap-1">
                  {plugin.categories.map((category) => (
                    <span key={category} className="rounded bg-white px-2 py-0.5 text-[11px] text-slate-600">{category}</span>
                  ))}
                </div>
                <p className="truncate text-[11px] text-slate-500">{contributionSummary(plugin)}</p>
                <div className="flex flex-wrap justify-end gap-2">
                  {installedPlugin ? (
                    <>
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void toggle(installedPlugin)}>
                        <Power className="mr-1.5 h-3.5 w-3.5" />
                        {installedPlugin.enabled ? t("plugins.disable") : t("plugins.enable")}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove(plugin.id)}>
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        {t("plugins.uninstall")}
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" disabled={busy} onClick={() => void install(plugin)}>
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      {t("plugins.install")}
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
