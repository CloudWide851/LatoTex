import { AlertTriangle, Download, Info, Power, Trash2 } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";
import type {
  InstalledPlugin,
  PluginCatalogEntry,
  PluginContribution,
  PluginManifest,
  RuntimeAssetStatus,
  ToolchainStatus,
} from "../../../shared/plugins/pluginTypes";
import {
  contributionSummary,
  iconFor,
  issueTone,
  localizedPlugin,
  type TranslationFn,
} from "./pluginMarketplaceUtils";

type RuntimeAction = "install" | "verify" | "remove";

export function PluginMarketplaceCard(props: {
  entry: PluginCatalogEntry;
  installedPlugin: InstalledPlugin | undefined;
  locale: string;
  busy: boolean;
  expanded: boolean;
  toolchainStatus: ToolchainStatus | null;
  runtimeAssetStatus: RuntimeAssetStatus | null;
  toolchain: PluginContribution | undefined;
  runtimeAsset: PluginContribution | undefined;
  onExpandToggle: () => void;
  onInstallPlugin: (entry: PluginCatalogEntry) => void;
  onTogglePlugin: (plugin: InstalledPlugin) => void;
  onRemovePlugin: (pluginId: string) => void;
  onToolchainAction: (pluginId: string, contributionId: string, action: RuntimeAction) => void;
  onRuntimeAssetAction: (pluginId: string, contributionId: string, action: RuntimeAction) => void;
  t: TranslationFn;
}) {
  const {
    entry,
    installedPlugin,
    locale,
    busy,
    expanded,
    toolchainStatus,
    runtimeAssetStatus,
    toolchain,
    runtimeAsset,
    onExpandToggle,
    onInstallPlugin,
    onTogglePlugin,
    onRemovePlugin,
    onToolchainAction,
    onRuntimeAssetAction,
    t,
  } = props;
  const plugin: PluginManifest = entry.manifest;
  const Icon = iconFor(plugin);
  const localized = localizedPlugin(plugin, locale);
  const errorCount = entry.validation.issues.filter((item) => item.severity === "error").length;
  const warningCount = entry.validation.issues.filter((item) => item.severity === "warning").length;
  const toolchainIsProbe = toolchain?.kind === "toolchainProbe";
  const contributionInstalled = Boolean(toolchainStatus?.installed || runtimeAssetStatus?.installed);
  const installedLabel = toolchainStatus?.source === "local" || runtimeAssetStatus?.source === "local"
    ? t("plugins.detectedLocal")
    : runtimeAssetStatus?.source === "bundled"
      ? t("plugins.detectedBundled")
      : t("plugins.enabled");
  const canUseRuntime = entry.sourceId === "builtin" || Boolean(installedPlugin);
  const statusLabel = installedPlugin?.enabled
    ? installedLabel
    : installedPlugin
      ? t("plugins.disabled")
      : contributionInstalled
        ? installedLabel
        : t("plugins.notInstalled");
  const runtimePath = runtimeAssetStatus?.source === "bundled"
    ? runtimeAssetStatus.installPath || runtimeAssetStatus.entryPath || "-"
    : runtimeAssetStatus?.entryPath || runtimeAssetStatus?.installPath || "-";

  return (
    <article className="group grid min-h-[164px] grid-rows-[auto_auto_1fr_auto] overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-soft">
      <div className="flex min-w-0 items-start gap-2 bg-gradient-to-br from-slate-50 to-white p-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-primary-700 shadow-sm">
          {plugin.icon ? (
            <img src={plugin.icon} alt="" className="h-5 w-5 rounded object-contain" />
          ) : (
            <Icon className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-slate-950">{localized.name}</h3>
          <p className="mt-1 truncate text-[11px] text-slate-500">
            {plugin.publisher} / {plugin.version} / {entry.sourceName}
          </p>
        </div>
        <span
          className={cn(
            "max-w-[6.5rem] shrink-0 truncate rounded-full border px-2 py-0.5 text-[10px] font-medium",
            installedPlugin?.enabled || contributionInstalled
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : installedPlugin
                ? "border-slate-200 bg-slate-100 text-slate-600"
                : "border-slate-200 bg-white text-slate-500",
          )}
        >
          {statusLabel}
        </span>
      </div>

      <div className="space-y-1.5 px-2.5 pb-1.5">
        <p className="line-clamp-2 min-h-8 text-xs leading-4 text-slate-600">{localized.description}</p>
        <div className="flex flex-wrap gap-1">
          {localized.categories.slice(0, 2).map((category) => (
            <span key={category} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
              {category}
            </span>
          ))}
          {plugin.permissions.length > 0 ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
              {t("plugins.permissionsCount").replace("{count}", String(plugin.permissions.length))}
            </span>
          ) : null}
        </div>
      </div>

      <div className="space-y-1 px-2.5 pb-1.5">
        <p className="line-clamp-1 text-[11px] text-slate-500">
          {contributionSummary(plugin, locale) || plugin.id}
        </p>
        {toolchain ? (
          <div className="truncate rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[10px] text-slate-600">
            {toolchainStatus?.installed
              ? t(toolchainStatus.source === "local" ? "plugins.toolchain.detected" : "plugins.toolchain.ready").replace("{version}", toolchainStatus.version || toolchainStatus.executablePath || "-")
              : toolchainIsProbe
                ? t("plugins.toolchain.notDetected")
                : t("plugins.toolchain.notInstalled")}
          </div>
        ) : null}
        {runtimeAsset ? (
          <div className="truncate rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[10px] text-slate-600">
            {runtimeAssetStatus?.installed
              ? t(runtimeAssetStatus.source === "bundled"
                ? "plugins.runtimeAsset.bundled"
                : runtimeAssetStatus.source === "local"
                  ? "plugins.runtimeAsset.detected"
                  : "plugins.runtimeAsset.ready").replace("{path}", runtimePath)
              : t("plugins.runtimeAsset.notInstalled")}
          </div>
        ) : null}
        {errorCount > 0 || warningCount > 0 ? (
          <button
            type="button"
            className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px]", errorCount > 0 ? issueTone("error") : issueTone("warning"))}
            onClick={onExpandToggle}
            title={t("plugins.validationDetails")}
          >
            {errorCount > 0 ? <AlertTriangle className="h-3 w-3" /> : <Info className="h-3 w-3" />}
            {errorCount > 0
              ? t("plugins.validationErrors").replace("{count}", String(errorCount))
              : t("plugins.validationWarnings").replace("{count}", String(warningCount))}
          </button>
        ) : (
          <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] text-emerald-700">
            {t("plugins.validationOk")}
          </span>
        )}
        {expanded ? (
          <div className="settings-scrollbar-hidden max-h-24 overflow-auto rounded-lg border border-slate-200 bg-white p-2 text-[11px] text-slate-600">
            {entry.validation.issues.map((item) => (
              <div key={`${item.code}-${item.message}`} className={cn("mb-1 rounded border px-1.5 py-1", issueTone(item.severity))}>
                {item.message}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap justify-end gap-1 border-t border-slate-100 bg-slate-50/70 px-2.5 py-1.5">
        {toolchain ? (
          <>
            <Button size="sm" variant="secondary" disabled={busy || !entry.validation.ok || !canUseRuntime} onClick={() => onToolchainAction(plugin.id, toolchain.id, "verify")}>
              {t("plugins.toolchain.verify")}
            </Button>
            {toolchainIsProbe ? null : toolchainStatus?.installed && toolchainStatus.source === "managed" ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onToolchainAction(plugin.id, toolchain.id, "remove")}>
                {t("plugins.toolchain.remove")}
              </Button>
            ) : !toolchainStatus?.installed ? (
              <Button size="sm" variant="secondary" disabled={busy || !entry.validation.ok || !canUseRuntime} onClick={() => onToolchainAction(plugin.id, toolchain.id, "install")}>
                {t("plugins.toolchain.install")}
              </Button>
            ) : null}
          </>
        ) : null}
        {runtimeAsset ? (
          runtimeAssetStatus?.installed && runtimeAssetStatus.source === "managed" ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRuntimeAssetAction(plugin.id, runtimeAsset.id, "remove")}>
              {t("plugins.runtimeAsset.remove")}
            </Button>
          ) : !runtimeAssetStatus?.installed ? (
            <Button size="sm" variant="secondary" disabled={busy || !entry.validation.ok || !canUseRuntime} onClick={() => onRuntimeAssetAction(plugin.id, runtimeAsset.id, "install")}>
              {t("plugins.runtimeAsset.install")}
            </Button>
          ) : null
        ) : null}
        {installedPlugin ? (
          <>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => onTogglePlugin(installedPlugin)}>
              <Power className="mr-1.5 h-3.5 w-3.5" />
              {installedPlugin.enabled ? t("plugins.disable") : t("plugins.enable")}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRemovePlugin(plugin.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : entry.sourceId !== "builtin" ? (
          <Button size="sm" disabled={busy || !entry.validation.ok} onClick={() => onInstallPlugin(entry)}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            {t("plugins.install")}
          </Button>
        ) : null}
      </div>
    </article>
  );
}
