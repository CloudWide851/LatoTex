import {
  Box,
  Code2,
  FileText,
  GitBranch,
  Network,
  Package,
  PenTool,
  Puzzle,
  ShieldAlert,
  Terminal,
} from "lucide-react";
import type {
  PluginContribution,
  PluginIntegrityPolicy,
  PluginIntegrationLevel,
  PluginManifest,
  PluginRuntimeSource,
  PluginTelemetryPolicy,
  PluginValidationIssue,
  RuntimeAssetStatus,
  ToolchainStatus,
} from "../../../shared/plugins/pluginTypes";
import type { TranslationFn } from "../../types/i18n";

export type { TranslationFn } from "../../types/i18n";

const INTEGRATION_LABEL_KEYS: Record<PluginIntegrationLevel, Parameters<TranslationFn>[0]> = {
  full: "plugins.integration.full",
  controlled: "plugins.integration.controlled",
  connector: "plugins.integration.connector",
};

const RUNTIME_SOURCE_LABEL_KEYS: Record<PluginRuntimeSource, Parameters<TranslationFn>[0]> = {
  bundled: "plugins.runtimeSource.bundled",
  managed: "plugins.runtimeSource.managed",
  local: "plugins.runtimeSource.local",
  external: "plugins.runtimeSource.external",
};

const INTEGRITY_LABEL_KEYS: Record<PluginIntegrityPolicy, Parameters<TranslationFn>[0]> = {
  bundled: "plugins.integrity.bundled",
  sha256: "plugins.integrity.sha256",
  authenticode: "plugins.integrity.authenticode",
  "sha256+authenticode": "plugins.integrity.sha256Authenticode",
  "local-probe": "plugins.integrity.localProbe",
};

const TELEMETRY_LABEL_KEYS: Record<PluginTelemetryPolicy, Parameters<TranslationFn>[0]> = {
  disabled: "plugins.telemetry.disabled",
  none: "plugins.telemetry.none",
  "vendor-controlled": "plugins.telemetry.vendorControlled",
  "not-applicable": "plugins.telemetry.notApplicable",
};

export const HIGH_RISK_PLUGIN_PERMISSIONS = new Set([
  "workspace.write",
  "process.spawn",
  "shell",
  "network.fetch",
  "env.read",
  "secrets.read",
  "mcp",
  "plugin.command",
]);

export function localeOf(settingsLanguage: string | null | undefined): string {
  if (settingsLanguage === "zh-CN" || settingsLanguage === "es-ES" || settingsLanguage === "ja-JP") {
    return settingsLanguage;
  }
  return "en-US";
}

export function localizedPlugin(plugin: PluginManifest, locale: string) {
  const localized = plugin.localized?.[locale] ?? plugin.localized?.["en-US"] ?? null;
  return {
    name: localized?.displayName || localized?.name || plugin.displayName || plugin.name,
    description: localized?.description || plugin.description,
    categories: localized?.categories?.length ? localized.categories : plugin.categories,
    keywords: localized?.keywords?.length ? localized.keywords : (plugin.keywords ?? []),
  };
}

export function marketplaceEntryMatchesFilters(input: {
  manifest: PluginManifest;
  sourceName: string;
  locale: string;
  query: string;
  scienceFilter: string;
  integrationFilter: string;
}): boolean {
  const {
    manifest,
    sourceName,
    locale,
    query,
    scienceFilter,
    integrationFilter,
  } = input;
  const localized = localizedPlugin(manifest, locale);
  const needle = query.trim().toLowerCase();
  const searchMatches = !needle || [
    localized.name,
    localized.description,
    localized.categories.join(" "),
    localized.keywords.join(" "),
    manifest.name,
    manifest.displayName ?? "",
    manifest.publisher,
    manifest.description,
    manifest.id,
    sourceName,
    manifest.categories.join(" "),
    (manifest.keywords ?? []).join(" "),
  ]
    .join(" ")
    .toLowerCase()
    .includes(needle);
  const text = `${manifest.id} ${manifest.categories.join(" ")} ${(manifest.keywords ?? []).join(" ")}`.toLowerCase();
  const scienceMatches = scienceFilter === "all"
    || (scienceFilter === "research" && manifest.id.startsWith("latotex.science."))
    || (scienceFilter === "statistics" && /statistics|statistical|spss|sas|stata|science\.r\b/.test(text))
    || (scienceFilter === "computing" && /matlab|octave|julia|numerical|scientific computing/.test(text))
    || (scienceFilter === "publishing" && /quarto|jupyter|zotero|publishing|notebook|references/.test(text))
    || (scienceFilter === "connectors" && manifest.integrationLevel === "connector");
  const integrationMatches = integrationFilter === "all"
    || manifest.integrationLevel === integrationFilter;
  return searchMatches && scienceMatches && integrationMatches;
}

