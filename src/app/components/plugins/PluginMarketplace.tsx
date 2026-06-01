import { RefreshCw, Search, Store } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  getPluginCatalog,
  installPlugin,
  listInstalledPlugins,
  setPluginEnabled,
  uninstallPlugin,
} from "../../../shared/api/plugins";
import {
  installToolchain,
  listToolchains,
  removeToolchain,
  verifyToolchain,
} from "../../../shared/api/toolchains";
import {
  installRuntimeAsset,
  listRuntimeAssets,
  removeRuntimeAsset,
  verifyRuntimeAsset,
} from "../../../shared/api/runtimeAssets";
import type { AppSettings } from "../../../shared/types/app";
import type { InstalledPlugin, PluginCatalogEntry, PluginManifest, RuntimeAssetStatus, ToolchainStatus } from "../../../shared/plugins/pluginTypes";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { cn } from "../../../lib/utils";
import { PluginMarketplaceCard } from "./PluginMarketplaceCard";
import { localeOf, localizedPlugin, type TranslationFn } from "./pluginMarketplaceUtils";

export function PluginMarketplace(props: {
  settings: AppSettings | null;
  t: TranslationFn;
}) {
  const { settings, t } = props;
  const locale = localeOf(settings?.uiPrefs?.language);
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<PluginCatalogEntry[]>([]);
  const [installed, setInstalled] = useState<InstalledPlugin[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [toolchains, setToolchains] = useState<ToolchainStatus[]>([]);
  const [runtimeAssets, setRuntimeAssets] = useState<RuntimeAssetStatus[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const catalogSources = useMemo(
    () => (settings?.uiPrefs?.pluginCatalogSources ?? []).filter((source) => source.enabled ?? true),
    [settings?.uiPrefs?.pluginCatalogSources],
  );

  const installedById = useMemo(
    () => new Map(installed.map((item) => [item.manifest.id, item])),
    [installed],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return catalog;
    }
    return catalog.filter(({ manifest, sourceName }) => {
      const localized = localizedPlugin(manifest, locale);
      return [
        localized.name,
        localized.description,
        localized.categories.join(" "),
        localized.keywords.join(" "),
        manifest.name,
        manifest.displayName ?? "",
        manifest.publisher,
        manifest.description,
        manifest.id,
        sourceName,
        manifest.categories.join(" "),
        (manifest.keywords ?? []).join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [catalog, locale, query]);

  const reload = async () => {
    setRefreshing(true);
    setStatus(null);
    try {
      const [nextCatalog, nextInstalled] = await Promise.all([
        getPluginCatalog(catalogSources),
        listInstalledPlugins(),
      ]);
      const [nextToolchains, nextRuntimeAssets] = await Promise.all([
        listToolchains().catch(() => []),
        listRuntimeAssets().catch(() => []),
      ]);
      setCatalog(nextCatalog.items);
      setWarnings(nextCatalog.warnings);
      setInstalled(nextInstalled);
      setToolchains(nextToolchains);
      setRuntimeAssets(nextRuntimeAssets);
    } catch (error) {
      setStatus(String(error));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void reload();
  }, [catalogSources]);

  const install = async (entry: PluginCatalogEntry) => {
    if (busyActionId) {
      return;
    }
    if (!entry.validation.ok) {
      setStatus(t("plugins.installBlocked"));
      return;
    }
    setBusyActionId(`${entry.manifest.id}:install`);
    try {
      const next = await installPlugin(entry.manifest);
      setInstalled((prev) => [next, ...prev.filter((item) => item.manifest.id !== entry.manifest.id)]);
      setStatus(t("plugins.installDone"));
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusyActionId(null);
    }
  };

  const toggle = async (plugin: InstalledPlugin) => {
    if (busyActionId) {
      return;
    }
    setBusyActionId(`${plugin.manifest.id}:toggle`);
    try {
      const next = await setPluginEnabled(plugin.manifest.id, !plugin.enabled);
      setInstalled((prev) => prev.map((item) => (item.manifest.id === next.manifest.id ? next : item)));
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusyActionId(null);
    }
  };

  const remove = async (pluginId: string) => {
    if (busyActionId) {
      return;
    }
    setBusyActionId(`${pluginId}:remove`);
    try {
      await uninstallPlugin(pluginId);
      setInstalled((prev) => prev.filter((item) => item.manifest.id !== pluginId));
      setStatus(t("plugins.uninstallDone"));
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusyActionId(null);
    }
  };

  const toolchainFor = (plugin: PluginManifest) => plugin.contributions.find((item) => item.kind === "toolchainInstaller" || item.kind === "toolchainProbe");
  const runtimeAssetFor = (plugin: PluginManifest) => plugin.contributions.find((item) => item.kind === "runtimeAsset");
  const toolchainStatusFor = (pluginId: string, contributionId: string) =>
    toolchains.find((item) => item.pluginId === pluginId && item.contributionId === contributionId);
  const runtimeAssetStatusFor = (pluginId: string, contributionId: string) =>
    runtimeAssets.find((item) => item.pluginId === pluginId && item.contributionId === contributionId);

  const runToolchainAction = async (
    pluginId: string,
    contributionId: string,
    action: "install" | "verify" | "remove",
  ) => {
    if (busyActionId) {
      return;
    }
    setBusyActionId(`${pluginId}:toolchain:${contributionId}:${action}`);
    try {
      const next = action === "install"
        ? await installToolchain(pluginId, contributionId)
        : action === "verify"
          ? await verifyToolchain(pluginId, contributionId)
          : await removeToolchain(pluginId, contributionId);
      setToolchains((prev) => [next, ...prev.filter((item) => item.pluginId !== pluginId || item.contributionId !== contributionId)]);
      setStatus(t(`plugins.toolchain.${action}Done`));
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusyActionId(null);
    }
  };

  const runRuntimeAssetAction = async (
    pluginId: string,
    contributionId: string,
    action: "install" | "verify" | "remove",
  ) => {
    if (busyActionId) {
      return;
    }
    setBusyActionId(`${pluginId}:runtime:${contributionId}:${action}`);
    try {
      const next = action === "install"
        ? await installRuntimeAsset(pluginId, contributionId)
        : action === "verify"
          ? await verifyRuntimeAsset(pluginId, contributionId)
          : await removeRuntimeAsset(pluginId, contributionId);
      setRuntimeAssets((prev) => [next, ...prev.filter((item) => item.pluginId !== pluginId || item.contributionId !== contributionId)]);
      setStatus(t(`plugins.runtimeAsset.${action}Done`));
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusyActionId(null);
    }
  };

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-soft">
      <div className="border-b border-slate-200 bg-gradient-to-br from-white via-slate-50 to-primary-50/40 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary-200 bg-white text-primary-700 shadow-sm">
              <Store className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-slate-950">{t("plugins.title")}</h2>
              <p className="mt-1 max-w-2xl text-sm leading-5 text-slate-600">{t("plugins.subtitle")}</p>
            </div>
          </div>
          <Button size="sm" variant="secondary" disabled={refreshing || Boolean(busyActionId)} onClick={() => void reload()}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", refreshing && "animate-spin")} />
            {t("plugins.refresh")}
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="relative block min-w-[240px] max-w-xl flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <Input className="h-9 rounded-full border-slate-200 bg-white pl-9 text-xs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("plugins.search")} />
          </label>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] text-slate-500">
            {t("plugins.sourcesSummary").replace("{count}", String(catalogSources.length + 1))}
          </span>
        </div>
        {status ? <p className="mt-2 text-[11px] text-slate-600">{status}</p> : null}
        {warnings.length > 0 ? <p className="mt-2 text-[11px] text-amber-700">{warnings.join("; ")}</p> : null}
      </div>
      <div className="settings-scrollbar-hidden min-h-0 overflow-auto bg-slate-50/70 p-4">
        {filtered.length === 0 ? (
          <div className="flex h-full min-h-[240px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-4 text-sm text-slate-500">
            {t("plugins.empty")}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filtered.map((entry) => {
            const plugin = entry.manifest;
            const installedPlugin = installedById.get(plugin.id);
            const expanded = expandedId === plugin.id;
            const toolchain = toolchainFor(plugin);
            const runtimeAsset = runtimeAssetFor(plugin);
            const toolchainStatus = toolchain ? toolchainStatusFor(plugin.id, toolchain.id) : null;
            const runtimeAssetStatus = runtimeAsset ? runtimeAssetStatusFor(plugin.id, runtimeAsset.id) : null;
            return (
              <PluginMarketplaceCard
                key={`${entry.sourceId}:${plugin.id}`}
                entry={entry}
                installedPlugin={installedPlugin}
                locale={locale}
                busy={Boolean(busyActionId?.startsWith(`${plugin.id}:`))}
                expanded={expanded}
                toolchainStatus={toolchainStatus ?? null}
                runtimeAssetStatus={runtimeAssetStatus ?? null}
                toolchain={toolchain}
                runtimeAsset={runtimeAsset}
                onExpandToggle={() => setExpandedId(expanded ? null : plugin.id)}
                onInstallPlugin={(item) => void install(item)}
                onTogglePlugin={(item) => void toggle(item)}
                onRemovePlugin={(pluginId) => void remove(pluginId)}
                onToolchainAction={(pluginId, contributionId, action) => void runToolchainAction(pluginId, contributionId, action)}
                onRuntimeAssetAction={(pluginId, contributionId, action) => void runRuntimeAssetAction(pluginId, contributionId, action)}
                t={t}
              />
            );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
