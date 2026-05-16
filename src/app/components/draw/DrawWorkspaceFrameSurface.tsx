import type { MutableRefObject } from "react";
import { formatDrawStartFailure, type DrawFramePhase } from "./drawFrameLifecycle";

type TranslationFn = (key: any) => string;

export function DrawWorkspaceNoProject(props: { t: TranslationFn }) {
  return (
    <section className="flex h-full min-h-0 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-xs text-slate-500">
      {props.t("workspace.noProject")}
    </section>
  );
}

export function DrawWorkspaceFrameSurface(props: {
  activePath: string | null;
  frameFailureDetail: string | null;
  frameRef: MutableRefObject<HTMLIFrameElement | null>;
  frameSrc: string | null;
  framePhase: DrawFramePhase;
  handshakeStageRef: MutableRefObject<string>;
  loadTimerRef: MutableRefObject<number | null>;
  status: string;
  retryFrameLoad: () => void;
  setFrameDocumentLoaded: (loaded: boolean) => void;
  setFrameFailureDetail: (detail: string | null) => void;
  setFramePhase: (phase: DrawFramePhase) => void;
  setFrameSrc: (src: string | null) => void;
  setStatus: (status: string) => void;
  logDrawRuntime: (level: "INFO" | "WARN" | "ERROR", message: string) => void;
  t: TranslationFn;
}) {
  const {
    activePath,
    frameFailureDetail,
    frameRef,
    frameSrc,
    framePhase,
    handshakeStageRef,
    loadTimerRef,
    status,
    retryFrameLoad,
    setFrameDocumentLoaded,
    setFrameFailureDetail,
    setFramePhase,
    setFrameSrc,
    setStatus,
    logDrawRuntime,
    t,
  } = props;

  if (!activePath) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-slate-500">{t("draw.noTabs")}</div>
    );
  }

  if (frameFailureDetail) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-left shadow-sm">
          <div className="text-sm font-semibold text-amber-950">{t("draw.startFailed")}</div>
          <div className="mt-2 break-all text-xs leading-5 text-amber-900">{frameFailureDetail}</div>
          <button
            type="button"
            className="mt-4 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
            onClick={() => {
              void retryFrameLoad();
            }}
          >
            {t("draw.retry")}
          </button>
        </div>
      </div>
    );
  }

  if (!frameSrc) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-slate-500">{t("draw.waiting")}</div>
    );
  }

  return (
    <>
      <iframe
        ref={frameRef}
        key={frameSrc}
        src={frameSrc}
        title={t("draw.frameTitle")}
        className={`h-full w-full border-0 transition-opacity duration-200 ${framePhase === "ready" ? "opacity-100" : "opacity-0"}`}
        onLoad={() => {
          handshakeStageRef.current = "iframe_load_event";
          logDrawRuntime("INFO", "iframe_load_event");
          if (loadTimerRef.current !== null) {
            window.clearTimeout(loadTimerRef.current);
            loadTimerRef.current = null;
          }
          setFrameDocumentLoaded(true);
        }}
        onError={() => {
          const failure = formatDrawStartFailure(
            t,
            `drawio frame failed to load (last stage: ${handshakeStageRef.current})`,
          );
          logDrawRuntime("ERROR", `iframe_load_error: last_stage=${handshakeStageRef.current}`);
          if (loadTimerRef.current !== null) {
            window.clearTimeout(loadTimerRef.current);
            loadTimerRef.current = null;
          }
          setFramePhase("error");
          setFrameSrc(null);
          setFrameFailureDetail(failure);
          setStatus(failure);
        }}
      />
      {framePhase !== "ready" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-white/92 px-4 text-center text-xs text-slate-500">
          {status || t("draw.waiting")}
        </div>
      ) : null}
    </>
  );
}
