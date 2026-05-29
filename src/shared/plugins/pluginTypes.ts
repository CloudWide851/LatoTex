export type PluginMcpServerTemplate = {
  id: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type PluginCommandTemplate = {
  id: string;
  title: string;
  command: string;
  args?: string[];
};

export type PluginToolchainInstaller = {
  id: string;
  kind: "git" | "go" | "python" | "node" | "c" | "cpp" | "zig" | "rust" | string;
  platform: "windows-x64" | string;
  downloadUrl: string;
  downloadUrlCn?: string | null;
  sha256: string;
  archiveFormat: "zip" | "exe" | string;
  executable: string;
  versionArg?: string | null;
};

export type PluginRuntimeAsset = {
  id: string;
  kind: "drawio" | "tectonic" | "poppler" | "cloudflared" | "uv" | "python" | string;
  platform: "windows-x64" | string;
  downloadUrl: string;
  downloadUrlCn?: string | null;
  sha256: string;
  archiveFormat: "zip" | "exe" | string;
  entryPath: string;
};

export type PluginToolchainProbe = {
  id: string;
  kind: "zig" | "rust" | "git" | "go" | "python" | "node" | "c" | "cpp" | string;
  platform: "windows-x64" | string;
  executables: string[];
  versionArg?: string | null;
};

export type PluginCommandRef = {
  id: string;
  title?: string | null;
};

export type PluginContribution = {
  kind:
    | "workspacePage"
    | "settingsSection"
    | "command"
    | "mcpServer"
    | "skill"
    | "docxTool"
    | "toolbarButton"
    | "menuItem"
    | "statusItem"
    | "workspaceCommand"
    | "docxCommand"
    | "editorCommand"
    | "analysisCommand"
    | "libraryCommand"
    | "markdownCommand"
    | "terminalCommand"
    | "resourceCommand"
    | "toolchainInstaller"
    | "toolchainProbe"
    | "runtimeAsset"
    | string;
  id: string;
  title: string;
  description?: string | null;
  commandRef?: PluginCommandRef | null;
  location?: string | null;
  group?: string | null;
  when?: string | null;
  mcpServer?: PluginMcpServerTemplate | null;
  command?: PluginCommandTemplate | null;
  skillId?: string | null;
  toolchainInstaller?: PluginToolchainInstaller | null;
  toolchainProbe?: PluginToolchainProbe | null;
  runtimeAsset?: PluginRuntimeAsset | null;
};

export type PluginManifest = {
  schema: "latotex.plugin.v1" | string;
  id: string;
  name: string;
  displayName?: string | null;
  publisher: string;
  version: string;
  description: string;
  categories: string[];
  icon?: string | null;
  downloadUrl?: string | null;
  sha256?: string | null;
  homepage?: string | null;
  repository?: string | null;
  license?: string | null;
  keywords?: string[];
  engines?: { latotex?: string | null } | null;
  activationEvents?: string[];
  capabilities?: {
    untrustedWorkspaces?: "supported" | "limited" | "unsupported" | string;
    virtualWorkspaces?: boolean;
  } | null;
  permissions: string[];
  contributions: PluginContribution[];
};

export type PluginCatalogSource = {
  id: string;
  name: string;
  url: string;
  enabled?: boolean;
};

export type PluginValidationIssue = {
  code: string;
  severity: "info" | "warning" | "error" | string;
  message: string;
};

export type PluginValidationResult = {
  ok: boolean;
  issues: PluginValidationIssue[];
};

export type PluginCatalogEntry = {
  manifest: PluginManifest;
  sourceId: string;
  sourceName: string;
  validation: PluginValidationResult;
};

export type InstalledPlugin = {
  manifest: PluginManifest;
  enabled: boolean;
  installedAt: string;
  source: string;
  validationIssues?: PluginValidationIssue[];
};

export type ToolchainStatus = {
  pluginId: string;
  contributionId: string;
  kind: string;
  installed: boolean;
  installPath?: string | null;
  executablePath?: string | null;
  version?: string | null;
  message: string;
};

export type RuntimeAssetStatus = {
  pluginId: string;
  contributionId: string;
  kind: string;
  installed: boolean;
  installPath?: string | null;
  entryPath?: string | null;
  message: string;
};

export type PluginCatalogResponse = {
  schema: "latotex.marketplace.v1" | string;
  items: PluginCatalogEntry[];
  warnings: string[];
};
