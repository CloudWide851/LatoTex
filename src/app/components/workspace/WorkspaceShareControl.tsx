import { Check, ChevronDown, ChevronUp, Copy, RefreshCcw, Share2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ShareParticipantInfo, ShareSessionInfo } from "../../../shared/types/app";

type TranslationFn = (key: any) => string;
type ShareMode = "local" | "remote";

function normalizeMode(raw: string | null | undefined, fallback: ShareMode): ShareMode {
  if (raw === "local" || raw === "remote") {
    return raw;
  }
  return fallback;
}

function statusMessage(
  session: ShareSessionInfo | null,
  shareSyncing: boolean,
  mode: ShareMode,
  t: TranslationFn,
): string {
  if (!session) {
    return t("share.status.stopped");
  }
  if (session.status === "failed") {
    return t("share.status.failed");
  }
  if (session.status === "starting") {
    return mode === "local" ? t("share.status.startingLocal") : t("share.status.startingRemote");
  }
  if (shareSyncing) {
    return t("share.syncing");
  }
  return mode === "local" ? t("share.status.readyLocal") : t("share.status.readyRemote");
}

function avatarColor(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 70% 42%)`;
}

function ParticipantList(props: { participants: ShareParticipantInfo[]; t: TranslationFn }) {
  const { participants, t } = props;
  if (participants.length === 0) {
    return <p className="text-[11px] text-slate-500">{t("share.participantsEmpty")}</p>;
  }
  return (
    <div className="max-h-28 space-y-1 overflow-auto">
      {participants.map((item) => (
        <div key={item.participantId} className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
              style={{ background: avatarColor(item.username || item.participantId) }}
            >
              {(item.username || "G").slice(0, 1).toUpperCase()}
            </span>
            <span className="truncate text-[11px] text-slate-700">{item.username}</span>
          </div>
          <span className="max-w-[50%] truncate text-[10px] text-slate-500">
            {item.lastAction || "-"}
          </span>
        </div>
      ))}
    </div>
  );
}

function ParticipantChips(props: { participants: ShareParticipantInfo[]; t: TranslationFn }) {
  const { participants, t } = props;
  if (participants.length === 0) {
    return <span className="text-[11px] text-slate-500">{t("share.participantsEmpty")}</span>;
  }
  const visible = participants.slice(0, 20);
  return (
    <div className="grid max-w-[200px] grid-cols-5 gap-1">
      {visible.map((item) => (
        <button
          key={item.participantId}
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-[11px] text-slate-700 shadow-sm"
          title={item.username || item.participantId}
        >
          <span
            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold text-white"
            style={{ background: avatarColor(item.username || item.participantId) }}
          >
            {(item.username || item.participantId).slice(0, 1).toUpperCase()}
          </span>
        </button>
      ))}
      {participants.length > visible.length ? (
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-[11px] text-slate-600">
          +{participants.length - visible.length}
        </span>
      ) : null}
    </div>
  );
}

export function WorkspaceShareControl(props: {
  selectedFile: string | null;
  shareSession: ShareSessionInfo | null;
  shareBusy: boolean;
  shareSyncing: boolean;
  shareMode: ShareMode;
  shareSessionName: string;
  onShareModeChange: (mode: ShareMode) => void;
  onShareSessionNameChange: (value: string) => void;
  onShareStart: (mode?: ShareMode) => void | Promise<void>;
  onShareStop: () => void | Promise<void>;
  onShareRefresh: () => void | Promise<void>;
  t: TranslationFn;
}) {
  const {
    selectedFile,
    shareSession,
    shareBusy,
    shareSyncing,
    shareMode,
    shareSessionName,
    onShareModeChange,
    onShareSessionNameChange,
    onShareStart,
    onShareStop,
    onShareRefresh,
    t,
  } = props;
  const [panelOpen, setPanelOpen] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [copyDone, setCopyDone] = useState(false);
  const [passwordCopyDone, setPasswordCopyDone] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const isTexSelected = Boolean(selectedFile && selectedFile.toLowerCase().endsWith(".tex"));
  const sessionExists = Boolean(shareSession?.sessionId);
  const activeMode = normalizeMode(shareSession?.mode, shareMode);
  const shareReady = Boolean(shareSession?.status === "ready" && shareSession?.activeJoinUrl);
  const statusText = statusMessage(shareSession, shareSyncing, activeMode, t);
  const participants = useMemo(
    () => (Array.isArray(shareSession?.participants) ? shareSession?.participants : []),
    [shareSession?.participants],
  );
  const shareLink = shareSession?.activeJoinUrl || "";
  const localJoinLink = shareSession?.localJoinUrl || "";

  useEffect(() => {
    if (!panelOpen || !shareLink) {
      setQrDataUrl("");
      return;
    }
    let disposed = false;
    void import("qrcode")
      .then((module) => module.default.toDataURL(shareLink, { width: 164, margin: 1 }))
      .then((url) => {
        if (!disposed) {
          setQrDataUrl(url);
        }
      })
      .catch(() => {
        if (!disposed) {
          setQrDataUrl("");
        }
      });
    return () => {
      disposed = true;
    };
  }, [panelOpen, shareLink]);

  useEffect(() => {
    if (!copyDone) {
      return;
    }
    const timer = window.setTimeout(() => setCopyDone(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copyDone]);
  useEffect(() => {
    if (!passwordCopyDone) {
      return;
    }
    const timer = window.setTimeout(() => setPasswordCopyDone(false), 1500);
    return () => window.clearTimeout(timer);
  }, [passwordCopyDone]);

  const copyLink = (link: string) => {
    if (!link) {
      return;
    }
    void navigator.clipboard?.writeText(link).then(() => setCopyDone(true)).catch(() => undefined);
  };
  const copyPassword = (raw: string) => {
    if (!raw) {
      return;
    }
    void navigator.clipboard?.writeText(raw).then(() => setPasswordCopyDone(true)).catch(() => undefined);
  };
  const dotClass = shareSession?.status === "ready"
    ? "bg-emerald-500"
    : shareSession?.status === "starting"
      ? "bg-amber-500"
      : "bg-slate-400";

  return (
    <div ref={rootRef} className="relative">
      <button
        className={`panel-topbar-btn relative rounded border transition disabled:opacity-60 ${
          sessionExists
            ? "border-primary-600 bg-primary-50 text-primary-700 hover:bg-primary-100"
            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
        }`}
        onClick={() => setPanelOpen((prev) => !prev)}
        disabled={shareBusy}
        title={t("share.openPanel")}
        aria-label={t("share.openPanel")}
      >
        <Share2 className="h-4 w-4" />
        {sessionExists ? (
          <span className={`absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-white ${dotClass}`} />
        ) : null}
      </button>

      {!panelOpen && sessionExists ? (
        <div className="absolute left-0 top-[calc(100%+10px)] z-[220] w-[min(240px,68vw)]">
          <div className="ml-3 h-2.5 w-2.5 rotate-45 border-l border-t border-slate-300 bg-white" />
          <div className="rounded-lg border border-slate-300 bg-white/95 px-2 py-2 shadow-soft backdrop-blur-sm">
            <div className="mb-1 text-[11px] font-semibold text-slate-700">{statusText}</div>
            <ParticipantChips participants={participants} t={t} />
          </div>
        </div>
      ) : null}

      {panelOpen ? (
        <section className="absolute left-0 top-[calc(100%+8px)] z-[230] w-[min(430px,86vw)] rounded-lg border border-slate-300 bg-white p-3 shadow-soft">
          <div className="mb-2 flex items-center justify-between">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-slate-800">{t("share.panelTitle")}</h3>
              <p className="mt-0.5 truncate text-[11px] text-emerald-700">{statusText}</p>
              {shareSession?.sessionName ? (
                <p className="truncate text-[11px] text-slate-500">
                  {shareSession.sessionName}
                  {shareSession.sessionCreatedAt ? ` · ${shareSession.sessionCreatedAt}` : ""}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              <button
                className="rounded border border-slate-300 p-1 text-slate-600 hover:bg-slate-100"
                onClick={() => setDetailsExpanded((prev) => !prev)}
                title={detailsExpanded ? t("share.panelCollapse") : t("share.panelExpand")}
              >
                {detailsExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              <button
                className="rounded border border-slate-300 p-1 text-slate-600 hover:bg-slate-100"
                onClick={() => setPanelOpen(false)}
                title={t("common.cancel")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {!detailsExpanded ? null : (
            <>
              <div className="space-y-1 text-xs text-slate-700">
                <div className="rounded border border-slate-200 bg-slate-50 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <strong>{activeMode === "local" ? t("share.localLink") : t("share.publicLink")}:</strong>
                    <button
                      className="inline-flex h-6 w-6 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                      disabled={!shareReady || !shareLink}
                      onClick={() => copyLink(shareLink)}
                      title={t("share.copyLink")}
                    >
                      {copyDone ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <div className="mt-1 break-all">{shareLink || "-"}</div>
                </div>
                {activeMode === "remote" && localJoinLink ? (
                  <div className="rounded border border-slate-200 bg-slate-50 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <strong>{t("share.localLink")}:</strong>
                      <button
                        className="inline-flex h-6 w-6 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
                        onClick={() => copyLink(localJoinLink)}
                        title={t("share.copyLink")}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="mt-1 break-all">{localJoinLink}</div>
                  </div>
                ) : null}
                <div className="rounded border border-slate-200 bg-slate-50 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <strong>{t("share.password")}:</strong>
                    <button
                      className="inline-flex h-6 w-6 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                      disabled={!shareSession?.password}
                      onClick={() => copyPassword(shareSession?.password || "")}
                      title={t("share.copyPassword")}
                    >
                      {passwordCopyDone ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <div className="mt-1 break-all">{shareSession?.password || "-"}</div>
                </div>
                <div className="rounded border border-slate-200 bg-slate-50 p-2">
                  <strong>{t("share.expiresAt")}:</strong> {shareSession?.expiresAt || "-"}
                </div>
                {shareSession?.tunnelError ? (
                  <div className="rounded border border-rose-200 bg-rose-50 p-2 text-rose-700">
                    {shareSession.tunnelError}
                  </div>
                ) : null}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {!sessionExists ? (
                  <>
                    <input
                      className="min-w-[180px] flex-1 rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                      value={shareSessionName}
                      maxLength={120}
                      onChange={(event) => onShareSessionNameChange(event.target.value)}
                      placeholder={t("share.sessionNamePlaceholder")}
                      disabled={shareBusy}
                    />
                    <select
                      className="rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                      value={activeMode}
                      onChange={(event) => onShareModeChange(event.target.value as ShareMode)}
                      disabled={shareBusy}
                    >
                      <option value="remote">{t("share.mode.remote")}</option>
                      <option value="local">{t("share.mode.local")}</option>
                    </select>
                    <button
                      className="rounded border border-primary-600 bg-primary-600 px-3 py-1.5 text-xs text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-55"
                      disabled={shareBusy || !isTexSelected}
                      onClick={() => void onShareStart(activeMode)}
                    >
                      {t("share.start")}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                      disabled={shareBusy}
                      onClick={() => void onShareRefresh()}
                    >
                      <RefreshCcw className="mr-1 inline h-3 w-3" />
                      {t("common.refresh")}
                    </button>
                    <button
                      className="rounded border border-rose-600 bg-rose-600 px-2 py-1 text-xs text-white hover:bg-rose-700 disabled:opacity-60"
                      disabled={shareBusy}
                      onClick={() => void onShareStop()}
                    >
                      {t("share.stop")}
                    </button>
                  </>
                )}
                {!isTexSelected ? (
                  <span className="text-[11px] text-rose-600">{t("share.startNeedTex")}</span>
                ) : null}
              </div>

              <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-2">
                <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("share.participants")}
                </h4>
                <ParticipantList participants={participants} t={t} />
              </div>

              {qrDataUrl ? (
                <div className="mt-3 flex items-start gap-3 rounded border border-slate-200 bg-slate-50 p-2">
                  <img src={qrDataUrl} alt="share qr" className="h-24 w-24 rounded bg-white p-1" />
                  <p className="text-[11px] leading-5 text-slate-600">
                    {activeMode === "local" ? t("share.qrHintLocal") : t("share.qrHintRemote")}
                  </p>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}

