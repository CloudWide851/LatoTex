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

export type PluginContribution = {
  kind: "workspacePage" | "settingsSection" | "command" | "mcpServer" | "skill" | "docxTool" | string;
  id: string;
  title: string;
  description?: string | null;
  mcpServer?: PluginMcpServerTemplate | null;
  command?: PluginCommandTemplate | null;
  skillId?: string | null;
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

export type PluginCatalogResponse = {
  schema: "latotex.marketplace.v1" | string;
  items: PluginCatalogEntry[];
  warnings: string[];
};
