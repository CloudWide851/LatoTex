import type { Ack } from "../types/app";
import type {
  InstalledPlugin,
  PluginCatalogResponse,
  PluginCatalogSource,
  PluginManifest,
  PluginValidationResult,
} from "../plugins/pluginTypes";
import { invokeCommand } from "./core";

export function getPluginCatalog(catalogSources?: PluginCatalogSource[], catalogUrl?: string): Promise<PluginCatalogResponse> {
  return invokeCommand<PluginCatalogResponse>("plugin_marketplace_catalog", {
    input: { catalogSources, catalogUrl },
  });
}

export function listInstalledPlugins(): Promise<InstalledPlugin[]> {
  return invokeCommand<InstalledPlugin[]>("plugin_installed_list");
}

export function installPlugin(manifest: PluginManifest): Promise<InstalledPlugin> {
  return invokeCommand<InstalledPlugin>("plugin_install", { input: { manifest } });
}

export function validatePluginManifest(manifest: PluginManifest): Promise<PluginValidationResult> {
  return invokeCommand<PluginValidationResult>("plugin_validate_manifest", { input: { manifest } });
}

export function uninstallPlugin(pluginId: string): Promise<Ack> {
  return invokeCommand<Ack>("plugin_uninstall", { input: { pluginId } });
}

export function setPluginEnabled(pluginId: string, enabled: boolean): Promise<InstalledPlugin> {
  return invokeCommand<InstalledPlugin>("plugin_set_enabled", {
    input: { pluginId, enabled },
  });
}
