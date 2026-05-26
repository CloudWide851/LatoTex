export type PluginMcpServerTemplate = {
  id: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type PluginContribution = {
  kind: "workspacePage" | "settingsSection" | "command" | "mcpServer" | "skill" | "docxTool" | string;
  id: string;
  title: string;
  description?: string | null;
  mcpServer?: PluginMcpServerTemplate | null;
  skillId?: string | null;
};

export type PluginManifest = {
  schema: "latotex.plugin.v1" | string;
  id: string;
  name: string;
  publisher: string;
  version: string;
  description: string;
  categories: string[];
  icon?: string | null;
  downloadUrl?: string | null;
  sha256?: string | null;
  permissions: string[];
  contributions: PluginContribution[];
};

export type InstalledPlugin = {
  manifest: PluginManifest;
  enabled: boolean;
  installedAt: string;
  source: string;
};

export type PluginCatalogResponse = {
  schema: "latotex.marketplace.v1" | string;
  items: PluginManifest[];
  warnings: string[];
};
