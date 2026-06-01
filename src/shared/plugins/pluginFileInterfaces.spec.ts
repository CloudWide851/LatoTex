import { describe, expect, it } from "vitest";
import {
  enabledPluginManifests,
  resolvePluginFileInterface,
  textBackedPluginPreviewMode,
} from "./pluginFileInterfaces";
import type { InstalledPlugin, PluginManifest } from "./pluginTypes";

function manifest(contributions: PluginManifest["contributions"]): PluginManifest {
  return {
    schema: "latotex.plugin.v1",
    id: "plugin.typst",
    name: "typst",
    publisher: "latotex",
    version: "1.0.0",
    description: "Typst",
    categories: [],
    permissions: [],
    contributions,
  };
}

describe("pluginFileInterfaces", () => {
  it("matches extensions, filenames, and safe relative glob patterns", () => {
    const resolved = resolvePluginFileInterface("notes/paper.typ", [
      manifest([
        {
          kind: "languageSupport",
          id: "typst-language",
          title: "Typst",
          languageSupport: {
            language: "typst",
            editorLanguage: "plaintext",
            previewMode: "markdown",
            extensions: ["typ"],
            filenames: [],
            patterns: ["notes/**/*.typ"],
          },
        },
      ]),
    ]);

    expect(resolved.editorLanguage).toBe("plaintext");
    expect(resolved.previewMode).toBe("markdown");
    expect(resolved.pluginId).toBe("plugin.typst");
    expect(resolved.contributionId).toBe("typst-language");
  });

  it("ignores disabled plugins when extracting enabled manifests", () => {
    const plugins: InstalledPlugin[] = [
      {
        manifest: manifest([]),
        enabled: false,
        installedAt: "2026-06-01T00:00:00Z",
        source: "registry",
      },
    ];

    expect(enabledPluginManifests(plugins)).toHaveLength(0);
  });

  it("limits right-pane plugin preview overrides to text-backed modes", () => {
    expect(textBackedPluginPreviewMode("markdown")).toBe("markdown");
    expect(textBackedPluginPreviewMode("html")).toBe("html");
    expect(textBackedPluginPreviewMode("csv")).toBe("csv");
    expect(textBackedPluginPreviewMode("pdf")).toBeNull();
  });
});
