import type { AnalysisOutputLanguage } from "./analysisTypes";
import type { Locale } from "../../i18n";

const EN_HINT_RE =
  /\b(in english|english output|respond in english|answer in english|use english)\b/i;
const ZH_HINT_RE =
  /(用中文|中文输出|中文回答|请用中文|使用中文|输出中文)/i;

export function resolveAnalysisLanguage(
  prompt: string,
  locale: Locale,
): AnalysisOutputLanguage {
  const text = prompt.trim();
  const defaultLanguage: AnalysisOutputLanguage = locale === "zh-CN" ? "zh-CN" : "en-US";
  if (!text) {
    return defaultLanguage;
  }
  if (EN_HINT_RE.test(text)) {
    return "en-US";
  }
  if (ZH_HINT_RE.test(text)) {
    return "zh-CN";
  }
  return defaultLanguage;
}

export function languageLabel(language: AnalysisOutputLanguage): string {
  return language === "zh-CN" ? "Chinese" : "English";
}
