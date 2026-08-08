import { RefreshCw, Search, Store } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  cancelAgentRuntimeUpdate,
  detectAgentRuntime,
  listAgentRuntimes,
  pickAgentRuntimeExecutable,
  setAgentRuntimeEnabled,
  updateAgentRuntime,
} from "../../../shared/api/agent";
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
  pickToolchainDirectory,
  registerLocalToolchain,
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
import type { AgentRuntimeAction, AgentRuntimeDescriptor, AgentRuntimeId } from "../../../shared/types/agentControl";
import type { InstalledPlugin, PluginCatalogEntry, PluginManifest, RuntimeAssetStatus, ToolchainStatus } from "../../../shared/plugins/pluginTypes";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Select } from "../../../components/ui/select";
import { cn } from "../../../lib/utils";
import { requestAppConfirm } from "../../dialog/appDialogBridge";
import { PluginMarketplaceCard } from "./PluginMarketplaceCard";
import { PluginMarketplaceDetailDialog } from "./PluginMarketplaceDetailDialog";
import { installedPluginForMarketplaceEntry } from "./pluginMarketplaceInstallState";
import {
  HIGH_RISK_PLUGIN_PERMISSIONS,
  localeOf,
  marketplaceEntryMatchesFilters,
  type TranslationFn,
} from "./pluginMarketplaceUtils";
import { notifyPluginsChanged } from "./usePluginFileInterfaces";

const AGENT_RUNTIME_ACTIONS = new Set<AgentRuntimeAction>([
  "detect",
  "select",
  "enable",
  "disable",
  "update",
  "cancel-update",
  "terminal",
  "profiles",
]);

function activeAgentRuntimeAction(
  busyActionId: string | null,
  pluginId: string,
  runtimeId: string | undefined,
): AgentRuntimeAction | null {
  if (!runtimeId || !busyActionId?.startsWith(`${pluginId}:agent-runtime:${runtimeId}:`)) {
    return null;
  }
  const segments = busyActionId.split(":");
  const action = segments[segments.length - 1] as AgentRuntimeAction | undefined;
  return action && AGENT_RUNTIME_ACTIONS.has(action) ? action : null;
}

