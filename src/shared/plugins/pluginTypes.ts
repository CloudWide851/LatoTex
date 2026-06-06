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
  kind: "git" | "go" | "python" | "node" | "java" | "c" | "cpp" | "zig" | "rust" | string;
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
  kind: "zig" | "rust" | "git" | "go" | "python" | "node" | "java" | "c" | "cpp" | string;
  platform: "windows-x64" | string;
  executables: string[];
  versionArg?: string | null;
};

export type PluginFileOpenHandler = {
  extensions: string[];
  filenames?: string[];
  patterns?: string[];
  openWith: "text" | "monaco" | "docx" | "markdown" | "html" | "image" | "pdf" | "binary" | string;
};

export type PluginPreviewProvider = {
  extensions: string[];
  filenames?: string[];
  patterns?: string[];
  previewMode: "text" | "code" | "markdown" | "html" | "image" | "pdf" | "csv" | "excel" | string;
};

export type PluginResourceBadge = {
  extensions: string[];
  filenames?: string[];
  label: string;
  color?: "neutral" | "blue" | "green" | "amber" | "rose" | "purple" | string | null;
};

export type PluginResourceClassifier = {
  extensions: string[];
  filenames?: string[];
  patterns?: string[];
  category: "source" | "document" | "data" | "image" | "config" | "runtime" | string;
  icon?: "file" | "code" | "book" | "image" | "table" | "settings" | "tool" | string | null;
  color?: "neutral" | "blue" | "green" | "amber" | "rose" | "purple" | string | null;
};

export type PluginProblemMatcher = {
  owner: string;
  pattern: string;
  fileGroup?: number | null;
  lineGroup?: number | null;
  columnGroup?: number | null;
  messageGroup?: number | null;
  severity?: "info" | "warning" | "error" | string | null;
};

export type PluginPanel = {
  location: "plugins.details" | "settings.plugins" | "workspace.empty" | string;
  title: string;
  markdown: string;
};

export type PluginSettingsQuickAction = {
  section: "plugins" | "agentPermissions" | "appearance" | "runtime" | "channels" | "editor" | "toolchains" | string;
  commandRef?: PluginCommandRef | null;
};

export type PluginRuntimeAssetDetector = {
  kind: "drawio" | "tectonic" | "poppler" | "cloudflared" | "uv" | "python" | string;
  filenames: string[];
};

export type PluginSettingsSchemaField = {
  key: string;
  fieldKind: "string" | "boolean" | "number" | "select" | "url" | string;
  label: string;
  required?: boolean | null;
  options?: string[];
};

export type PluginSettingsSchema = {
  section: "plugins" | "agentPermissions" | "appearance" | "runtime" | "channels" | "editor" | "toolchains" | string;
  fields: PluginSettingsSchemaField[];
};

export type PluginFileTemplate = {
  extensions: string[];
  defaultName: string;
  templateKind: "empty" | "latex" | "markdown" | "docx" | "text" | string;
  content: string;
};

export type PluginSnippet = {
  label: string;
  prefix: string;
  body: string;
};

export type PluginSnippetProvider = {
  languages: string[];
  snippets: PluginSnippet[];
};

export type PluginAgentContextPack = {
  scopes: string[];
  includePatterns: string[];
  excludePatterns?: string[];
  maxFiles?: number | null;
  maxBytes?: number | null;
};

export type PluginLanguageSupport = {
  language: string;
  extensions: string[];
  filenames?: string[];
  patterns?: string[];
  editorLanguage?: string | null;
  previewMode?: "text" | "code" | "markdown" | "html" | "image" | "pdf" | "csv" | "excel" | string | null;
};

export type PluginCommandRef = {
  id: string;
  title?: string | null;
};

export type PluginSidebarView = {
  location: "workspace.sidebar" | "settings.sidebar" | "plugins.sidebar" | string;
  title: string;
  icon?: "file" | "code" | "book" | "image" | "table" | "settings" | "tool" | string | null;
  markdown: string;
};

export type PluginTreeDecoration = {
  extensions: string[];
  filenames?: string[];
  patterns?: string[];
  badge?: string | null;
  color?: "neutral" | "blue" | "green" | "amber" | "rose" | "purple" | string | null;
  icon?: "file" | "code" | "book" | "image" | "table" | "settings" | "tool" | string | null;
};

export type PluginCommandPaletteItem = {
  category?: string | null;
  keywords?: string[];
  commandRef?: PluginCommandRef | null;
};

export type PluginLocalizedContribution = {
  title?: string | null;
  description?: string | null;
};

export type PluginLocalizedManifest = {
  name?: string | null;
  displayName?: string | null;
  description?: string | null;
  categories?: string[];
  keywords?: string[];
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
    | "fileOpenHandler"
    | "previewProvider"
    | "resourceBadge"
    | "resourceClassifier"
    | "problemMatcher"
    | "pluginPanel"
    | "sidebarView"
    | "treeDecoration"
    | "commandPaletteItem"
    | "settingsQuickAction"
    | "runtimeAssetDetector"
    | "settingsSchema"
    | "fileTemplate"
    | "snippetProvider"
    | "agentContextPack"
    | "languageSupport"
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
  fileOpenHandler?: PluginFileOpenHandler | null;
  previewProvider?: PluginPreviewProvider | null;
  resourceBadge?: PluginResourceBadge | null;
  resourceClassifier?: PluginResourceClassifier | null;
  problemMatcher?: PluginProblemMatcher | null;
  pluginPanel?: PluginPanel | null;
  sidebarView?: PluginSidebarView | null;
  treeDecoration?: PluginTreeDecoration | null;
  commandPaletteItem?: PluginCommandPaletteItem | null;
  settingsQuickAction?: PluginSettingsQuickAction | null;
  runtimeAssetDetector?: PluginRuntimeAssetDetector | null;
  settingsSchema?: PluginSettingsSchema | null;
  fileTemplate?: PluginFileTemplate | null;
  snippetProvider?: PluginSnippetProvider | null;
  agentContextPack?: PluginAgentContextPack | null;
  languageSupport?: PluginLanguageSupport | null;
  localized?: Record<string, PluginLocalizedContribution> | null;
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
  localized?: Record<string, PluginLocalizedManifest> | null;
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
  params?: Record<string, string> | null;
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
  source?: "managed" | "local" | "bundled" | "missing" | string;
};

export type RuntimeAssetStatus = {
  pluginId: string;
  contributionId: string;
  kind: string;
  installed: boolean;
  installPath?: string | null;
  entryPath?: string | null;
  message: string;
  source?: "managed" | "local" | "bundled" | "missing" | string;
};

export type PluginCatalogResponse = {
  schema: "latotex.marketplace.v1" | string;
  items: PluginCatalogEntry[];
  warnings: string[];
};
