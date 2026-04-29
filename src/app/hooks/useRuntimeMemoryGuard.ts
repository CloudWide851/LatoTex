import { useEffect, useRef } from "react";
import { runtimeLogWrite, runtimeMemorySnapshot } from "../../shared/api/runtime";
import type { SwarmEvent } from "../../shared/types/app";
import { trimEventsForMemoryPressure } from "./eventMemoryBudget";

const MB = 1024 * 1024;
const HIGH_WATERMARK_MB = 560;
const CRITICAL_WATERMARK_MB = 760;
const LOG_COOLDOWN_MS = 90_000;

type MemoryLevel = "normal" | "high" | "critical";

export function useRuntimeMemoryGuard(params: {
  isTauriRuntime: boolean;
  setEvents: React.Dispatch<React.SetStateAction<SwarmEvent[]>>;
  suspended?: boolean;
  prefs?: {
    enabled?: boolean;
    highWatermarkMb?: number;
    criticalWatermarkMb?: number;
    sampleIntervalSec?: number;
    criticalAction?: "release" | "sleep";
  } | null;
  onHighMemory?: () => void;
  onCriticalMemory?: (action: "release" | "sleep") => void;
}) {
  const {
    isTauriRuntime,
    setEvents,
    suspended = false,
    prefs,
    onHighMemory,
    onCriticalMemory,
  } = params;
  const levelRef = useRef<MemoryLevel>("normal");
  const lastLoggedAtRef = useRef(0);

  useEffect(() => {
    if (!isTauriRuntime || suspended || prefs?.enabled === false) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = (ms: number) => {
      if (cancelled) {
        return;
      }
      timer = setTimeout(() => {
        void sample();
      }, ms);
    };

    const logWithCooldown = async (level: "INFO" | "WARN", message: string) => {
      const now = Date.now();
      if (now - lastLoggedAtRef.current < LOG_COOLDOWN_MS) {
        return;
      }
      lastLoggedAtRef.current = now;
      await runtimeLogWrite(level, message).catch(() => undefined);
    };

    const sample = async () => {
      try {
        const snapshot = await runtimeMemorySnapshot();
        if (cancelled) {
          return;
        }

        const measuredRssBytes = snapshot.totalRssBytes ?? snapshot.rssBytes;
        const measuredPrivateBytes = snapshot.totalPrivateBytes ?? snapshot.privateBytes ?? null;
        const rssMb = Math.round(measuredRssBytes / MB);
        const privateMb = measuredPrivateBytes != null
          ? Math.round(Number(measuredPrivateBytes) / MB)
          : null;
        const webviewMb = snapshot.webviewRssBytes != null
          ? Math.round(Number(snapshot.webviewRssBytes) / MB)
          : null;
        const webviewCount = snapshot.webviewProcessCount ?? null;

        const highWatermarkMb = prefs?.highWatermarkMb ?? HIGH_WATERMARK_MB;
        const criticalWatermarkMb = prefs?.criticalWatermarkMb ?? CRITICAL_WATERMARK_MB;
        const nextLevel: MemoryLevel = rssMb >= criticalWatermarkMb
          ? "critical"
          : rssMb >= highWatermarkMb
            ? "high"
            : "normal";

        if (nextLevel === "critical") {
          setEvents((prev) => trimEventsForMemoryPressure(prev, {
            maxEvents: 96,
            minEvents: 48,
            maxBytes: 120_000,
          }));
          await logWithCooldown(
            "WARN",
            `runtime memory critical: rss=${rssMb}MB, private=${privateMb ?? "-"}MB, webview=${webviewMb ?? "-"}MB, webviewProcesses=${webviewCount ?? "-"}`,
          );
          if (levelRef.current !== "critical") {
            onCriticalMemory?.(prefs?.criticalAction ?? "sleep");
          }
        } else if (nextLevel === "high") {
          setEvents((prev) => trimEventsForMemoryPressure(prev, {
            maxEvents: 160,
            minEvents: 72,
            maxBytes: 180_000,
          }));
          onHighMemory?.();
          if (levelRef.current === "normal") {
            await logWithCooldown(
              "WARN",
              `runtime memory high: rss=${rssMb}MB, private=${privateMb ?? "-"}MB, webview=${webviewMb ?? "-"}MB, webviewProcesses=${webviewCount ?? "-"}`,
            );
          }
        } else if (levelRef.current !== "normal") {
          await logWithCooldown(
            "INFO",
            `runtime memory recovered: rss=${rssMb}MB, private=${privateMb ?? "-"}MB, webview=${webviewMb ?? "-"}MB, webviewProcesses=${webviewCount ?? "-"}`,
          );
        }

        levelRef.current = nextLevel;
      } catch {
        // ignore guard sampling failure
      } finally {
        const hidden = typeof document !== "undefined" && document.hidden;
        const configuredIntervalMs = Math.max(10, Math.min(180, prefs?.sampleIntervalSec ?? 25)) * 1000;
        const intervalMs = hidden ? Math.max(60_000, configuredIntervalMs) : configuredIntervalMs;
        schedule(intervalMs);
      }
    };

    schedule(12_000);
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [isTauriRuntime, onCriticalMemory, onHighMemory, prefs, setEvents, suspended]);
}

