import type {
  InstalledPlugin,
  PluginCatalogEntry,
  PluginContribution,
  PluginManifest,
  RuntimeAssetStatus,
  ToolchainStatus,
} from "../../../shared/plugins/pluginTypes";
import type {
  AgentRuntimeAction,
  AgentRuntimeDescriptor,
  AgentRuntimeId,
} from "../../../shared/types/agentControl";
import type { WorkspacePage } from "../../../shared/types/app";

const TRUSTED_BUILT_IN_PLUGIN_IDS = new Set(["latotex.docx-workspace"]);
const WORKSPACE_PAGES = new Set<WorkspacePage>([
  "latex",
  "library",
  "analysis",
  "submission",
  "agents",
  "draw",
  "git",
  "plugins",
  "settings",
]);

export type PluginOpenTarget = {
  page: WorkspacePage;
  settingsSection?: string;
};

export type PluginPrimaryAction = {
  kind:
    | "validation"
    | "register"
    | "enable"
    | "toolchain-install"
    | "toolchain-detect"
    | "runtime-install"
    | "agent-runtime"
    | "open"
    | "built-in"
    | "ready";
  labelKey: string;
  disabled?: boolean;
  contributionId?: string;
  runtimeId?: AgentRuntimeId;
  runtimeAction?: AgentRuntimeAction;
  openTarget?: PluginOpenTarget;
};

export type ResolvePluginPrimaryActionInput = {
  entry: PluginCatalogEntry;
  installedPlugin?: InstalledPlugin;
  toolchainStatus?: ToolchainStatus | null;
  runtimeAssetStatus?: RuntimeAssetStatus | null;
  agentRuntimeStatus?: AgentRuntimeDescriptor | null;
};

function firstContribution(manifest: PluginManifest, kinds: string[]): PluginContribution | undefined {
  return manifest.contributions.find((contribution) => kinds.includes(contribution.kind));
}

function workspacePage(value: string | null | undefined): WorkspacePage | null {
  const normalized = value?.trim() as WorkspacePage | undefined;
  return normalized && WORKSPACE_PAGES.has(normalized) ? normalized : null;
}

export function resolvePluginOpenTarget(manifest: PluginManifest): PluginOpenTarget | null {
  for (const event of manifest.activationEvents ?? []) {
    if (!event.startsWith("onPage:")) continue;
    const page = workspacePage(event.slice("onPage:".length));
    if (page) return { page };
  }
  for (const contribution of manifest.contributions) {
    if (contribution.kind === "workspacePage") {
      const page = workspacePage(contribution.location) ?? workspacePage(contribution.id);
      if (page) return { page };
    }
    if (contribution.kind === "settingsQuickAction" && contribution.settingsQuickAction?.section) {
      return { page: "settings", settingsSection: contribution.settingsQuickAction.section };
    }
    if (contribution.kind === "settingsSection") {
      return { page: "settings", settingsSection: contribution.location ?? contribution.id };
    }
  }
  return null;
}

function resolveAgentRuntimePrimaryAction(
  contribution: PluginContribution,
  status: AgentRuntimeDescriptor | null | undefined,
): PluginPrimaryAction {
  const runtimeId = contribution.agentRuntimeDetector!.runtimeId;
  if (!status || status.checkedAt === null) {
    return {
      kind: "agent-runtime",
      labelKey: "plugins.agentRuntime.detect",
      runtimeId,
      runtimeAction: "detect",
    };
  }
  if (!status.available) {
    return {
      kind: "agent-runtime",
      labelKey: "plugins.agentRuntime.selectExecutable",
      runtimeId,
      runtimeAction: "select",
    };
  }
  if (!status.authenticated) {
    return {
      kind: "agent-runtime",
      labelKey: "plugins.agentRuntime.openTerminal",
      runtimeId,
      runtimeAction: "terminal",
    };
  }
  if (!status.enabled) {
    return {
      kind: "agent-runtime",
      labelKey: "plugins.agentRuntime.enable",
      runtimeId,
      runtimeAction: "enable",
    };
  }
  return {
    kind: "agent-runtime",
    labelKey: "plugins.agentRuntime.useForProfiles",
    runtimeId,
    runtimeAction: "profiles",
  };
}

export function resolvePluginPrimaryAction(
  input: ResolvePluginPrimaryActionInput,
): PluginPrimaryAction {
  const { entry, installedPlugin, toolchainStatus, runtimeAssetStatus, agentRuntimeStatus } = input;
  const manifest = entry.manifest;
  if (!entry.validation.ok) {
    return { kind: "validation", labelKey: "plugins.validationDetails" };
  }

  const agentRuntime = manifest.contributions.find((item) => item.agentRuntimeDetector);
  if (agentRuntime?.agentRuntimeDetector) {
    return resolveAgentRuntimePrimaryAction(agentRuntime, agentRuntimeStatus);
  }

  const toolchain = firstContribution(manifest, ["toolchainInstaller", "toolchainProbe"]);
  const runtimeAsset = firstContribution(manifest, ["runtimeAsset"]);
  const isBuiltIn = entry.sourceId === "builtin";
  const isTrustedBuiltIn = isBuiltIn && TRUSTED_BUILT_IN_PLUGIN_IDS.has(manifest.id);
  const isBuiltInRuntime = isBuiltIn && Boolean(toolchain || runtimeAsset);

  if (!installedPlugin && !isTrustedBuiltIn && !isBuiltInRuntime) {
    return { kind: "register", labelKey: "plugins.primary.register" };
  }
  if (installedPlugin && !installedPlugin.enabled) {
    return { kind: "enable", labelKey: "plugins.enable" };
  }

  if (toolchain?.kind === "toolchainProbe" && !toolchainStatus?.installed) {
    return {
      kind: "toolchain-detect",
      labelKey: "plugins.toolchain.verify",
      contributionId: toolchain.id,
    };
  }
  if (toolchain?.kind === "toolchainInstaller" && !toolchainStatus?.installed) {
    return {
      kind: "toolchain-install",
      labelKey: "plugins.toolchain.install",
      contributionId: toolchain.id,
    };
  }
  if (runtimeAsset && !runtimeAssetStatus?.installed) {
    return {
      kind: "runtime-install",
      labelKey: "plugins.runtimeAsset.install",
      contributionId: runtimeAsset.id,
    };
  }

  const openTarget = resolvePluginOpenTarget(manifest);
  if (openTarget) {
    return { kind: "open", labelKey: "plugins.primary.open", openTarget };
  }
  if (isTrustedBuiltIn) {
    return { kind: "built-in", labelKey: "plugins.primary.builtIn", disabled: true };
  }
  return { kind: "ready", labelKey: "plugins.enabled", disabled: true };
}
