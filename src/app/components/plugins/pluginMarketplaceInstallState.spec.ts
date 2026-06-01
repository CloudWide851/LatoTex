import { describe, expect, it } from "vitest";
import type { InstalledPlugin, PluginCatalogEntry, PluginManifest } from "../../../shared/plugins/pluginTypes";
import { installedPluginForMarketplaceEntry } from "./pluginMarketplaceInstallState";

function manifest(id: string): PluginManifest {
  return {
    schema: "latotex.plugin.v1",
    id,
    name: id,
    publisher: "LatoTex",
    version: "1.0.0",
    description: "Plugin",
    categories: [],
    permissions: [],
    contributions: [],
  };
}

function entry(id: string, sourceId = "builtin"): PluginCatalogEntry {
  return {
    manifest: manifest(id),
    sourceId,
    sourceName: "Built-in",
    validation: { ok: true, issues: [] },
  };
}

describe("installedPluginForMarketplaceEntry", () => {
  it("treats the built-in DOCX workspace as installed", () => {
    const installed = installedPluginForMarketplaceEntry(
      entry("latotex.docx-workspace"),
      new Map(),
    );

    expect(installed?.enabled).toBe(true);
    expect(installed?.source).toBe("builtIn");
  });

  it("prefers an explicit installed registry entry", () => {
    const registryItem: InstalledPlugin = {
      manifest: manifest("latotex.docx-workspace"),
      enabled: false,
      installedAt: "2026-06-01T00:00:00Z",
      source: "catalog",
      validationIssues: [],
    };

    const installed = installedPluginForMarketplaceEntry(
      entry("latotex.docx-workspace"),
      new Map([[registryItem.manifest.id, registryItem]]),
    );

    expect(installed).toBe(registryItem);
  });

  it("does not mark non-built-in marketplace entries as installed", () => {
    expect(installedPluginForMarketplaceEntry(entry("publisher.docx", "remote"), new Map())).toBeUndefined();
  });
});
