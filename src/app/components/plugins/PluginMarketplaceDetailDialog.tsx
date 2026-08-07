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
import { AppDialog } from "../../../components/ui/dialog";
import { cn } from "../../../lib/utils";
import type {
  InstalledPlugin,
  PluginCatalogEntry,
  PluginContribution,
  RuntimeAssetStatus,
  ToolchainStatus,
} from "../../../shared/plugins/pluginTypes";
import type { AgentRuntimeAction, AgentRuntimeDescriptor, AgentRuntimeId } from "../../../shared/types/agentControl";
import {
  describeRuntimeAssetStatus,
  describeToolchainStatus,
  describeValidationIssue,
  iconFor,
  integrationLevelLabel,
  integrityPolicyLabel,
  issueTone,
  localizedContribution,
  localizedPlugin,
  runtimeSourceLabel,
  telemetryPolicyLabel,
  type TranslationFn,
} from "./pluginMarketplaceUtils";

type RuntimeAction = "install" | "verify" | "remove";

function agentRuntimeStatusLabel(runtime: AgentRuntimeDescriptor | null, t: TranslationFn): string {
  if (!runtime?.available) return t("agents.runtime.unavailable");
  if (!runtime.enabled) return t("agents.runtime.disabled");
  if (!runtime.authenticated) return t("agents.runtime.authRequired");
  return t("agents.runtime.ready");
}

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

function trustStateLabel(state: string | null | undefined, t: TranslationFn): string | null {
  if (!state) {
    return null;
  }
  const key = state === "builtin_trusted"
    ? "plugins.detail.trust.builtin"
    : state === "user_approved"
      ? "plugins.detail.trust.userApproved"
      : state === "legacy_unverified"
        ? "plugins.detail.trust.legacy"
        : "plugins.detail.trust.catalog";
  return t(key as any);
}

