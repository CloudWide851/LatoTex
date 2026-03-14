import { useEffect, useRef } from "react";
import { runtimeLogWrite, runtimeMemorySnapshot } from "../../shared/api/desktop";
import type { SwarmEvent } from "../../shared/types/app";
import { trimEventsForMemoryPressure } from "./eventMemoryBudget";

const MB = 1024 * 1024;
const HIGH_WATERMARK_MB = 720;
const CRITICAL_WATERMARK_MB = 980;
const LOG_COOLDOWN_MS = 90_000;

type MemoryLevel = "normal" | "high" | "critical";

export function useRuntimeMemoryGuard(params: {
  isTauriRuntime: boolean;
  setEvents: React.Dispatch<React.SetStateAction<SwarmEvent[]>>;
}) {
  const { isTauriRuntime, setEvents } = params;
  const levelRef = useRef<MemoryLevel>("normal");
  const lastLoggedAtRef = useRef(0);

  useEffect(() => {
    if (!isTauriRuntime) {
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
        const rssMb = Math.round(snapshot.rssBytes / MB);
        const privateMb = snapshot.privateBytes != null
          ? Math.round(Number(snapshot.privateBytes) / MB)
          : null;
        const nextLevel: MemoryLevel = rssMb >= CRITICAL_WATERMARK_MB
          ? "critical"
          : rssMb >= HIGH_WATERMARK_MB
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
            `runtime memory critical: rss=${rssMb}MB, private=${privateMb ?? "-"}MB`,
          );
        } else if (nextLevel === "high") {
          setEvents((prev) => trimEventsForMemoryPressure(prev, {
            maxEvents: 160,
            minEvents: 72,
            maxBytes: 180_000,
          }));
          if (levelRef.current === "normal") {
            await logWithCooldown(
              "WARN",
              `runtime memory high: rss=${rssMb}MB, private=${privateMb ?? "-"}MB`,
            );
          }
        } else if (levelRef.current !== "normal") {
          await logWithCooldown(
            "INFO",
            `runtime memory recovered: rss=${rssMb}MB, private=${privateMb ?? "-"}MB`,
          );
        }

        levelRef.current = nextLevel;
      } catch {
        // ignore guard sampling failure
      } finally {
        const hidden = typeof document !== "undefined" && document.hidden;
        const intervalMs = hidden ? 90_000 : 45_000;
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
  }, [isTauriRuntime, setEvents]);
}

