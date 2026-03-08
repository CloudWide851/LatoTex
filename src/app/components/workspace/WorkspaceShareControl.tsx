import { ChevronDown, ChevronUp, Copy, RefreshCcw, Share2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ShareParticipantInfo, ShareSessionInfo } from "../../../shared/types/app";

type TranslationFn = (key: any) => string;

function statusMessage(session: ShareSessionInfo | null, shareSyncing: boolean, t: TranslationFn): string {
  if (!session) {
    return t("share.status.stopped");
  }
  if (session.status === "failed") {
    return t("share.status.failed");
  }
  if (session.status === "starting") {
    return t("share.status.starting");
  }
  if (shareSyncing) {
    return t("share.syncing");
  }
  return t("share.status.ready");
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

export function WorkspaceShareControl(props: {
  selectedFile: string | null;
  shareSession: ShareSessionInfo | null;
  shareBusy: boolean;
  shareSyncing: boolean;
  onShareStart: () => void | Promise<void>;
  onShareStop: () => void | Promise<void>;
  onShareRefresh: () => void | Promise<void>;
  t: TranslationFn;
}) {
  const {
    selectedFile,
    shareSession,
    shareBusy,
    shareSyncing,
    onShareStart,
    onShareStop,
    onShareRefresh,
    t,
  } = props;
  const [panelOpen, setPanelOpen] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const isTexSelected = Boolean(selectedFile && selectedFile.toLowerCase().endsWith(".tex"));
  const sessionExists = Boolean(shareSession?.sessionId);
  const shareReady = Boolean(shareSession?.status === "ready" && shareSession?.tunnelUrl);
  const statusText = statusMessage(shareSession, shareSyncing, t);
  const participants = useMemo(
    () => (Array.isArray(shareSession?.participants) ? shareSession?.participants : []),
    [shareSession?.participants],
  );
  const shareLink = shareSession?.tunnelUrl || "";

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

  return (
    <div className="relative">
      <button
        className="rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
        onClick={() => setPanelOpen((prev) => !prev)}
        disabled={shareBusy}
        title={t("share.openPanel")}
      >
        <Share2 className="mr-1 inline h-3.5 w-3.5" />
        {t("topbar.share")}
      </button>

      {panelOpen ? (
        <section className="absolute left-0 top-[calc(100%+8px)] z-40 w-[min(430px,86vw)] rounded-lg border border-slate-300 bg-white p-3 shadow-soft">
          <div className="mb-2 flex items-center justify-between">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-slate-800">{t("share.panelTitle")}</h3>
              <p className="mt-0.5 truncate text-[11px] text-emerald-700">{statusText}</p>
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
                  <strong>{t("share.publicLink")}:</strong>
                  <div className="mt-1 break-all">{shareSession?.tunnelUrl || "-"}</div>
                </div>
                <div className="rounded border border-slate-200 bg-slate-50 p-2">
                  <strong>{t("share.password")}:</strong> {shareSession?.password || "-"}
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
                  <button
                    className="rounded border border-primary-600 bg-primary-600 px-3 py-1.5 text-xs text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-55"
                    disabled={shareBusy || !isTexSelected}
                    onClick={() => void onShareStart()}
                  >
                    {t("share.start")}
                  </button>
                ) : (
                  <>
                    {shareReady ? (
                      <button
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                        disabled={shareBusy || !shareLink}
                        onClick={() => void navigator.clipboard?.writeText(shareLink)}
                      >
                        <Copy className="mr-1 inline h-3 w-3" />
                        {t("share.copyLink")}
                      </button>
                    ) : null}
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
                  <p className="text-[11px] leading-5 text-slate-600">{t("share.qrHint")}</p>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
