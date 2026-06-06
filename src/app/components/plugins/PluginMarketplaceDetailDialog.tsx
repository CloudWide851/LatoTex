import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  Download,
  FolderOpen,
  Package,
  Power,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";
import type {
  InstalledPlugin,
  PluginCatalogEntry,
  PluginContribution,
  RuntimeAssetStatus,
  ToolchainStatus,
} from "../../../shared/plugins/pluginTypes";
import {
  describeRuntimeAssetStatus,
  describeToolchainStatus,
  describeValidationIssue,
  iconFor,
  issueTone,
  localizedContribution,
  localizedPlugin,
  type TranslationFn,
} from "./pluginMarketplaceUtils";

type RuntimeAction = "install" | "verify" | "remove";

function permissionHint(permission: string, t: TranslationFn): string {
  const normalized = permission.trim().toLowerCase();
  const key = normalized === "workspace.read"
    ? "plugins.permissionHint.workspaceRead"
    : normalized === "workspace.write"
      ? "plugins.permissionHint.workspaceWrite"
      : normalized === "network.fetch"
        ? "plugins.permissionHint.networkFetch"
        : normalized === "process.spawn"
          ? "plugins.permissionHint.processSpawn"
          : "plugins.permissionHint.generic";
  return t(key as any).replace("{permission}", permission);
}

function DetailField(props: { label: string; value: string | null | undefined }) {
  const value = props.value?.trim();
  if (!value) {
    return null;
  }
  return (
    <div className="min-w-0 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        {props.label}
      </div>
      <div className="mt-1 break-all font-mono text-[11px] text-slate-700">{value}</div>
    </div>
  );
}