export function PluginMarketplaceDetailDialog(props: {
  entry: PluginCatalogEntry;
  installedPlugin: InstalledPlugin | undefined;
  locale: string;
  busy: boolean;
  activeAgentRuntimeAction: AgentRuntimeAction | null;
  toolchain: PluginContribution | undefined;
  runtimeAsset: PluginContribution | undefined;
  agentRuntime: PluginContribution | undefined;
  toolchainStatus: ToolchainStatus | null;
  runtimeAssetStatus: RuntimeAssetStatus | null;
  agentRuntimeStatus: AgentRuntimeDescriptor | null;
  onClose: () => void;
  onInstallPlugin: (entry: PluginCatalogEntry) => void;
  onTogglePlugin: (plugin: InstalledPlugin) => void;
  onRemovePlugin: (pluginId: string) => void;
  onToolchainAction: (pluginId: string, contributionId: string, action: RuntimeAction) => void;
  onToolchainDirectoryPick: (pluginId: string, contributionId: string) => void;
  onRuntimeAssetAction: (pluginId: string, contributionId: string, action: RuntimeAction) => void;
  onAgentRuntimeAction: (pluginId: string, runtimeId: AgentRuntimeId, action: AgentRuntimeAction) => void;
  t: TranslationFn;
}) {
  const {
    entry,
    installedPlugin,
    locale,
    busy,
    activeAgentRuntimeAction,
    toolchain,
    runtimeAsset,
    agentRuntime,
    toolchainStatus,
    runtimeAssetStatus,
    agentRuntimeStatus,
    onClose,
    onInstallPlugin,
    onTogglePlugin,
    onRemovePlugin,
    onToolchainAction,
    onToolchainDirectoryPick,
    onRuntimeAssetAction,
    onAgentRuntimeAction,
    t,
  } = props;
  const plugin = entry.manifest;
  const localized = localizedPlugin(plugin, locale);
  const Icon = iconFor(plugin);
  const canUseRuntime = entry.sourceId === "builtin" || Boolean(installedPlugin);
  const toolchainIsProbe = toolchain?.kind === "toolchainProbe";
  const toolchainDetail = describeToolchainStatus(toolchain, toolchainStatus, t);
  const runtimeDetail = describeRuntimeAssetStatus(runtimeAssetStatus, t);
  const agentRuntimeReady = Boolean(
    agentRuntimeStatus?.enabled
      && agentRuntimeStatus.available
      && agentRuntimeStatus.authenticated,
  );
  const agentRuntimeUpdating = activeAgentRuntimeAction === "update";
  const contributionInstalled = Boolean(toolchainStatus?.installed || runtimeAssetStatus?.installed);
  const installedLabel = toolchainStatus?.source === "local" || runtimeAssetStatus?.source === "local"
    ? t("plugins.detectedLocal")
    : runtimeAssetStatus?.source === "bundled"
      ? t("plugins.detectedBundled")
      : t("plugins.enabled");
  const statusLabel = agentRuntime
    ? agentRuntimeStatusLabel(agentRuntimeStatus, t)
    : installedPlugin?.enabled
    ? installedLabel
    : installedPlugin
      ? t("plugins.disabled")
      : contributionInstalled
        ? installedLabel
        : t("plugins.notInstalled");

  return (
    <AppDialog
      onClose={onClose}
      ariaLabel={t("plugins.details")}
      className="app-material-floating grid max-h-[86vh] w-full max-w-3xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-xl motion-card-pop motion-panel-glow"
    >
        <header className="app-material-content flex min-w-0 items-start gap-3 border-b px-4 py-3">
          <div className="app-material-inset flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-[color:var(--app-accent)]">
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
          <section className="app-material-inset rounded-lg border p-3">
            <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              {t("plugins.detail.overview")}
            </h4>
            <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-700">
              {localized.description}
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <DetailField label={t("plugins.detail.pluginId")} value={plugin.id} />
              <DetailField label={t("plugins.detail.source")} value={entry.sourceName} />
              <DetailField
                label={t("plugins.detail.trustState")}
                value={trustStateLabel(installedPlugin?.trustState, t)}
              />
              <DetailField
                label={t("plugins.detail.integrity")}
                value={installedPlugin
                  ? installedPlugin.integrityVerified
                    ? t("plugins.detail.integrityVerified")
                    : t("plugins.detail.integrityUnverified")
                  : null}
              />
              <DetailField label={t("plugins.detail.publisher")} value={plugin.publisher} />
              <DetailField label={t("plugins.detail.version")} value={plugin.version} />
              <DetailField label={t("plugins.detail.homepage")} value={plugin.homepage ?? null} />
              <DetailField label={t("plugins.detail.license")} value={plugin.license ?? null} />
              <DetailField
                label={t("plugins.detail.integrationLevel")}
                value={integrationLevelLabel(plugin, t)}
              />
              <DetailField
                label={t("plugins.detail.runtimeSource")}
                value={runtimeSourceLabel(plugin, t)}
              />
              <DetailField
                label={t("plugins.detail.integrityPolicy")}
                value={integrityPolicyLabel(plugin, t)}
              />
              <DetailField
                label={t("plugins.detail.telemetryPolicy")}
                value={telemetryPolicyLabel(plugin, t)}
              />
            </div>
          </section>

          <section className="app-material-inset rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[color:var(--app-accent)]" />
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

          <section className="app-material-inset rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-[color:var(--app-accent)]" />
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
            <section className="app-material-inset rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Code2 className="h-4 w-4 text-[color:var(--app-accent)]" />
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
            <section className="app-material-inset rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-[color:var(--app-accent)]" />
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

          {agentRuntime?.agentRuntimeDetector ? (
            <section className="app-material-inset rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Code2 className="h-4 w-4 text-[color:var(--app-accent)]" />
                <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                  {t("agents.profile.runtime")}
                </h4>
              </div>
              <p className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
                {agentRuntimeStatusLabel(agentRuntimeStatus, t)}
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <DetailField label={t("plugins.detail.version")} value={agentRuntimeStatus?.version} />
              </div>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => onAgentRuntimeAction(plugin.id, agentRuntime.agentRuntimeDetector!.runtimeId, "detect")}>
                  {t("plugins.agentRuntime.detect")}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAgentRuntimeAction(plugin.id, agentRuntime.agentRuntimeDetector!.runtimeId, "select")}>
                  {t("plugins.agentRuntime.selectExecutable")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={(busy && !agentRuntimeUpdating) || (!agentRuntimeUpdating && !agentRuntimeStatus?.available)}
                  onClick={() => onAgentRuntimeAction(
                    plugin.id,
                    agentRuntime.agentRuntimeDetector!.runtimeId,
                    agentRuntimeUpdating ? "cancel-update" : "update",
                  )}
                >
                  {t(agentRuntimeUpdating ? "plugins.agentRuntime.cancelUpdate" : "plugins.agentRuntime.update")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy || (!agentRuntimeStatus?.enabled && (!agentRuntimeStatus?.available || !agentRuntimeStatus?.authenticated))}
                  onClick={() => onAgentRuntimeAction(
                    plugin.id,
                    agentRuntime.agentRuntimeDetector!.runtimeId,
                    agentRuntimeStatus?.enabled ? "disable" : "enable",
                  )}
                >
                  {t(agentRuntimeStatus?.enabled ? "plugins.agentRuntime.disable" : "plugins.agentRuntime.enable")}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy || !agentRuntimeReady} onClick={() => onAgentRuntimeAction(plugin.id, agentRuntime.agentRuntimeDetector!.runtimeId, "terminal")}>
                  {t("plugins.agentRuntime.openTerminal")}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAgentRuntimeAction(plugin.id, agentRuntime.agentRuntimeDetector!.runtimeId, "profiles")}>
                  {t("plugins.agentRuntime.useForProfiles")}
                </Button>
              </div>
            </section>
          ) : null}

          <section className="app-material-inset rounded-lg border p-3">
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
    </AppDialog>
  );
}