export function PluginMarketplace(props: {
  settings: AppSettings | null;
  onOpenAgentControl?: () => void;
  onOpenAgentTerminal?: (runtimeId: AgentRuntimeId) => void;
  t: TranslationFn;
}) {
  const { settings, onOpenAgentControl, onOpenAgentTerminal, t } = props;
  const locale = localeOf(settings?.uiPrefs?.language);
  const [query, setQuery] = useState("");
  const [scienceFilter, setScienceFilter] = useState("all");
  const [integrationFilter, setIntegrationFilter] = useState("all");
  const [catalog, setCatalog] = useState<PluginCatalogEntry[]>([]);
  const [installed, setInstalled] = useState<InstalledPlugin[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [toolchains, setToolchains] = useState<ToolchainStatus[]>([]);
  const [runtimeAssets, setRuntimeAssets] = useState<RuntimeAssetStatus[]>([]);
  const [agentRuntimes, setAgentRuntimes] = useState<AgentRuntimeDescriptor[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const catalogSources = useMemo(
    () => (settings?.uiPrefs?.pluginCatalogSources ?? []).filter((source) => source.enabled ?? true),
    [settings?.uiPrefs?.pluginCatalogSources],
  );

  const installedById = useMemo(
    () => new Map(installed.map((item) => [item.manifest.id, item])),
    [installed],
  );
  const filtered = useMemo(() => {
    return catalog.filter(({ manifest, sourceName }) => marketplaceEntryMatchesFilters({
      manifest,
      sourceName,
      locale,
      query,
      scienceFilter,
      integrationFilter,
    }));
  }, [catalog, integrationFilter, locale, query, scienceFilter]);
  const detailEntry = useMemo(
    () => detailKey
      ? catalog.find((entry) => `${entry.sourceId}:${entry.manifest.id}` === detailKey) ?? null
      : null,
    [catalog, detailKey],
  );

  const reload = async () => {
    setRefreshing(true);
    setStatus(null);
    try {
      const [nextCatalog, nextInstalled, nextAgentRuntimes] = await Promise.all([
        getPluginCatalog(catalogSources),
        listInstalledPlugins(),
        listAgentRuntimes().catch(() => []),
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
      setAgentRuntimes(nextAgentRuntimes);
    } catch {
      setStatus(t("plugins.actionFailed"));
    } finally {
      setRefreshing(false);
      setLoaded(true);
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
      const next = await installPlugin(entry.manifest, entry.sourceId);
      setInstalled((prev) => [next, ...prev.filter((item) => item.manifest.id !== entry.manifest.id)]);
      notifyPluginsChanged();
      setStatus(t("plugins.installDisabledDone"));
    } catch {
      setStatus(t("plugins.actionFailed"));
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
      const enabling = !plugin.enabled;
      const approved = new Set(plugin.approvedPermissions ?? []);
      const missingHighRisk = plugin.manifest.permissions.filter(
        (permission) => HIGH_RISK_PLUGIN_PERMISSIONS.has(permission) && !approved.has(permission),
      );
      if (enabling && missingHighRisk.length > 0) {
        const confirmed = await requestAppConfirm({
          title: t("plugins.highRiskEnableConfirm"),
          details: missingHighRisk,
          tone: "permission",
        });
        if (!confirmed) {
          return;
        }
      }
      const next = await setPluginEnabled(
        plugin.manifest.id,
        enabling,
        enabling ? missingHighRisk : [],
      );
      setInstalled((prev) => prev.map((item) => (item.manifest.id === next.manifest.id ? next : item)));
      notifyPluginsChanged();
    } catch {
      setStatus(t("plugins.actionFailed"));
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
      notifyPluginsChanged();
      setStatus(t("plugins.uninstallDone"));
    } catch {
      setStatus(t("plugins.actionFailed"));
    } finally {
      setBusyActionId(null);
    }
  };

  const toolchainFor = (plugin: PluginManifest) => plugin.contributions.find((item) => item.kind === "toolchainInstaller" || item.kind === "toolchainProbe");
  const runtimeAssetFor = (plugin: PluginManifest) => plugin.contributions.find((item) => item.kind === "runtimeAsset");
  const agentRuntimeFor = (plugin: PluginManifest) => plugin.contributions.find((item) => item.agentRuntimeDetector);
  const toolchainStatusFor = (pluginId: string, contributionId: string) =>
    toolchains.find((item) => item.pluginId === pluginId && item.contributionId === contributionId);
  const runtimeAssetStatusFor = (pluginId: string, contributionId: string) =>
    runtimeAssets.find((item) => item.pluginId === pluginId && item.contributionId === contributionId);
  const agentRuntimeStatusFor = (runtimeId: string) =>
    agentRuntimes.find((item) => item.id === runtimeId);

  const replaceAgentRuntime = (next: AgentRuntimeDescriptor) => {
    setAgentRuntimes((current) => [
      next,
      ...current.filter((item) => item.id !== next.id),
    ]);
  };

  const runAgentRuntimeAction = async (
    pluginId: string,
    runtimeId: AgentRuntimeId,
    action: AgentRuntimeAction,
  ) => {
    if (action === "profiles") {
      onOpenAgentControl?.();
      return;
    }
    if (action === "terminal") {
      onOpenAgentTerminal?.(runtimeId);
      return;
    }
    if (action === "cancel-update") {
      try {
        await cancelAgentRuntimeUpdate(runtimeId);
        setStatus(t("plugins.agentRuntime.cancelUpdateDone"));
      } catch {
        setStatus(t("plugins.actionFailed"));
      }
      return;
    }
    if (busyActionId) return;
    setBusyActionId(`${pluginId}:agent-runtime:${runtimeId}:${action}`);
    try {
      const next = action === "detect"
        ? await detectAgentRuntime(runtimeId)
        : action === "select"
          ? await pickAgentRuntimeExecutable(runtimeId)
          : action === "update"
            ? await updateAgentRuntime(runtimeId)
            : await setAgentRuntimeEnabled(runtimeId, action === "enable");
      if (next) replaceAgentRuntime(next);
      if (next || action !== "select") setStatus(t(`plugins.agentRuntime.${action}Done`));
    } catch (error) {
      setStatus(String(error).includes("agent.runtime.update_cancelled")
        ? t("plugins.agentRuntime.updateCancelled")
        : t("plugins.actionFailed"));
    } finally {
      setBusyActionId(null);
    }
  };

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
    } catch {
      setStatus(t("plugins.actionFailed"));
    } finally {
      setBusyActionId(null);
    }
  };

  const chooseToolchainDirectory = async (pluginId: string, contributionId: string) => {
    if (busyActionId) {
      return;
    }
    setBusyActionId(`${pluginId}:toolchain:${contributionId}:local`);
    try {
      const rootDir = await pickToolchainDirectory();
      if (!rootDir) {
        return;
      }
      const next = await registerLocalToolchain(pluginId, contributionId, rootDir);
      setToolchains((prev) => [next, ...prev.filter((item) => item.pluginId !== pluginId || item.contributionId !== contributionId)]);
      setStatus(t("plugins.toolchain.localDone"));
    } catch {
      setStatus(t("plugins.actionFailed"));
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
    } catch {
      setStatus(t("plugins.actionFailed"));
    } finally {
      setBusyActionId(null);
    }
  };

  const showInitialLoading = refreshing && !loaded && catalog.length === 0;

  return (
    <>
    <section className="app-material-panel grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border">
      <div className="app-material-content border-b p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="app-material-inset flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-[color:var(--app-accent)]">
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
            <Input className="app-material-inset h-9 rounded-full pl-9 text-xs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("plugins.search")} />
          </label>
          <Select
            uiSize="sm"
            wrapperClassName="w-44"
            value={scienceFilter}
            onChange={(event) => setScienceFilter(event.target.value)}
            aria-label={t("plugins.filter.category")}
          >
            <option value="all">{t("plugins.filter.all")}</option>
            <option value="research">{t("plugins.filter.research")}</option>
            <option value="statistics">{t("plugins.filter.statistics")}</option>
            <option value="computing">{t("plugins.filter.computing")}</option>
            <option value="publishing">{t("plugins.filter.publishing")}</option>
            <option value="connectors">{t("plugins.filter.connectors")}</option>
          </Select>
          <Select
            uiSize="sm"
            wrapperClassName="w-44"
            value={integrationFilter}
            onChange={(event) => setIntegrationFilter(event.target.value)}
            aria-label={t("plugins.filter.integration")}
          >
            <option value="all">{t("plugins.filter.integrationAll")}</option>
            <option value="full">{t("plugins.integration.full")}</option>
            <option value="controlled">{t("plugins.integration.controlled")}</option>
            <option value="connector">{t("plugins.integration.connector")}</option>
          </Select>
          <span className="app-material-inset rounded-full border px-3 py-1.5 text-[11px] text-slate-500">
            {t("plugins.sourcesSummary").replace("{count}", String(catalogSources.length + 1))}
          </span>
        </div>
        {status ? <p className="mt-2 text-[11px] text-slate-600">{status}</p> : null}
        {warnings.length > 0 ? <p className="mt-2 text-[11px] text-amber-700">{warnings.join("; ")}</p> : null}
      </div>
      <div className="app-material-content settings-scrollbar-hidden min-h-0 overflow-auto p-4">
        {showInitialLoading ? (
          <div className="app-material-inset flex h-full min-h-[240px] items-center justify-center rounded-xl border border-dashed border-primary-200 px-4 text-sm text-slate-600">
            <div className="flex items-center gap-3">
              <RefreshCw className="h-4 w-4 animate-spin text-primary-700" />
              <span>{t("plugins.loading")}</span>
              <span className="flex gap-1" aria-hidden>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary-500" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary-500 [animation-delay:120ms]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary-500 [animation-delay:240ms]" />
              </span>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="app-material-inset flex h-full min-h-[240px] items-center justify-center rounded-xl border border-dashed px-4 text-sm text-slate-500">
            {t("plugins.empty")}
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((entry) => {
            const plugin = entry.manifest;
            const installedPlugin = installedPluginForMarketplaceEntry(entry, installedById);
            const toolchain = toolchainFor(plugin);
            const runtimeAsset = runtimeAssetFor(plugin);
            const toolchainStatus = toolchain ? toolchainStatusFor(plugin.id, toolchain.id) : null;
            const runtimeAssetStatus = runtimeAsset ? runtimeAssetStatusFor(plugin.id, runtimeAsset.id) : null;
            const agentRuntime = agentRuntimeFor(plugin);
            const agentRuntimeStatus = agentRuntime?.agentRuntimeDetector
              ? agentRuntimeStatusFor(agentRuntime.agentRuntimeDetector.runtimeId)
              : null;
            return (
              <PluginMarketplaceCard
                key={`${entry.sourceId}:${plugin.id}`}
                entry={entry}
                installedPlugin={installedPlugin}
                locale={locale}
                busy={Boolean(busyActionId?.startsWith(`${plugin.id}:`))}
                activeAgentRuntimeAction={activeAgentRuntimeAction(
                  busyActionId,
                  plugin.id,
                  agentRuntime?.agentRuntimeDetector?.runtimeId,
                )}
                toolchainStatus={toolchainStatus ?? null}
                runtimeAssetStatus={runtimeAssetStatus ?? null}
                toolchain={toolchain}
                runtimeAsset={runtimeAsset}
                agentRuntime={agentRuntime}
                agentRuntimeStatus={agentRuntimeStatus ?? null}
                onDetailsOpen={() => setDetailKey(`${entry.sourceId}:${plugin.id}`)}
                onInstallPlugin={(item) => void install(item)}
                onTogglePlugin={(item) => void toggle(item)}
                onRemovePlugin={(pluginId) => void remove(pluginId)}
                onToolchainAction={(pluginId, contributionId, action) => void runToolchainAction(pluginId, contributionId, action)}
                onRuntimeAssetAction={(pluginId, contributionId, action) => void runRuntimeAssetAction(pluginId, contributionId, action)}
                onAgentRuntimeAction={(pluginId, runtimeId, action) => void runAgentRuntimeAction(pluginId, runtimeId, action)}
                t={t}
              />
            );
            })}
          </div>
        )}
      </div>
    </section>
    {detailEntry ? (() => {
      const plugin = detailEntry.manifest;
      const installedPlugin = installedPluginForMarketplaceEntry(detailEntry, installedById);
      const toolchain = toolchainFor(plugin);
      const runtimeAsset = runtimeAssetFor(plugin);
      const toolchainStatus = toolchain ? toolchainStatusFor(plugin.id, toolchain.id) : null;
      const runtimeAssetStatus = runtimeAsset ? runtimeAssetStatusFor(plugin.id, runtimeAsset.id) : null;
      const agentRuntime = agentRuntimeFor(plugin);
      const agentRuntimeStatus = agentRuntime?.agentRuntimeDetector
        ? agentRuntimeStatusFor(agentRuntime.agentRuntimeDetector.runtimeId)
        : null;
      return (
        <PluginMarketplaceDetailDialog
          entry={detailEntry}
          installedPlugin={installedPlugin}
          locale={locale}
          busy={Boolean(busyActionId?.startsWith(`${plugin.id}:`))}
          activeAgentRuntimeAction={activeAgentRuntimeAction(
            busyActionId,
            plugin.id,
            agentRuntime?.agentRuntimeDetector?.runtimeId,
          )}
          toolchain={toolchain}
          runtimeAsset={runtimeAsset}
          agentRuntime={agentRuntime}
          agentRuntimeStatus={agentRuntimeStatus ?? null}
          toolchainStatus={toolchainStatus ?? null}
          runtimeAssetStatus={runtimeAssetStatus ?? null}
          onClose={() => setDetailKey(null)}
          onInstallPlugin={(item) => void install(item)}
          onTogglePlugin={(item) => void toggle(item)}
          onRemovePlugin={(pluginId) => void remove(pluginId)}
          onToolchainAction={(pluginId, contributionId, action) => void runToolchainAction(pluginId, contributionId, action)}
          onToolchainDirectoryPick={(pluginId, contributionId) => void chooseToolchainDirectory(pluginId, contributionId)}
          onRuntimeAssetAction={(pluginId, contributionId, action) => void runRuntimeAssetAction(pluginId, contributionId, action)}
          onAgentRuntimeAction={(pluginId, runtimeId, action) => void runAgentRuntimeAction(pluginId, runtimeId, action)}
          t={t}
        />
      );
    })() : null}
    </>
  );
}
