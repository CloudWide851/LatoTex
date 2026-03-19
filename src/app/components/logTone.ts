import type { RuntimeLogEntry } from "../../shared/types/app";

export type LogTone = {
  rowClass: string;
  badgeClass: string;
  textClass: string;
};

function classifyLogTone(level: string, message: string): "info" | "warn" | "error" | "crash" | "success" {
  const normalizedLevel = level.trim().toUpperCase();
  const normalizedMessage = message.toLowerCase();
  if (normalizedLevel.includes("CRASH") || normalizedMessage.includes("panic")) {
    return "crash";
  }
  if (
    normalizedLevel.includes("ERROR") ||
    normalizedMessage.includes("fatal") ||
    normalizedMessage.includes("exception")
  ) {
    return "error";
  }
  if (normalizedLevel.includes("WARN") || normalizedMessage.includes("retry")) {
    return "warn";
  }
  if (
    normalizedMessage.includes("success") ||
    normalizedMessage.includes("completed") ||
    normalizedMessage.includes("ok=true") ||
    normalizedMessage.includes("done")
  ) {
    return "success";
  }
  return "info";
}

export function normalizeLogLevel(levelRaw: string, messageRaw = ""): "INFO" | "WARN" | "ERROR" | "CRASH" | "SUCCESS" {
  const tone = classifyLogTone(levelRaw, messageRaw);
  if (tone === "warn") {
    return "WARN";
  }
  if (tone === "error") {
    return "ERROR";
  }
  if (tone === "crash") {
    return "CRASH";
  }
  if (tone === "success") {
    return "SUCCESS";
  }
  return "INFO";
}

export function resolveLogTone(levelRaw: string, messageRaw = ""): LogTone {
  const tone = classifyLogTone(levelRaw, messageRaw);
  if (tone === "crash") {
    return {
      rowClass: "border-rose-500/45 bg-rose-500/10",
      badgeClass: "border border-rose-500/40 bg-rose-500/15 text-rose-200",
      textClass: "text-rose-100",
    };
  }
  if (tone === "error") {
    return {
      rowClass: "border-rose-400/45 bg-rose-500/6",
      badgeClass: "border border-rose-400/45 bg-rose-500/12 text-rose-200",
      textClass: "text-rose-100",
    };
  }
  if (tone === "warn") {
    return {
      rowClass: "border-amber-400/45 bg-amber-500/8",
      badgeClass: "border border-amber-300/45 bg-amber-500/12 text-amber-100",
      textClass: "text-amber-100",
    };
  }
  if (tone === "success") {
    return {
      rowClass: "border-emerald-400/45 bg-emerald-500/8",
      badgeClass: "border border-emerald-300/45 bg-emerald-500/12 text-emerald-100",
      textClass: "text-emerald-100",
    };
  }
  return {
    rowClass: "border-sky-300/40 bg-sky-500/8",
    badgeClass: "border border-sky-300/40 bg-sky-500/10 text-sky-100",
    textClass: "text-slate-100",
  };
}

export function resolveRuntimeLogTone(entry: RuntimeLogEntry): LogTone {
  return resolveLogTone(entry.level, entry.message || entry.raw);
}

export function resolveLineTone(line: string): LogTone {
  return resolveLogTone(line, line);
}