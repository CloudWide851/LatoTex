import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_IDLE_TIMEOUT_MS = 60 * 60 * 1000;
const ACTIVITY_THROTTLE_MS = 1200;

export function useIdleSleep(params?: {
  timeoutMs?: number;
  blocked?: boolean;
}) {
  const timeoutMs = Number(params?.timeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS);
  const blocked = Boolean(params?.blocked);
  const [sleeping, setSleeping] = useState(false);
  const [lastActiveAt, setLastActiveAt] = useState<number>(() => Date.now());
  const lastMarkRef = useRef(lastActiveAt);

  const wake = useCallback(() => {
    const now = Date.now();
    lastMarkRef.current = now;
    setLastActiveAt(now);
    setSleeping(false);
  }, []);

  const markActivity = useCallback(() => {
    const now = Date.now();
    if (now - lastMarkRef.current < ACTIVITY_THROTTLE_MS) {
      return;
    }
    lastMarkRef.current = now;
    setLastActiveAt(now);
    if (sleeping) {
      setSleeping(false);
    }
  }, [sleeping]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const onPointer = () => markActivity();
    const onKey = () => markActivity();
    const onWheel = () => markActivity();
    const onTouch = () => markActivity();
    const onVisibility = () => {
      if (!document.hidden) {
        markActivity();
      }
    };
    window.addEventListener("pointerdown", onPointer, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchstart", onTouch, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouch);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [markActivity]);

  useEffect(() => {
    if (sleeping || blocked || timeoutMs <= 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      if (!blocked) {
        setSleeping(true);
      }
    }, Math.max(1000, timeoutMs - (Date.now() - lastActiveAt)));
    return () => window.clearTimeout(timer);
  }, [blocked, lastActiveAt, sleeping, timeoutMs]);

  const idleMinutes = useMemo(() => Math.max(1, Math.round(timeoutMs / 60000)), [timeoutMs]);

  return {
    sleeping,
    wake,
    markActivity,
    idleMinutes,
  };
}
