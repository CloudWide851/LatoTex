import { describe, expect, it } from "vitest";
import type {
  InstalledPlugin,
  PluginCatalogEntry,
  PluginContribution,
  PluginManifest,
} from "../../../shared/plugins/pluginTypes";
import type { AgentRuntimeDescriptor } from "../../../shared/types/agentControl";
import { resolvePluginPrimaryAction } from "./pluginPrimaryAction";

function contribution(kind: string): PluginContribution {
  const value: PluginContribution = { kind, id: `${kind}.id`, title: kind };
  if (kind === "toolchainInstaller") {
    value.toolchainInstaller = {
      id: "tool",
      kind: "go",
      platform: "windows-x64",
      downloadUrl: "https://example.test/tool.zip",
      sha256: "a".repeat(64),
      archiveFormat: "zip",
      executable: "tool.exe",
    };
  }
  if (kind === "toolchainProbe") {
    value.toolchainProbe = {
      id: "tool",
      kind: "go",
      platform: "windows-x64",
      executables: ["tool.exe"],
    };
  }
  if (kind === "runtimeAsset") {
    value.runtimeAsset = {
      id: "runtime",
      kind: "drawio",
      platform: "windows-x64",
      downloadUrl: "https://example.test/runtime.zip",
      sha256: "b".repeat(64),
      archiveFormat: "zip",
      entryPath: "index.html",
    };
  }
  if (kind === "agentRuntime") {
    value.agentRuntimeDetector = {
      runtimeId: "codex-cli",
      executable: "codex.exe",
      versionArgs: ["--version"],
      authArgs: ["login", "status"],
    };
  }
  return value;
}

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    schema: "latotex.plugin.v1",
    id: "publisher.plugin",
    name: "Plugin",
    publisher: "Publisher",
    version: "1.0.0",
    description: "Plugin",
    categories: [],
    permissions: [],
    contributions: [],
    ...overrides,
  };
}

function entry(options: {
  sourceId?: string;
  manifest?: PluginManifest;
  valid?: boolean;
} = {}): PluginCatalogEntry {
  return {
    manifest: options.manifest ?? manifest(),
    sourceId: options.sourceId ?? "catalog",
    sourceName: "Catalog",
    validation: {
      ok: options.valid ?? true,
      issues: options.valid === false
        ? [{ code: "invalid", severity: "error", message: "invalid" }]
        : [],
    },
  };
}

function installed(plugin: PluginManifest, enabled: boolean): InstalledPlugin {
  return {
    manifest: plugin,
    enabled,
    installedAt: "",
    source: "catalog",
  };
}

function runtime(overrides: Partial<AgentRuntimeDescriptor> = {}): AgentRuntimeDescriptor {
  return {
    id: "codex-cli",
    pluginId: "latotex.agent-runtime.codex",
    labelKey: "agents.runtime.codex",
    enabled: false,
    available: false,
    authenticated: false,
    source: "missing",
    executablePath: null,
    version: null,
    failure: null,
    checkedAt: null,
    ...overrides,
  };
}

describe("resolvePluginPrimaryAction", () => {
  it("blocks invalid manifests with validation as the sole primary action", () => {
    expect(resolvePluginPrimaryAction({ entry: entry({ valid: false }) }).kind).toBe("validation");
  });

  it("registers unregistered catalog and built-in declarative plugins as disabled first", () => {
    expect(resolvePluginPrimaryAction({ entry: entry() }).kind).toBe("register");
    expect(resolvePluginPrimaryAction({ entry: entry({ sourceId: "builtin" }) }).kind).toBe("register");
  });

  it("enables registered plugins before exposing contribution actions", () => {
    const plugin = manifest({ contributions: [contribution("toolchainInstaller")] });
    expect(resolvePluginPrimaryAction({
      entry: entry({ manifest: plugin }),
      installedPlugin: installed(plugin, false),
    }).kind).toBe("enable");
  });

  it("uses trusted installers and runtime assets only for their missing contribution", () => {
    const tool = manifest({ contributions: [contribution("toolchainInstaller")] });
    const asset = manifest({ contributions: [contribution("runtimeAsset")] });
    expect(resolvePluginPrimaryAction({
      entry: entry({ sourceId: "builtin", manifest: tool }),
    }).kind).toBe("toolchain-install");
    expect(resolvePluginPrimaryAction({
      entry: entry({ sourceId: "builtin", manifest: asset }),
    }).kind).toBe("runtime-install");
  });

  it("detects probe-only toolchains and never labels them as downloads", () => {
    const plugin = manifest({ contributions: [contribution("toolchainProbe")] });
    const action = resolvePluginPrimaryAction({
      entry: entry({ sourceId: "builtin", manifest: plugin }),
    });
    expect(action).toMatchObject({ kind: "toolchain-detect", labelKey: "plugins.toolchain.verify" });
  });

  it("walks Agent Runtime through detect, select, authenticate, enable, and Studio", () => {
    const plugin = manifest({ contributions: [contribution("agentRuntime")] });
    const builtin = entry({ sourceId: "builtin", manifest: plugin });
    const cases: Array<[AgentRuntimeDescriptor | null, string]> = [
      [null, "detect"],
      [runtime({ checkedAt: "now" }), "select"],
      [runtime({ checkedAt: "now", available: true }), "terminal"],
      [runtime({ checkedAt: "now", available: true, authenticated: true }), "enable"],
      [runtime({ checkedAt: "now", available: true, authenticated: true, enabled: true }), "profiles"],
    ];
    expect(cases.map(([agentRuntimeStatus]) => resolvePluginPrimaryAction({
      entry: builtin,
      agentRuntimeStatus,
    }).runtimeAction)).toEqual(cases.map(([, action]) => action));
  });

  it("opens ready routed features and reports package-free DOCX as built in", () => {
    const routed = manifest({ activationEvents: ["onPage:draw"] });
    expect(resolvePluginPrimaryAction({
      entry: entry({ sourceId: "builtin", manifest: routed }),
      installedPlugin: installed(routed, true),
    })).toMatchObject({ kind: "open", openTarget: { page: "draw" } });
    const docx = manifest({ id: "latotex.docx-workspace" });
    expect(resolvePluginPrimaryAction({
      entry: entry({ sourceId: "builtin", manifest: docx }),
    }).kind).toBe("built-in");
  });

  it("returns exactly one exhaustive primary action for every contribution kind", () => {
    const kinds = [
      "workspacePage", "settingsSection", "command", "mcpServer", "skill", "docxTool",
      "toolbarButton", "menuItem", "statusItem", "workspaceCommand", "docxCommand",
      "editorCommand", "analysisCommand", "libraryCommand", "markdownCommand", "terminalCommand",
      "resourceCommand", "fileOpenHandler", "previewProvider", "resourceBadge", "resourceClassifier",
      "problemMatcher", "pluginPanel", "sidebarView", "treeDecoration", "commandPaletteItem",
      "settingsQuickAction", "runtimeAssetDetector", "settingsSchema", "fileTemplate",
      "snippetProvider", "agentContextPack", "languageSupport", "toolchainInstaller",
      "toolchainProbe", "runtimeAsset", "agentRuntime", "unknownContribution",
    ];
    const actions = kinds.map((kind) => {
      const plugin = manifest({ contributions: [contribution(kind)] });
      return resolvePluginPrimaryAction({ entry: entry({ manifest: plugin }) });
    });
    expect(actions).toHaveLength(kinds.length);
    expect(actions.every((action) => Boolean(action.kind && action.labelKey))).toBe(true);
  });
});
