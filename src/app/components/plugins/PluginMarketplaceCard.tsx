import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  Info,
  MoreHorizontal,
  Power,
  Search,
} from "lucide-react";
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
import type { AgentRuntimeAction, AgentRuntimeDescriptor, AgentRuntimeId } from "../../../shared/types/agentControl";
import {
  contributionSummary,
  describeRuntimeAssetStatus,
  describeToolchainStatus,
  iconFor,
  integrationLevelLabel,
  issueTone,
  localizedPlugin,
  runtimeSourceLabel,
  type TranslationFn,
} from "./pluginMarketplaceUtils";
import {
  resolvePluginPrimaryAction,
  type PluginOpenTarget,
  type PluginPrimaryAction,
} from "./pluginPrimaryAction";

type RuntimeAction = "install" | "verify" | "remove";

type SecondaryAction = {
  id: string;
  label: string;
  disabled?: boolean;
  run: () => void;
};

function primaryActionIcon(action: PluginPrimaryAction) {
  if (action.kind === "validation") return AlertTriangle;
  if (action.kind === "enable") return Power;
  if (action.kind === "open") return ExternalLink;
  if (action.kind === "toolchain-detect") return Search;
  if (action.kind === "built-in" || action.kind === "ready") return CheckCircle2;
  if (action.kind === "agent-runtime" && action.runtimeAction === "detect") return Search;
  if (action.kind === "agent-runtime" && action.runtimeAction === "select") return Search;
  if (action.kind === "agent-runtime" && action.runtimeAction === "enable") return Power;
  if (action.kind === "agent-runtime" && ["profiles", "terminal"].includes(action.runtimeAction ?? "")) {
    return ExternalLink;
  }
  return Download;
}

function agentRuntimeStatusLabel(runtime: AgentRuntimeDescriptor | null, t: TranslationFn): string {
  if (!runtime?.available) return t("agents.runtime.unavailable");
  if (!runtime.enabled) return t("agents.runtime.disabled");
  if (!runtime.authenticated) return t("agents.runtime.authRequired");
  return t("agents.runtime.ready");
}

