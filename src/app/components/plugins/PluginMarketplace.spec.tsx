// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginMarketplace } from "./PluginMarketplace";
import type { PluginCatalogEntry } from "../../../shared/plugins/pluginTypes";

const pluginApiMocks = vi.hoisted(() => ({
  getPluginCatalog: vi.fn(),
  installPlugin: vi.fn(),
  listInstalledPlugins: vi.fn(),
  setPluginEnabled: vi.fn(),
  uninstallPlugin: vi.fn(),
}));

const toolchainApiMocks = vi.hoisted(() => ({
  installToolchain: vi.fn(),
  listToolchains: vi.fn(),
  pickToolchainDirectory: vi.fn(),
  registerLocalToolchain: vi.fn(),
  removeToolchain: vi.fn(),
  verifyToolchain: vi.fn(),
}));

const runtimeAssetApiMocks = vi.hoisted(() => ({
  installRuntimeAsset: vi.fn(),
  listRuntimeAssets: vi.fn(),
  removeRuntimeAsset: vi.fn(),
  verifyRuntimeAsset: vi.fn(),
}));

const agentRuntimeApiMocks = vi.hoisted(() => ({
  cancelAgentRuntimeUpdate: vi.fn(),
  detectAgentRuntime: vi.fn(),
  listAgentRuntimes: vi.fn(),
  pickAgentRuntimeExecutable: vi.fn(),
  setAgentRuntimeEnabled: vi.fn(),
  updateAgentRuntime: vi.fn(),
}));

vi.mock("../../../shared/api/plugins", () => ({
  getPluginCatalog: pluginApiMocks.getPluginCatalog,
  installPlugin: pluginApiMocks.installPlugin,
  listInstalledPlugins: pluginApiMocks.listInstalledPlugins,
  setPluginEnabled: pluginApiMocks.setPluginEnabled,
  uninstallPlugin: pluginApiMocks.uninstallPlugin,
}));

vi.mock("../../../shared/api/toolchains", () => ({
  installToolchain: toolchainApiMocks.installToolchain,
  listToolchains: toolchainApiMocks.listToolchains,
  pickToolchainDirectory: toolchainApiMocks.pickToolchainDirectory,
  registerLocalToolchain: toolchainApiMocks.registerLocalToolchain,
  removeToolchain: toolchainApiMocks.removeToolchain,
  verifyToolchain: toolchainApiMocks.verifyToolchain,
}));

vi.mock("../../../shared/api/runtimeAssets", () => ({
  installRuntimeAsset: runtimeAssetApiMocks.installRuntimeAsset,
  listRuntimeAssets: runtimeAssetApiMocks.listRuntimeAssets,
  removeRuntimeAsset: runtimeAssetApiMocks.removeRuntimeAsset,
  verifyRuntimeAsset: runtimeAssetApiMocks.verifyRuntimeAsset,
}));

vi.mock("../../../shared/api/agent", () => ({
  cancelAgentRuntimeUpdate: agentRuntimeApiMocks.cancelAgentRuntimeUpdate,
  detectAgentRuntime: agentRuntimeApiMocks.detectAgentRuntime,
  listAgentRuntimes: agentRuntimeApiMocks.listAgentRuntimes,
  pickAgentRuntimeExecutable: agentRuntimeApiMocks.pickAgentRuntimeExecutable,
  setAgentRuntimeEnabled: agentRuntimeApiMocks.setAgentRuntimeEnabled,
  updateAgentRuntime: agentRuntimeApiMocks.updateAgentRuntime,
}));

function sampleToolchainEntry(): PluginCatalogEntry {
  return {
    sourceId: "builtin",
    sourceName: "Built in",
    validation: { ok: true, issues: [] },
    manifest: {
      schema: "latotex.plugin.v1",
      id: "latotex.tectonic",
      name: "tectonic",
      displayName: "Tectonic",
      publisher: "LatoTex",
      version: "1.0.0",
      description: "Compile LaTeX projects with a managed toolchain.",
      categories: ["compiler"],
      keywords: ["latex", "compiler"],
      permissions: ["workspace.read", "process.spawn"],
      contributions: [{
        kind: "toolchainInstaller",
        id: "tectonic.windows-x64",
        title: "Tectonic toolchain",
        description: "Portable LaTeX compiler.",
        toolchainInstaller: {
          id: "tectonic",
          kind: "latex",
          platform: "windows-x64",
          downloadUrl: "https://example.com/tectonic.zip",
          sha256: "a".repeat(64),
          archiveFormat: "zip",
          executable: "tectonic.exe",
        },
      }],
    },
  };
}

function sampleAgentRuntimeEntry(): PluginCatalogEntry {
  return {
    sourceId: "builtin",
    sourceName: "Built in",
    validation: { ok: true, issues: [] },
    manifest: {
      schema: "latotex.plugin.v1",
      id: "latotex.agent.codex-cli",
      name: "codex-cli",
      displayName: "Codex CLI Agent",
      publisher: "LatoTex",
      version: "1.0.0",
      description: "Use the official Codex CLI with LatoTex research tools.",
      categories: ["agent", "research"],
      keywords: ["codex", "agent"],
      permissions: ["workspace.read", "process.spawn", "mcp"],
      contributions: [{
        kind: "agentRuntime",
        id: "codex-cli.runtime",
        title: "Agent runtime",
        agentRuntimeDetector: {
          runtimeId: "codex-cli",
          executable: "codex.exe",
          versionArgs: ["--version"],
          authArgs: ["login", "status"],
        },
      }],
    },
  };
}

