import { useCallback, useEffect, useRef, useState } from "react";
import { runtimeLogWrite } from "../../../shared/api/runtime";
import { resolveDrawioHostFrameSrc } from "./drawWorkspaceUtils";

type TranslationFn = (key: any) => string;
export type DrawFramePhase = "loading" | "ready" | "error";

export function formatDrawStartFailure(t: TranslationFn, detail?: string | null): string {
  const normalized = String(detail || "").trim();
  if (!normalized) {
    return t("draw.startFailed");
  }
  return t("draw.startFailedDetail").replace("{detail}", normalized);
}

function withReloadToken(url: string, reloadToken: number): string {
  const normalized = String(url || "").trim();
  if (!normalized) {
    return "";
  }
  return `${normalized}${normalized.includes("?") ? "&" : "?"}latotexReload=${reloadToken}`;
}

export function useDrawFrameLifecycle(params: {
  locale: string;
  t: TranslationFn;
  setStatus: (value: string) => void;
}) {
  const { locale, t, setStatus } = params;
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const initTimerRef = useRef<number | null>(null);
  const loadTimerRef = useRef<number | null>(null);
  const handshakeStageRef = useRef("boot");
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [framePhase, setFramePhase] = useState<DrawFramePhase>("loading");
  const [frameFailureDetail, setFrameFailureDetail] = useState<string | null>(null);
  const [frameReloadToken, setFrameReloadToken] = useState(0);
  const [frameDocumentLoaded, setFrameDocumentLoaded] = useState(false);

  const logDrawRuntime = useCallback((level: "INFO" | "WARN" | "ERROR", message: string) => {
    void runtimeLogWrite(level, `draw.workspace: ${message}`).catch(() => undefined);
  }, []);

  const clearFrameTimers = useCallback(() => {
    if (loadTimerRef.current !== null) {
      window.clearTimeout(loadTimerRef.current);
      loadTimerRef.current = null;
    }
    if (initTimerRef.current !== null) {
      window.clearTimeout(initTimerRef.current);
      initTimerRef.current = null;
    }
  }, []);

  const unloadFrame = useCallback((reason: string) => {
    clearFrameTimers();
    handshakeStageRef.current = `released:${reason}`;
    setFrameSrc(null);
    setFramePhase("error");
    setFrameFailureDetail(formatDrawStartFailure(t, t("draw.released")));
    setFrameDocumentLoaded(false);
    setStatus(t("draw.released"));
    logDrawRuntime("WARN", `frame_unloaded: reason=${reason}`);
  }, [clearFrameTimers, logDrawRuntime, setStatus, t]);

  useEffect(() => {
    try {
      const resolved = resolveDrawioHostFrameSrc(undefined, locale);
      if (!resolved) {
        const failure = formatDrawStartFailure(t, "drawio entry url is missing");
        handshakeStageRef.current = "missing_entry_url";
        setFramePhase("error");
        setFrameSrc(null);
        setFrameFailureDetail(failure);
        setStatus(failure);
        logDrawRuntime("ERROR", "entry_url_missing");
        return;
      }
      handshakeStageRef.current = "frame_src_resolved";
      setFramePhase("loading");
      setFrameFailureDetail(null);
      setFrameDocumentLoaded(false);
      setFrameSrc(withReloadToken(resolved, frameReloadToken));
      setStatus(t("draw.waiting"));
      logDrawRuntime("INFO", `frame_load_start: src=${resolved}, reload_token=${frameReloadToken}`);
    } catch (error) {
      const failure = formatDrawStartFailure(t, String(error));
      handshakeStageRef.current = "frame_src_failed";
      setFramePhase("error");
      setFrameSrc(null);
      setFrameFailureDetail(failure);
      setStatus(failure);
      logDrawRuntime("ERROR", `frame_src_failed: ${String(error)}`);
    }
  }, [frameReloadToken, locale, logDrawRuntime, setStatus, t]);

  useEffect(() => {
    const handleRelease = (event: Event) => {
      const detail = (event as CustomEvent<{ reason?: string }>).detail;
      unloadFrame(detail?.reason ?? "runtime");
    };
    window.addEventListener("latotex.runtime.release-heavy-resources", handleRelease as EventListener);
    return () => window.removeEventListener("latotex.runtime.release-heavy-resources", handleRelease as EventListener);
  }, [unloadFrame]);

  useEffect(() => {
    if (!frameSrc || frameDocumentLoaded || framePhase !== "loading") {
      return;
    }
    clearFrameTimers();
    loadTimerRef.current = window.setTimeout(() => {
      const failure = formatDrawStartFailure(
        t,
        `drawio frame did not finish loading in time (last stage: ${handshakeStageRef.current})`,
      );
      logDrawRuntime("ERROR", `iframe_load_timeout: last_stage=${handshakeStageRef.current}`);
      setFramePhase("error");
      setFrameSrc(null);
      setFrameFailureDetail(failure);
      setStatus(failure);
    }, 15_000);
    return clearFrameTimers;
  }, [clearFrameTimers, frameDocumentLoaded, framePhase, frameSrc, logDrawRuntime, setStatus, t]);

  useEffect(() => {
    if (!frameSrc || !frameDocumentLoaded || framePhase !== "loading") {
      return;
    }
    handshakeStageRef.current = "iframe_loaded";
    logDrawRuntime("INFO", "iframe_document_loaded");
    initTimerRef.current = window.setTimeout(() => {
      const failure = formatDrawStartFailure(
        t,
        `drawio local resource channel did not initialize in time (last stage: ${handshakeStageRef.current})`,
      );
      logDrawRuntime("ERROR", `handshake_timeout: last_stage=${handshakeStageRef.current}`);
      setFramePhase("error");
      setFrameSrc(null);
      setFrameFailureDetail(failure);
      setStatus(failure);
    }, 20_000);
    return clearFrameTimers;
  }, [clearFrameTimers, frameDocumentLoaded, framePhase, frameSrc, logDrawRuntime, setStatus, t]);

  const retryFrameLoad = useCallback(() => {
    logDrawRuntime("WARN", `frame_retry_requested: stage=${handshakeStageRef.current}`);
    clearFrameTimers();
    setFramePhase("loading");
    setFrameSrc(null);
    setFrameFailureDetail(null);
    setFrameDocumentLoaded(false);
    setStatus(t("draw.waiting"));
    setFrameReloadToken((prev) => prev + 1);
  }, [clearFrameTimers, logDrawRuntime, setStatus, t]);

  return {
    frameRef,
    initTimerRef,
    loadTimerRef,
    handshakeStageRef,
    frameSrc,
    setFrameSrc,
    framePhase,
    setFramePhase,
    frameFailureDetail,
    setFrameFailureDetail,
    setFrameDocumentLoaded,
    logDrawRuntime,
    retryFrameLoad,
  };
}
