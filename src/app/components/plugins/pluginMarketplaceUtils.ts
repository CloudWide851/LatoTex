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
import type { PluginContribution, PluginManifest } from "../../../shared/plugins/pluginTypes";

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

export function contributionSummary(plugin: PluginManifest, locale: string): string {
  return plugin.contributions.map((item) => localizedContributionTitle(item, locale)).filter(Boolean).join(", ");
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