export function PluginMarketplaceCard(props: {
  entry: PluginCatalogEntry;
  installedPlugin: InstalledPlugin | undefined;
  locale: string;
  busy: boolean;
  activeAgentRuntimeAction: AgentRuntimeAction | null;
  toolchainStatus: ToolchainStatus | null;
  runtimeAssetStatus: RuntimeAssetStatus | null;
  toolchain: PluginContribution | undefined;
  runtimeAsset: PluginContribution | undefined;
  agentRuntime: PluginContribution | undefined;
  agentRuntimeStatus: AgentRuntimeDescriptor | null;
  onDetailsOpen: () => void;
  onInstallPlugin: (entry: PluginCatalogEntry) => void;
  onTogglePlugin: (plugin: InstalledPlugin) => void;
  onRemovePlugin: (pluginId: string) => void;
  onToolchainAction: (pluginId: string, contributionId: string, action: RuntimeAction) => void;
  onToolchainDirectoryPick: (pluginId: string, contributionId: string) => void;
  onRuntimeAssetAction: (pluginId: string, contributionId: string, action: RuntimeAction) => void;
  onAgentRuntimeAction: (pluginId: string, runtimeId: AgentRuntimeId, action: AgentRuntimeAction) => void;
  onOpenFeature: (target: PluginOpenTarget) => void;
  t: TranslationFn;
}) {
  const {
    entry,
    installedPlugin,
    locale,
    busy,
    activeAgentRuntimeAction,
    toolchainStatus,
    runtimeAssetStatus,
    toolchain,
    runtimeAsset,
    agentRuntime,
    agentRuntimeStatus,
    onDetailsOpen,
    onInstallPlugin,
    onTogglePlugin,
    onRemovePlugin,
    onToolchainAction,
    onToolchainDirectoryPick,
    onRuntimeAssetAction,
    onAgentRuntimeAction,
    onOpenFeature,
    t,
  } = props;
  const [secondaryOpen, setSecondaryOpen] = useState(false);
  const secondaryRef = useRef<HTMLDivElement | null>(null);
  const plugin: PluginManifest = entry.manifest;
  const Icon = iconFor(plugin);
  const localized = localizedPlugin(plugin, locale);
  const errorCount = entry.validation.issues.filter((item) => item.severity === "error").length;
  const warningCount = entry.validation.issues.filter((item) => item.severity === "warning").length;
  const toolchainIsProbe = toolchain?.kind === "toolchainProbe";
  const contributionInstalled = Boolean(toolchainStatus?.installed || runtimeAssetStatus?.installed);
  const agentRuntimeReady = Boolean(
    agentRuntimeStatus?.enabled
      && agentRuntimeStatus.available
      && agentRuntimeStatus.authenticated,
  );
  const agentRuntimeUpdating = activeAgentRuntimeAction === "update";
  const installedLabel = toolchainStatus?.source === "local" || runtimeAssetStatus?.source === "local"
    ? t("plugins.detectedLocal")
    : runtimeAssetStatus?.source === "bundled"
      ? t("plugins.detectedBundled")
      : t("plugins.enabled");
  const canUseRuntime = entry.sourceId === "builtin" || Boolean(installedPlugin);
  const statusLabel = agentRuntime
    ? agentRuntimeStatusLabel(agentRuntimeStatus, t)
    : installedPlugin?.enabled
    ? installedLabel
    : installedPlugin
      ? t("plugins.disabled")
      : contributionInstalled
      ? installedLabel
      : t("plugins.notInstalled");
  const runtimeDetail = describeRuntimeAssetStatus(runtimeAssetStatus, t);
  const toolchainDetail = describeToolchainStatus(toolchain, toolchainStatus, t);
  const integrationLabel = integrationLevelLabel(plugin, t);
  const sourceLabel = runtimeSourceLabel(plugin, t);
  const primaryAction = resolvePluginPrimaryAction({
    entry,
    installedPlugin,
    toolchainStatus,
    runtimeAssetStatus,
    agentRuntimeStatus,
  });
  const PrimaryIcon = primaryActionIcon(primaryAction);

  useEffect(() => {
    if (!secondaryOpen) return;
    const closeOnPointer = (event: PointerEvent) => {
      if (!secondaryRef.current?.contains(event.target as Node)) setSecondaryOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSecondaryOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [secondaryOpen]);

  const runPrimaryAction = () => {
    if (primaryAction.kind === "validation") return onDetailsOpen();
    if (primaryAction.kind === "register") return onInstallPlugin(entry);
    if (primaryAction.kind === "enable" && installedPlugin) return onTogglePlugin(installedPlugin);
    if (primaryAction.kind === "toolchain-install" && primaryAction.contributionId) {
      return onToolchainAction(plugin.id, primaryAction.contributionId, "install");
    }
    if (primaryAction.kind === "toolchain-detect" && primaryAction.contributionId) {
      return onToolchainAction(plugin.id, primaryAction.contributionId, "verify");
    }
    if (primaryAction.kind === "runtime-install" && primaryAction.contributionId) {
      return onRuntimeAssetAction(plugin.id, primaryAction.contributionId, "install");
    }
    if (
      primaryAction.kind === "agent-runtime"
      && primaryAction.runtimeId
      && primaryAction.runtimeAction
    ) {
      return onAgentRuntimeAction(plugin.id, primaryAction.runtimeId, primaryAction.runtimeAction);
    }
    if (primaryAction.kind === "open" && primaryAction.openTarget) {
      return onOpenFeature(primaryAction.openTarget);
    }
  };

  const secondaryActions: SecondaryAction[] = [];
  if (primaryAction.kind !== "validation") {
    secondaryActions.push({ id: "details", label: t("plugins.details"), run: onDetailsOpen });
  }
  if (toolchain) {
    if (primaryAction.kind !== "toolchain-detect") {
      secondaryActions.push({
        id: "toolchain-verify",
        label: t("plugins.toolchain.verify"),
        disabled: busy || !canUseRuntime,
        run: () => onToolchainAction(plugin.id, toolchain.id, "verify"),
      });
    }
    if (toolchainIsProbe) {
      secondaryActions.push({
        id: "toolchain-local",
        label: t("plugins.toolchain.pickLocal"),
        disabled: busy || !canUseRuntime,
        run: () => onToolchainDirectoryPick(plugin.id, toolchain.id),
      });
    }
    if (toolchainStatus?.installed) {
      secondaryActions.push({
        id: "toolchain-remove",
        label: t("plugins.toolchain.remove"),
        disabled: busy,
        run: () => onToolchainAction(plugin.id, toolchain.id, "remove"),
      });
    }
  }
  if (runtimeAsset) {
    secondaryActions.push({
      id: "runtime-verify",
      label: t("plugins.toolchain.verify"),
      disabled: busy || !canUseRuntime,
      run: () => onRuntimeAssetAction(plugin.id, runtimeAsset.id, "verify"),
    });
    if (runtimeAssetStatus?.installed && runtimeAssetStatus.source === "managed") {
      secondaryActions.push({
        id: "runtime-remove",
        label: t("plugins.runtimeAsset.remove"),
        disabled: busy,
        run: () => onRuntimeAssetAction(plugin.id, runtimeAsset.id, "remove"),
      });
    }
  }
  if (agentRuntime?.agentRuntimeDetector) {
    const { runtimeId } = agentRuntime.agentRuntimeDetector;
    if (primaryAction.runtimeAction !== "detect") {
      secondaryActions.push({
        id: "agent-detect",
        label: t("plugins.agentRuntime.detect"),
        disabled: busy,
        run: () => onAgentRuntimeAction(plugin.id, runtimeId, "detect"),
      });
    }
    if (primaryAction.runtimeAction !== "select") {
      secondaryActions.push({
        id: "agent-select",
        label: t("plugins.agentRuntime.selectExecutable"),
        disabled: busy,
        run: () => onAgentRuntimeAction(plugin.id, runtimeId, "select"),
      });
    }
    secondaryActions.push({
      id: "agent-update",
      label: t(agentRuntimeUpdating ? "plugins.agentRuntime.cancelUpdate" : "plugins.agentRuntime.update"),
      disabled: (busy && !agentRuntimeUpdating) || (!agentRuntimeUpdating && !agentRuntimeStatus?.available),
      run: () => onAgentRuntimeAction(plugin.id, runtimeId, agentRuntimeUpdating ? "cancel-update" : "update"),
    });
    if (agentRuntimeStatus?.enabled) {
      secondaryActions.push({
        id: "agent-disable",
        label: t("plugins.agentRuntime.disable"),
        disabled: busy,
        run: () => onAgentRuntimeAction(plugin.id, runtimeId, "disable"),
      });
    }
    if (agentRuntimeReady && primaryAction.runtimeAction !== "terminal") {
      secondaryActions.push({
        id: "agent-terminal",
        label: t("plugins.agentRuntime.openTerminal"),
        disabled: busy,
        run: () => onAgentRuntimeAction(plugin.id, runtimeId, "terminal"),
      });
    }
  }
  if (installedPlugin) {
    if (installedPlugin.enabled) {
      secondaryActions.push({
        id: "disable",
        label: t("plugins.disable"),
        disabled: busy,
        run: () => onTogglePlugin(installedPlugin),
      });
    }
    secondaryActions.push({
      id: "uninstall",
      label: t("plugins.uninstall"),
      disabled: busy,
      run: () => onRemovePlugin(plugin.id),
    });
  }

  return (
    <article className="app-material-inset group grid min-h-[156px] min-w-0 grid-rows-[auto_auto_1fr_auto] overflow-hidden rounded-md border transition hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-soft">
      <div className="app-material-content flex min-w-0 items-start gap-2 p-2.5">
        <div className="app-material-inset flex h-8 w-8 max-w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border text-primary-700">
          {plugin.icon ? (
            <img src={plugin.icon} alt="" className="h-5 w-5 rounded object-contain" />
          ) : (
            <Icon className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-slate-950" title={localized.name}>{localized.name}</h3>
          <p className="mt-1 truncate text-[11px] text-slate-500">
            {plugin.publisher} / {plugin.version} / {entry.sourceName}
          </p>
        </div>
        <span
          className={cn(
            "max-w-[5.8rem] shrink-0 truncate rounded-full border px-2 py-0.5 text-[10px] font-medium",
            installedPlugin?.enabled || contributionInstalled || agentRuntimeReady
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : installedPlugin
                ? "border-slate-200 bg-slate-100 text-slate-600"
                : "border-slate-200 bg-white text-slate-500",
          )}
          title={statusLabel}
        >
          {statusLabel}
        </span>
      </div>

      <div className="space-y-1.5 px-2.5 pb-1.5">
        <p className="line-clamp-2 min-h-8 text-xs leading-4 text-slate-600">{localized.description}</p>
        <div className="flex flex-wrap gap-1">
          {integrationLabel ? (
            <span className="rounded-full border border-[color:var(--app-accent)]/30 bg-[color:var(--app-accent-soft)] px-2 py-0.5 text-[10px] text-[color:var(--app-accent-strong)]">
              {integrationLabel}
            </span>
          ) : null}
          {sourceLabel ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
              {sourceLabel}
            </span>
          ) : null}
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
        <div className="flex min-w-0 items-center gap-1">
          {toolchain ? (
            <span className="min-w-0 truncate rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-600" title={toolchainDetail}>
              {toolchainStatus?.installed ? statusLabel : toolchainIsProbe ? t("plugins.toolchain.notDetected") : t("plugins.toolchain.notInstalled")}
            </span>
          ) : null}
          {runtimeAsset ? (
            <span className="min-w-0 truncate rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-600" title={runtimeDetail}>
              {runtimeAssetStatus?.installed ? statusLabel : t("plugins.runtimeAsset.notInstalled")}
            </span>
          ) : null}
          {agentRuntime ? (
            <span className="min-w-0 truncate rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-600" title={statusLabel}>
              {agentRuntimeStatus?.version ?? statusLabel}
            </span>
          ) : null}
        </div>
        {errorCount > 0 || warningCount > 0 ? (
          <span
            className={cn("inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-1 text-[10px]", errorCount > 0 ? issueTone("error") : issueTone("warning"))}
            title={t("plugins.validationDetails")}
          >
            {errorCount > 0 ? <AlertTriangle className="h-3 w-3" /> : <Info className="h-3 w-3" />}
            <span className="truncate">
              {errorCount > 0
                ? t("plugins.validationErrors").replace("{count}", String(errorCount))
                : t("plugins.validationWarnings").replace("{count}", String(warningCount))}
            </span>
          </span>
        ) : (
          <span className="inline-flex max-w-full truncate rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] text-emerald-700">
            {t("plugins.validationOk")}
          </span>
        )}
      </div>

      <div className="app-material-content flex min-w-0 items-center justify-end gap-1.5 border-t px-2.5 py-1.5">
        <Button
          size="sm"
          variant={primaryAction.kind === "validation" ? "secondary" : "default"}
          disabled={busy || primaryAction.disabled}
          data-plugin-primary-action={primaryAction.kind}
          onClick={runPrimaryAction}
        >
          <PrimaryIcon className="mr-1.5 h-3.5 w-3.5" />
          {t(primaryAction.labelKey as any)}
        </Button>
        {secondaryActions.length > 0 ? (
          <div ref={secondaryRef} className="relative">
            <button
              type="button"
              className="control-button control-button--ghost inline-flex h-8 w-8 items-center justify-center"
              aria-label={t("plugins.secondaryActions")}
              aria-haspopup="menu"
              aria-expanded={secondaryOpen}
              onClick={() => setSecondaryOpen((value) => !value)}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {secondaryOpen ? (
              <div
                role="menu"
                className="app-material-floating absolute bottom-full right-0 z-30 mb-1 min-w-44 overflow-hidden rounded-md border py-1 shadow-lg"
              >
                {secondaryActions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    role="menuitem"
                    data-plugin-secondary-action={action.id}
                    disabled={action.disabled}
                    className="block w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                    onClick={() => {
                      setSecondaryOpen(false);
                      action.run();
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
