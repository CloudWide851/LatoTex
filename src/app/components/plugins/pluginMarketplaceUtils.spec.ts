import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../shared/plugins/pluginTypes";
import {
  describeValidationIssue,
  integrationLevelLabel,
  marketplaceEntryMatchesFilters,
  runtimeSourceLabel,
} from "./pluginMarketplaceUtils";

function scienceManifest(): PluginManifest {
  return {
    schema: "latotex.plugin.v1",
    id: "latotex.science.matlab",
    name: "MATLAB",
    publisher: "LatoTex",
    version: "1.0.0",
    description: "Numerical computing",
    categories: ["Research", "Numerical Computing"],
    keywords: ["matlab", "scientific computing"],
    permissions: [],
    contributions: [],
    integrationLevel: "full",
    runtimeSource: "local",
  };
}

describe("pluginMarketplaceUtils", () => {
  it("localizes high-risk permission issues from structured params", () => {
    const text = describeValidationIssue(
      {
        code: "plugin.permission.high_risk",
        severity: "warning",
        message: "High-risk permission declared: network.fetch.",
        params: { permission: "network.fetch" },
      },
      (key) => key === "plugins.validationIssue.permissionHighRisk"
        ? "声明了高风险权限：{permission}。"
        : String(key),
    );

    expect(text).toBe("声明了高风险权限：network.fetch。");
  });

  it("localizes high-risk permission issues from legacy messages", () => {
    const text = describeValidationIssue(
      {
        code: "plugin.permission.high_risk",
        severity: "warning",
        message: "High-risk permission declared: process.spawn.",
      },
      (key) => key === "plugins.validationIssue.permissionHighRisk"
        ? "声明了高风险权限：{permission}。"
        : String(key),
    );

    expect(text).toBe("声明了高风险权限：process.spawn。");
  });

  it("filters research entries by category, capability, and localized search", () => {
    const manifest = scienceManifest();
    expect(marketplaceEntryMatchesFilters({
      manifest,
      sourceName: "Built-in",
      locale: "en-US",
      query: "numerical",
      scienceFilter: "computing",
      integrationFilter: "full",
    })).toBe(true);
    expect(marketplaceEntryMatchesFilters({
      manifest,
      sourceName: "Built-in",
      locale: "en-US",
      query: "",
      scienceFilter: "connectors",
      integrationFilter: "all",
    })).toBe(false);
    expect(marketplaceEntryMatchesFilters({
      manifest,
      sourceName: "Built-in",
      locale: "en-US",
      query: "",
      scienceFilter: "all",
      integrationFilter: "connector",
    })).toBe(false);
  });

  it("maps capability metadata through localized labels", () => {
    const manifest = scienceManifest();
    const t = (key: string) => ({
      "plugins.integration.full": "Completa",
      "plugins.runtimeSource.local": "Local",
    })[key] ?? key;
    expect(integrationLevelLabel(manifest, t)).toBe("Completa");
    expect(runtimeSourceLabel(manifest, t)).toBe("Local");
  });
});
