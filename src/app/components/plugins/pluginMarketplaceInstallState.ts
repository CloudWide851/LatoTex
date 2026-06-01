import type { InstalledPlugin, PluginCatalogEntry } from "../../../shared/plugins/pluginTypes";

export function installedPluginForMarketplaceEntry(
  entry: PluginCatalogEntry,
  installedById: Map<string, InstalledPlugin>,
): InstalledPlugin | undefined {
  const installed = installedById.get(entry.manifest.id);
  if (installed) {
    return installed;
  }
  if (entry.sourceId === "builtin" && entry.manifest.id === "latotex.docx-workspace") {
    return {
      manifest: entry.manifest,
      enabled: true,
      installedAt: "",
      source: "builtIn",
      validationIssues: entry.validation.issues,
    };
  }
  return undefined;
}