export function localizedContributionTitle(contribution: PluginContribution, locale: string): string {
  const localized = contribution.localized?.[locale] ?? contribution.localized?.["en-US"] ?? null;
  return localized?.title || contribution.title;
}

export function localizedContribution(contribution: PluginContribution, locale: string) {
  const localized = contribution.localized?.[locale] ?? contribution.localized?.["en-US"] ?? null;
  return {
    title: localized?.title || contribution.title,
    description: localized?.description || contribution.description || "",
  };
}

export function contributionSummary(plugin: PluginManifest, locale: string): string {
  return plugin.contributions.map((item) => localizedContributionTitle(item, locale)).filter(Boolean).join(", ");
}

export function integrationLevelLabel(plugin: PluginManifest, t: TranslationFn): string | null {
  return plugin.integrationLevel ? t(INTEGRATION_LABEL_KEYS[plugin.integrationLevel]) : null;
}

export function runtimeSourceLabel(plugin: PluginManifest, t: TranslationFn): string | null {
  return plugin.runtimeSource ? t(RUNTIME_SOURCE_LABEL_KEYS[plugin.runtimeSource]) : null;
}

export function integrityPolicyLabel(plugin: PluginManifest, t: TranslationFn): string | null {
  return plugin.integrity ? t(INTEGRITY_LABEL_KEYS[plugin.integrity]) : null;
}

export function telemetryPolicyLabel(plugin: PluginManifest, t: TranslationFn): string | null {
  return plugin.telemetry ? t(TELEMETRY_LABEL_KEYS[plugin.telemetry]) : null;
}

export function describeToolchainStatus(
  contribution: PluginContribution | undefined,
  status: ToolchainStatus | null,
  t: TranslationFn,
): string {
  if (status?.installed) {
    return t(status.source === "local" ? "plugins.toolchain.detected" : "plugins.toolchain.ready")
      .replace("{version}", status.version || status.executablePath || "-");
  }
  return contribution?.kind === "toolchainProbe"
    ? t("plugins.toolchain.notDetected")
    : t("plugins.toolchain.notInstalled");
}

export function describeRuntimeAssetStatus(
  status: RuntimeAssetStatus | null,
  t: TranslationFn,
): string {
  const runtimePath = status?.source === "bundled"
    ? status.installPath || status.entryPath || "-"
    : status?.entryPath || status?.installPath || "-";
  if (status?.installed) {
    return t(status.source === "bundled"
      ? "plugins.runtimeAsset.bundled"
      : status.source === "local"
        ? "plugins.runtimeAsset.detected"
        : "plugins.runtimeAsset.ready").replace("{path}", runtimePath);
  }
  return t("plugins.runtimeAsset.notInstalled");
}

export function iconFor(plugin: PluginManifest) {
  const categories = plugin.categories.join(" ").toLowerCase();
  const kinds = plugin.contributions.map((item) => item.kind).join(" ").toLowerCase();
  const keywords = (plugin.keywords ?? []).join(" ").toLowerCase();
  if (categories.includes("office") || kinds.includes("docx")) {
    return FileText;
  }
  if (keywords.includes("drawio") || keywords.includes("diagram") || categories.includes("drawing")) {
    return PenTool;
  }
  if (keywords.includes("git") || plugin.id.includes("git")) {
    return GitBranch;
  }
  if (kinds.includes("toolchain") || keywords.includes("compiler")) {
    return Code2;
  }
  if (kinds.includes("terminal")) {
    return Terminal;
  }
  if (kinds.includes("mcp") || categories.includes("mcp")) {
    return Network;
  }
  if (plugin.permissions.some((item) => item.includes("write") || item.includes("shell"))) {
    return ShieldAlert;
  }
  if (kinds.includes("command")) {
    return Puzzle;
  }
  if (kinds.includes("runtimeasset")) {
    return Box;
  }
  return Package;
}

export function issueTone(severity: string): string {
  if (severity === "error") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (severity === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function legacyHighRiskPermission(message: string): string | null {
  const match = message.match(/^High-risk permission declared:\s*(.+?)\.$/);
  return match?.[1]?.trim() || null;
}

export function describeValidationIssue(issue: PluginValidationIssue, t: TranslationFn): string {
  if (issue.code === "plugin.permission.high_risk") {
    const permission = issue.params?.permission || legacyHighRiskPermission(issue.message) || "";
    return t("plugins.validationIssue.permissionHighRisk").replace("{permission}", permission || "-");
  }
  if (issue.code === "plugin.manifest.download_https_required") {
    return t("plugins.validationIssue.downloadHttpsRequired");
  }
  if (issue.code === "plugin.manifest.sha256_missing") {
    return t("plugins.validationIssue.sha256Missing");
  }
  if (issue.code === "plugin.manifest.sha256_invalid") {
    return t("plugins.validationIssue.sha256Invalid");
  }
  return issue.message || t("plugins.validationIssue.generic").replace("{code}", issue.code);
}