async function flushAsyncUpdates() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("PluginMarketplace", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    pluginApiMocks.getPluginCatalog.mockResolvedValue({ items: [], warnings: [] });
    pluginApiMocks.listInstalledPlugins.mockResolvedValue([]);
    toolchainApiMocks.listToolchains.mockResolvedValue([]);
    toolchainApiMocks.pickToolchainDirectory.mockResolvedValue(null);
    toolchainApiMocks.registerLocalToolchain.mockResolvedValue({
      pluginId: "latotex.tectonic",
      contributionId: "tectonic.windows-x64",
      kind: "latex",
      installed: true,
      installPath: "C:\\Tools\\Tectonic",
      executablePath: "C:\\Tools\\Tectonic\\tectonic.exe",
      version: "tectonic 0.15.0",
      message: "ok",
      source: "local",
    });
    runtimeAssetApiMocks.listRuntimeAssets.mockResolvedValue([]);
    agentRuntimeApiMocks.listAgentRuntimes.mockResolvedValue([]);
    agentRuntimeApiMocks.cancelAgentRuntimeUpdate.mockResolvedValue({ ok: true, message: "cancelled" });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("shows an animated loading state before the first catalog response", async () => {
    pluginApiMocks.getPluginCatalog.mockReturnValue(new Promise(() => undefined));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<PluginMarketplace settings={null} t={(key) => String(key)} />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("plugins.loading");
    expect(container.textContent).not.toContain("plugins.empty");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("opens plugin details in a dialog and keeps local toolchain selection there", async () => {
    pluginApiMocks.getPluginCatalog.mockResolvedValue({
      items: [sampleToolchainEntry()],
      warnings: [],
    });
    toolchainApiMocks.pickToolchainDirectory.mockResolvedValue("C:\\Tools\\Tectonic");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<PluginMarketplace settings={null} t={(key) => String(key)} />);
      await flushAsyncUpdates();
    });

    expect(container.textContent).toContain("Tectonic");
    expect(container.textContent).not.toContain("plugins.toolchain.pickLocal");

    const detailsButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("plugins.details")
    );
    await act(async () => {
      detailsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsyncUpdates();
    });

    expect(document.body.textContent).toContain("plugins.detail.permissions");
    expect(document.body.textContent).toContain("workspace.read");
    expect(document.body.textContent).toContain("plugins.permissionHint.workspaceRead");
    expect(document.body.textContent).toContain("plugins.toolchain.pickLocal");

    const localFolderButton = Array.from(document.body.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("plugins.toolchain.pickLocal")
    );
    await act(async () => {
      localFolderButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsyncUpdates();
    });

    expect(toolchainApiMocks.pickToolchainDirectory).toHaveBeenCalledTimes(1);
    expect(toolchainApiMocks.registerLocalToolchain).toHaveBeenCalledWith(
      "latotex.tectonic",
      "tectonic.windows-x64",
      "C:\\Tools\\Tectonic",
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("routes a ready trusted runtime to terminal and Agent profiles", async () => {
    pluginApiMocks.getPluginCatalog.mockResolvedValue({
      items: [sampleAgentRuntimeEntry()],
      warnings: [],
    });
    agentRuntimeApiMocks.listAgentRuntimes.mockResolvedValue([{
      id: "codex-cli",
      pluginId: "latotex.agent.codex-cli",
      labelKey: "agents.runtime.codexCli",
      source: "path",
      available: true,
      authenticated: true,
      enabled: true,
      executablePath: "C:\\Tools\\codex.exe",
      version: "codex-cli 0.146.0",
      failure: null,
      checkedAt: "2026-08-07T00:00:00Z",
    }]);
    agentRuntimeApiMocks.updateAgentRuntime.mockResolvedValue({
      id: "codex-cli",
      pluginId: "latotex.agent.codex-cli",
      labelKey: "agents.runtime.codexCli",
      source: "path",
      available: true,
      authenticated: true,
      enabled: true,
      executablePath: "C:\\Tools\\codex.exe",
      version: "codex-cli 0.147.0",
      failure: null,
      checkedAt: "2026-08-07T00:01:00Z",
    });
    const onOpenAgentTerminal = vi.fn();
    const onOpenAgentControl = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PluginMarketplace
          settings={null}
          onOpenAgentTerminal={onOpenAgentTerminal}
          onOpenAgentControl={onOpenAgentControl}
          t={(key) => String(key)}
        />,
      );
      await flushAsyncUpdates();
    });

    const terminalButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("plugins.agentRuntime.openTerminal")
    );
    const profilesButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("plugins.agentRuntime.useForProfiles")
    );
    const updateButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("plugins.agentRuntime.update")
    );
    expect(terminalButton?.disabled).toBe(false);

    await act(async () => {
      terminalButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      profilesButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpenAgentTerminal).toHaveBeenCalledWith("codex-cli");
    expect(onOpenAgentControl).toHaveBeenCalledTimes(1);

    await act(async () => {
      updateButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsyncUpdates();
    });
    expect(agentRuntimeApiMocks.updateAgentRuntime).toHaveBeenCalledWith("codex-cli");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