export function PluginMarketplaceDetailDialog(props: {
  entry: PluginCatalogEntry;
  installedPlugin: InstalledPlugin | undefined;
  locale: string;
  busy: boolean;
  toolchain: PluginContribution | undefined;
  runtimeAsset: PluginContribution | undefined;
  toolchainStatus: ToolchainStatus | null;
  runtimeAssetStatus: RuntimeAssetStatus | null;
  onClose: () => void;
  onInstallPlugin: (entry: PluginCatalogEntry) => void;
  onTogglePlugin: (plugin: InstalledPlugin) => void;
  onRemovePlugin: (pluginId: string) => void;
  onToolchainAction: (pluginId: string, contributionId: string, action: RuntimeAction) => void;
  onToolchainDirectoryPick: (pluginId: string, contributionId: string) => void;
  onRuntimeAssetAction: (pluginId: string, contributionId: string, action: RuntimeAction) => void;
  t: TranslationFn;
}) {
  const {
    entry,
    installedPlugin,
    locale,
    busy,
    toolchain,
    runtimeAsset,
    toolchainStatus,
    runtimeAssetStatus,
    onClose,
    onInstallPlugin,
    onTogglePlugin,
    onRemovePlugin,
    onToolchainAction,
    onToolchainDirectoryPick,
    onRuntimeAssetAction,
    t,
  } = props;
  const plugin = entry.manifest;
  const localized = localizedPlugin(plugin, locale);
  const Icon = iconFor(plugin);
  const canUseRuntime = entry.sourceId === "builtin" || Boolean(installedPlugin);
  const toolchainIsProbe = toolchain?.kind === "toolchainProbe";
  const toolchainDetail = describeToolchainStatus(toolchain, toolchainStatus, t);
  const runtimeDetail = describeRuntimeAssetStatus(runtimeAssetStatus, t);
  const contributionInstalled = Boolean(toolchainStatus?.installed || runtimeAssetStatus?.installed);
  const installedLabel = toolchainStatus?.source === "local" || runtimeAssetStatus?.source === "local"
    ? t("plugins.detectedLocal")
    : runtimeAssetStatus?.source === "bundled"
      ? t("plugins.detectedBundled")
      : t("plugins.enabled");
  const statusLabel = installedPlugin?.enabled
    ? installedLabel
    : installedPlugin
      ? t("plugins.disabled")
      : contributionInstalled
        ? installedLabel
        : t("plugins.notInstalled");

  return (
    <div className="fixed inset-0 z-[430] flex items-center justify-center bg-slate-900/55 p-4 motion-overlay-enter">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t("plugins.details")}
        className="grid max-h-[86vh] w-full max-w-3xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-soft motion-card-pop motion-panel-glow"
      >
        <header className="flex min-w-0 items-start gap-3 border-b border-slate-200 bg-gradient-to-br from-white via-slate-50 to-primary-50/40 px-4 py-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary-200 bg-white text-primary-700 shadow-sm">
            {plugin.icon ? (
              <img src={plugin.icon} alt="" className="h-7 w-7 rounded object-contain" />
            ) : (
              <Icon className="h-5 w-5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-semibold text-slate-950" title={localized.name}>
                {localized.name}
              </h3>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                {statusLabel}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{localized.description}</p>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-slate-500 hover:bg-white hover:text-slate-900"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="settings-scrollbar-hidden min-h-0 space-y-3 overflow-auto p-4 text-sm">
          <section className="rounded-lg border border-slate-200 bg-white p-3">
            <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              {t("plugins.detail.overview")}
            </h4>
            <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-700">
              {localized.description}
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <DetailField label={t("plugins.detail.pluginId")} value={plugin.id} />
              <DetailField label={t("plugins.detail.source")} value={entry.sourceName} />
              <DetailField label={t("plugins.detail.publisher")} value={plugin.publisher} />
              <DetailField label={t("plugins.detail.version")} value={plugin.version} />
              <DetailField label={t("plugins.detail.homepage")} value={plugin.homepage ?? null} />
              <DetailField label={t("plugins.detail.license")} value={plugin.license ?? null} />
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary-700" />
              <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                {t("plugins.detail.permissions")}
              </h4>
            </div>
            {plugin.permissions.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">{t("plugins.detail.noPermissions")}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {plugin.permissions.map((permission) => (
                  <li key={permission} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
                    <div className="font-mono text-[11px] font-semibold text-slate-800">{permission}</div>
                    <div className="mt-1 text-xs text-slate-600">{permissionHint(permission, t)}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-primary-700" />
              <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                {t("plugins.detail.contributions")}
              </h4>
            </div>
            <ul className="mt-2 space-y-2">
              {plugin.contributions.map((contribution) => {
                const item = localizedContribution(contribution, locale);
                return (
                  <li key={`${contribution.kind}:${contribution.id}`} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate text-xs font-semibold text-slate-800">{item.title}</span>
                      <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[10px] text-slate-500">
                        {contribution.kind}
                      </span>
                    </div>
                    {item.description ? (
                      <p className="mt-1 text-xs leading-5 text-slate-600">{item.description}</p>
                    ) : null}
                    <p className="mt-1 break-all font-mono text-[10px] text-slate-500">{contribution.id}</p>
                  </li>
                );
              })}
            </ul>
          </section>

          {toolchain ? (
            <section className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center gap-2">
                <Code2 className="h-4 w-4 text-primary-700" />
                <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                  {t("plugins.detail.toolchain")}
                </h4>
              </div>
              <p className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
                {toolchainDetail}
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <DetailField label={t("plugins.detail.installPath")} value={toolchainStatus?.installPath} />
                <DetailField label={t("plugins.detail.executablePath")} value={toolchainStatus?.executablePath} />
              </div>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="secondary" disabled={busy || !entry.validation.ok || !canUseRuntime} onClick={() => onToolchainAction(plugin.id, toolchain.id, "verify")}>
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                  {t("plugins.toolchain.verify")}
                </Button>
                {toolchainIsProbe ? null : toolchainStatus?.installed && toolchainStatus.source === "managed" ? (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => onToolchainAction(plugin.id, toolchain.id, "remove")}>
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    {t("plugins.toolchain.remove")}
                  </Button>
                ) : !toolchainStatus?.installed ? (
                  <Button size="sm" variant="secondary" disabled={busy || !entry.validation.ok || !canUseRuntime} onClick={() => onToolchainAction(plugin.id, toolchain.id, "install")}>
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    {t("plugins.toolchain.install")}
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" disabled={busy || !entry.validation.ok || !canUseRuntime} onClick={() => onToolchainDirectoryPick(plugin.id, toolchain.id)}>
                  <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                  {t("plugins.toolchain.pickLocal")}
                </Button>
                {toolchainStatus?.installed && toolchainStatus.source === "local" ? (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => onToolchainAction(plugin.id, toolchain.id, "remove")}>
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    {t("plugins.toolchain.remove")}
                  </Button>
                ) : null}
              </div>
            </section>
          ) : null}

          {runtimeAsset ? (
            <section className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-primary-700" />
                <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                  {t("plugins.detail.runtime")}
                </h4>
              </div>
              <p className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
                {runtimeDetail}
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <DetailField label={t("plugins.detail.installPath")} value={runtimeAssetStatus?.installPath} />
                <DetailField label={t("plugins.detail.entryPath")} value={runtimeAssetStatus?.entryPath} />
              </div>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="secondary" disabled={busy || !entry.validation.ok || !canUseRuntime} onClick={() => onRuntimeAssetAction(plugin.id, runtimeAsset.id, "verify")}>
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                  {t("plugins.toolchain.verify")}
                </Button>
                {runtimeAssetStatus?.installed && runtimeAssetStatus.source === "managed" ? (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRuntimeAssetAction(plugin.id, runtimeAsset.id, "remove")}>
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    {t("plugins.runtimeAsset.remove")}
                  </Button>
                ) : !runtimeAssetStatus?.installed ? (
                  <Button size="sm" variant="secondary" disabled={busy || !entry.validation.ok || !canUseRuntime} onClick={() => onRuntimeAssetAction(plugin.id, runtimeAsset.id, "install")}>
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    {t("plugins.runtimeAsset.install")}
                  </Button>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2">
              {entry.validation.ok ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-700" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-rose-700" />
              )}
              <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                {t("plugins.validationDetails")}
              </h4>
            </div>
            {entry.validation.issues.length === 0 ? (
              <p className="mt-2 text-xs text-emerald-700">{t("plugins.validationOk")}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {entry.validation.issues.map((issue) => (
                  <li key={`${issue.code}:${issue.message}`} className={cn("rounded-md border px-2 py-1.5 text-xs", issueTone(issue.severity))}>
                    <div className="font-mono text-[10px]">{issue.code}</div>
                    <div className="mt-1">{describeValidationIssue(issue, t)}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
          {installedPlugin ? (
            <>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => onTogglePlugin(installedPlugin)}>
                <Power className="mr-1.5 h-3.5 w-3.5" />
                {installedPlugin.enabled ? t("plugins.disable") : t("plugins.enable")}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRemovePlugin(plugin.id)}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                {t("plugins.uninstall")}
              </Button>
            </>
          ) : entry.sourceId !== "builtin" ? (
            <Button size="sm" disabled={busy || !entry.validation.ok} onClick={() => onInstallPlugin(entry)}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {t("plugins.install")}
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
        </footer>
      </section>
    </div>
  );
}
