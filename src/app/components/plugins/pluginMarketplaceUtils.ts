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
  PluginManifest,
  PluginValidationIssue,
  RuntimeAssetStatus,
  ToolchainStatus,
} from "../../../shared/plugins/pluginTypes";

export type TranslationFn = (key: any) => string;

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
  return issue.message || t("plugins.validationIssue.generic").replace("{code}", issue.code);
}
