import {
  AlertTriangle,
  Download,
  FileText,
  Info,
  Network,
  Package,
  Power,
  Puzzle,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
} from "lucide-react";
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

type TranslationFn = (key: any) => string;

function contributionSummary(plugin: PluginManifest): string {
  return plugin.contributions.map((item) => item.title).filter(Boolean).join(", ");
}

function iconFor(plugin: PluginManifest) {
  const categories = plugin.categories.join(" ").toLowerCase();
  const kinds = plugin.contributions.map((item) => item.kind).join(" ").toLowerCase();
  if (categories.includes("office") || kinds.includes("docx")) {
    return FileText;
  }
  if (kinds.includes("mcp") || categories.includes("mcp")) {
    return Network;
  }
  if (plugin.permissions.some((item) => item.includes("write") || item.includes("shell"))) {
    return ShieldAlert;
  }
  if (kinds.includes("command")) {
    return Puzzle;
  }
  return Package;
}

function issueTone(severity: string): string {
  if (severity === "error") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (severity === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export function PluginMarketplace(props: {
  settings: AppSettings | null;
  t: TranslationFn;
}) {
  const { settings, t } = props;
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<PluginCatalogEntry[]>([]);
  const [installed, setInstalled] = useState<InstalledPlugin[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [toolchains, setToolchains] = useState<ToolchainStatus[]>([]);
  const [runtimeAssets, setRuntimeAssets] = useState<RuntimeAssetStatus[]>([]);
  const [busy, setBusy] = useState(false);
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
    return catalog.filter(({ manifest, sourceName }) =>
      [
        manifest.name,
        manifest.displayName ?? "",
        manifest.publisher,
        manifest.description,
        manifest.id,
        sourceName,
        manifest.categories.join(" "),
      ]
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
      setBusy(false);
    }
  };

  useEffect(() => {
    void reload();
  }, [catalogSources]);

  const install = async (entry: PluginCatalogEntry) => {
    if (!entry.validation.ok) {
      setStatus(t("plugins.installBlocked"));
      return;
    }
    setBusy(true);
    try {
      const next = await installPlugin(entry.manifest);
      setInstalled((prev) => [next, ...prev.filter((item) => item.manifest.id !== entry.manifest.id)]);
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
    setBusy(true);
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
      setBusy(false);
    }
  };

  const runRuntimeAssetAction = async (
    pluginId: string,
    contributionId: string,
    action: "install" | "verify" | "remove",
  ) => {
    setBusy(true);
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
        <label className="relative mt-3 block max-w-xl">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <Input className="h-9 pl-8 text-xs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("plugins.search")} />
        </label>
        <p className="mt-2 text-[11px] text-slate-500">
          {t("plugins.sourcesSummary").replace("{count}", String(catalogSources.length + 1))}
        </p>
        {status ? <p className="mt-2 text-[11px] text-slate-600">{status}</p> : null}
        {warnings.length > 0 ? <p className="mt-2 text-[11px] text-amber-700">{warnings.join("; ")}</p> : null}
      </div>
      <div className="settings-scrollbar-hidden min-h-0 overflow-auto p-3">
        <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
          {filtered.map((entry) => {
            const plugin = entry.manifest;
            const installedPlugin = installedById.get(plugin.id);
            const Icon = iconFor(plugin);
            const errorCount = entry.validation.issues.filter((item) => item.severity === "error").length;
            const warningCount = entry.validation.issues.filter((item) => item.severity === "warning").length;
            const expanded = expandedId === plugin.id;
            const toolchain = toolchainFor(plugin);
            const runtimeAsset = runtimeAssetFor(plugin);
            const toolchainIsProbe = toolchain?.kind === "toolchainProbe";
            const toolchainStatus = toolchain ? toolchainStatusFor(plugin.id, toolchain.id) : null;
            const runtimeAssetStatus = runtimeAsset ? runtimeAssetStatusFor(plugin.id, runtimeAsset.id) : null;
            const canUseRuntime = entry.sourceId === "builtin" || Boolean(installedPlugin);
            return (
              <article key={`${entry.sourceId}:${plugin.id}`} className="grid gap-2 rounded-md border border-slate-200 bg-slate-50/80 p-2.5">
                <div className="flex min-w-0 items-start gap-2">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600">
                    {plugin.icon ? (
                      <img src={plugin.icon} alt="" className="h-5 w-5 rounded object-contain" />
                    ) : (
                      <Icon className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold text-slate-900">{plugin.displayName || plugin.name}</h3>
                    <p className="truncate text-[11px] text-slate-500">{plugin.publisher} / {plugin.version} / {entry.sourceName}</p>
                  </div>
                  <span className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px]",
                    installedPlugin?.enabled
                      ? "bg-emerald-50 text-emerald-700"
                      : installedPlugin
                        ? "bg-slate-200 text-slate-600"
                        : "bg-white text-slate-500",
                  )}>
                    {installedPlugin?.enabled ? t("plugins.enabled") : installedPlugin ? t("plugins.disabled") : t("plugins.notInstalled")}
                  </span>
                </div>
                <p className="line-clamp-2 min-h-9 text-xs leading-[18px] text-slate-600">{plugin.description}</p>
                <div className="flex flex-wrap gap-1">
                  {plugin.categories.slice(0, 3).map((category) => (
                    <span key={category} className="rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-600">{category}</span>
                  ))}
                  {plugin.permissions.length > 0 ? (
                    <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-600">
                      {t("plugins.permissionsCount").replace("{count}", String(plugin.permissions.length))}
                    </span>
                  ) : null}
                  {errorCount > 0 || warningCount > 0 ? (
                    <button
                      type="button"
                      className={cn(
                        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px]",
                        errorCount > 0 ? issueTone("error") : issueTone("warning"),
                      )}
                      onClick={() => setExpandedId(expanded ? null : plugin.id)}
                      title={t("plugins.validationDetails")}
                    >
                      {errorCount > 0 ? <AlertTriangle className="h-3 w-3" /> : <Info className="h-3 w-3" />}
                      {errorCount > 0
                        ? t("plugins.validationErrors").replace("{count}", String(errorCount))
                        : t("plugins.validationWarnings").replace("{count}", String(warningCount))}
                    </button>
                  ) : (
                    <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
                      {t("plugins.validationOk")}
                    </span>
                  )}
                </div>
                <p className="truncate text-[11px] text-slate-500">{contributionSummary(plugin) || plugin.id}</p>
                {toolchain ? (
                  <div className="rounded border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-600">
                      {toolchainStatus?.installed
                        ? t("plugins.toolchain.ready").replace("{version}", toolchainStatus.version || toolchainStatus.executablePath || "-")
                        : toolchainIsProbe
                          ? t("plugins.toolchain.notDetected")
                          : t("plugins.toolchain.notInstalled")}
                  </div>
                ) : null}
                {runtimeAsset ? (
                  <div className="rounded border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-600">
                    {runtimeAssetStatus?.installed
                      ? t("plugins.runtimeAsset.ready").replace("{path}", runtimeAssetStatus.entryPath || "-")
                      : t("plugins.runtimeAsset.notInstalled")}
                  </div>
                ) : null}
                {expanded ? (
                  <div className="settings-scrollbar-hidden max-h-24 overflow-auto rounded border border-slate-200 bg-white p-2 text-[11px] text-slate-600">
                    {entry.validation.issues.map((item) => (
                      <div key={`${item.code}-${item.message}`} className={cn("mb-1 rounded border px-1.5 py-1", issueTone(item.severity))}>
                        {item.message}
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="flex flex-wrap justify-end gap-1">
                  {toolchain ? (
                    <>
                      <Button size="sm" variant="secondary" disabled={busy || !entry.validation.ok || !canUseRuntime} onClick={() => void runToolchainAction(plugin.id, toolchain.id, "verify")}>
                        {t("plugins.toolchain.verify")}
                      </Button>
                      {toolchainIsProbe ? null : toolchainStatus?.installed ? (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void runToolchainAction(plugin.id, toolchain.id, "remove")}>
                          {t("plugins.toolchain.remove")}
                        </Button>
                      ) : (
                        <Button size="sm" variant="secondary" disabled={busy || !entry.validation.ok || !canUseRuntime} onClick={() => void runToolchainAction(plugin.id, toolchain.id, "install")}>
                          {t("plugins.toolchain.install")}
                        </Button>
                      )}
                    </>
                  ) : null}
                  {runtimeAsset ? (
                    runtimeAssetStatus?.installed ? (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void runRuntimeAssetAction(plugin.id, runtimeAsset.id, "remove")}>
                        {t("plugins.runtimeAsset.remove")}
                      </Button>
                    ) : (
                      <Button size="sm" variant="secondary" disabled={busy || !entry.validation.ok || !canUseRuntime} onClick={() => void runRuntimeAssetAction(plugin.id, runtimeAsset.id, "install")}>
                        {t("plugins.runtimeAsset.install")}
                      </Button>
                    )
                  ) : null}
                  {installedPlugin ? (
                    <>
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void toggle(installedPlugin)}>
                        <Power className="mr-1.5 h-3.5 w-3.5" />
                        {installedPlugin.enabled ? t("plugins.disable") : t("plugins.enable")}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove(plugin.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" disabled={busy || !entry.validation.ok} onClick={() => void install(entry)}>
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
