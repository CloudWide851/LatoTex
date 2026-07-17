import { AlertTriangle, Check, ChevronDown, ChevronUp, Copy, RefreshCcw, Share2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Select } from "../../../components/ui/select";
import type { ShareParticipantInfo, ShareSessionInfo } from "../../../shared/types/app";
import type { ShareConflict, ShareConflictResolution } from "../../hooks/shareSessionUtils";

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
  if (mode === "remote" && session.status === "ready" && session.pdfState !== "ready") {
    return t("share.status.preparingRemotePdf");
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
    return <p className="text-[11px] text-[color:var(--app-muted)]">{t("share.participantsEmpty")}</p>;
  }
  return (
    <div className="max-h-28 space-y-1 overflow-auto">
      {participants.map((item) => (
        <div key={item.participantId} className="app-material-inset flex items-center justify-between gap-2 rounded border px-2 py-1">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
              style={{ background: avatarColor(item.username || item.participantId) }}
            >
              {(item.username || "G").slice(0, 1).toUpperCase()}
            </span>
            <span className="truncate text-[11px] text-[color:var(--app-text)]">{item.username}</span>
          </div>
          <span className="max-w-[50%] truncate text-[10px] text-[color:var(--app-muted)]">
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
    return <span className="text-[11px] text-[color:var(--app-muted)]">{t("share.participantsEmpty")}</span>;
  }
  const visible = participants.slice(0, 20);
  return (
    <div className="grid max-w-[200px] grid-cols-5 gap-1">
      {visible.map((item) => (
        <button
          key={item.participantId}
          type="button"
          className="app-material-inset inline-flex h-7 w-7 items-center justify-center rounded-full border text-[11px] text-[color:var(--app-text)]"
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
        <span className="app-material-inset inline-flex h-7 w-7 items-center justify-center rounded-full border text-[11px] text-[color:var(--app-muted)]">
          +{participants.length - visible.length}
        </span>
      ) : null}
    </div>
  );
}

function CompactShareStatusBubble(props: {
  statusText: string;
  participants: ShareParticipantInfo[];
  onOpen: () => void;
  t: TranslationFn;
}) {
  const { statusText, participants, onOpen, t } = props;
  return (
    <div
      className="absolute left-0 top-[calc(100%+10px)] z-[220] w-[min(264px,72vw)] cursor-pointer"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="app-material-floating relative ml-2 rounded-md px-2.5 py-2">
        <div
          aria-hidden="true"
          className="app-material-inset absolute -top-[7px] left-3 h-3.5 w-3.5 rotate-45 border-l border-t"
        />
        <div className="relative">
          <div className="mb-1 text-[11px] font-semibold text-[color:var(--app-text)]">{statusText}</div>
          <ParticipantChips participants={participants} t={t} />
        </div>
      </div>
    </div>
  );
}

export function WorkspaceShareControl(props: {
  selectedFile: string | null;
  shareSession: ShareSessionInfo | null;
  shareBusy: boolean;
  shareSyncing: boolean;
  shareConflict: ShareConflict | null;
  shareMode: ShareMode;
  shareSessionName: string;
  onShareModeChange: (mode: ShareMode) => void;
  onShareSessionNameChange: (value: string) => void;
  onShareStart: (mode?: ShareMode) => void | Promise<void>;
  onShareStop: () => void | Promise<void>;
  onShareRefresh: () => void | Promise<void>;
  onShareConflictResolve: (resolution: ShareConflictResolution) => void;
  t: TranslationFn;
}) {
  const {
    selectedFile,
    shareSession,
    shareBusy,
    shareSyncing,
    shareConflict,
    shareMode,
    shareSessionName,
    onShareModeChange,
    onShareSessionNameChange,
    onShareStart,
    onShareStop,
    onShareRefresh,
    onShareConflictResolve,
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
  const statusText = shareConflict ? t("share.status.conflict") : statusMessage(shareSession, shareSyncing, activeMode, t);
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
  useEffect(() => {
    if (!panelOpen || typeof window === "undefined") {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || !rootRef.current?.contains(target)) {
        setPanelOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPanelOpen(false);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [panelOpen]);

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
    ? "bg-[color:var(--app-status-success)]"
    : shareSession?.status === "starting"
      ? "bg-[color:var(--app-status-warning)]"
      : "bg-[color:var(--app-muted)]";

  return (
    <div ref={rootRef} className="relative">
      <button
        className={`panel-topbar-btn relative rounded border transition disabled:opacity-60 ${
          sessionExists
            ? "app-status-success border"
            : "app-material-inset text-[color:var(--app-text)]"
        }`}
        onClick={() => setPanelOpen((prev) => !prev)}
        title={t("share.openPanel")}
        aria-label={t("share.openPanel")}
      >
        <Share2 className="h-4 w-4" />
        {sessionExists ? (
          <span className={`absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-[color:var(--app-material-floating)] ${dotClass}`} />
        ) : null}
      </button>

      {!panelOpen && sessionExists ? (
        <CompactShareStatusBubble
          statusText={statusText}
          participants={participants}
          onOpen={() => setPanelOpen(true)}
          t={t}
        />
      ) : null}

      {panelOpen ? (
        <section
          className="app-material-floating absolute left-0 top-[calc(100%+8px)] z-[230] w-[min(430px,86vw)] rounded-lg p-3"
        >
          <div className="mb-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-[color:var(--app-text)]">{t("share.panelTitle")}</h3>
              <p className="mt-0.5 truncate text-[11px] font-medium text-[color:var(--app-status-success)]">{statusText}</p>
              {shareSession?.sessionName ? (
                <p className="truncate text-[11px] text-[color:var(--app-muted)]">
                  {shareSession.sessionName}
                  {shareSession.sessionCreatedAt ? ` · ${shareSession.sessionCreatedAt}` : ""}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              <button
                className="panel-topbar-btn rounded border p-1"
                onClick={() => setDetailsExpanded((prev) => !prev)}
                title={detailsExpanded ? t("share.panelCollapse") : t("share.panelExpand")}
                type="button"
              >
                {detailsExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              <button
                className="panel-topbar-btn rounded border p-1"
                onClick={() => setPanelOpen(false)}
                title={t("common.cancel")}
                type="button"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {!detailsExpanded ? null : (
            <>
              <div className="space-y-1.5 text-xs text-[color:var(--app-text)]">
                <div className="app-material-inset rounded-md border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <strong>{activeMode === "local" ? t("share.localLink") : t("share.publicLink")}:</strong>
                    <button
                      className="panel-topbar-btn inline-flex h-6 w-6 items-center justify-center rounded border disabled:opacity-50"
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
                  <div className="app-material-inset rounded-md border p-2">
                    <div className="flex items-center justify-between gap-2">
                      <strong>{t("share.localLink")}:</strong>
                      <button
                        className="panel-topbar-btn inline-flex h-6 w-6 items-center justify-center rounded border"
                        onClick={() => copyLink(localJoinLink)}
                        title={t("share.copyLink")}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="mt-1 break-all">{localJoinLink}</div>
                  </div>
                ) : null}
                <div className="app-material-inset rounded-md border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <strong>{t("share.password")}:</strong>
                    <button
                      className="panel-topbar-btn inline-flex h-6 w-6 items-center justify-center rounded border disabled:opacity-50"
                      disabled={!shareSession?.password}
                      onClick={() => copyPassword(shareSession?.password || "")}
                      title={t("share.copyPassword")}
                    >
                      {passwordCopyDone ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <div className="mt-1 break-all">{shareSession?.password || "-"}</div>
                </div>
                <div className="app-material-inset rounded-md border p-2">
                  <strong>{t("share.expiresAt")}:</strong> {shareSession?.expiresAt || "-"}
                </div>
                {shareSession?.tunnelError ? (
                  <div className="app-status-danger rounded-md border p-2" role="alert">
                    {t("share.status.failed")}
                  </div>
                ) : null}
                {shareConflict ? (
                  <div className="app-status-warning rounded-md border p-2">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-semibold">{t("share.conflictTitle")}</div>
                        <div className="mt-0.5 break-words text-[11px] leading-5">
                          {t("share.conflictDesc")}
                        </div>
                        <div className="mt-1 truncate text-[11px]">
                          {t("share.conflictPath")}: {shareConflict.path}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        className="control-button control-button--primary px-2 py-1 text-[11px]"
                        type="button"
                        onClick={() => onShareConflictResolve("remote")}
                      >
                        {t("share.conflictUseRemote")}
                      </button>
                      <button
                        className="panel-topbar-btn rounded border px-2 py-1 text-[11px] font-medium"
                        type="button"
                        onClick={() => onShareConflictResolve("local")}
                      >
                        {t("share.conflictKeepLocal")}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {!sessionExists ? (
                  <>
                    <input
                      className="control-surface min-w-[180px] flex-1 px-2 py-1.5 text-xs"
                      value={shareSessionName}
                      maxLength={120}
                      onChange={(event) => onShareSessionNameChange(event.target.value)}
                      placeholder={t("share.sessionNamePlaceholder")}
                      disabled={shareBusy}
                    />
                    <Select
                      uiSize="sm"
                      wrapperClassName="w-[138px] shrink-0"
                      value={activeMode}
                      onChange={(event) => onShareModeChange(event.target.value as ShareMode)}
                      disabled={shareBusy}
                    >
                      <option value="remote">{t("share.mode.remote")}</option>
                      <option value="local">{t("share.mode.local")}</option>
                    </Select>
                    <button
                      className="control-button control-button--primary px-3 py-1.5 text-xs"
                      disabled={shareBusy || !isTexSelected}
                      onClick={() => void onShareStart(activeMode)}
                    >
                      {t("share.start")}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="panel-topbar-btn rounded-md border px-2 py-1 text-xs disabled:opacity-60"
                      disabled={shareBusy}
                      onClick={() => void onShareRefresh()}
                    >
                      <RefreshCcw className="mr-1 inline h-3 w-3" />
                      {t("common.refresh")}
                    </button>
                    <button
                      className="control-button control-button--danger px-2 py-1 text-xs"
                      disabled={shareBusy}
                      onClick={() => void onShareStop()}
                    >
                      {t("share.stop")}
                    </button>
                  </>
                )}
                {!isTexSelected ? (
                  <span className="text-[11px] text-[color:var(--app-status-danger)]">{t("share.startNeedTex")}</span>
                ) : null}
              </div>

              <div className="app-material-inset mt-3 rounded-md border p-2">
                <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--app-muted)]">
                  {t("share.participants")}
                </h4>
                <ParticipantList participants={participants} t={t} />
              </div>

              {qrDataUrl ? (
                <div className="app-material-inset mt-3 flex items-start gap-3 rounded-md border p-2">
                  <img src={qrDataUrl} alt={t("share.qrAlt")} className="h-24 w-24 rounded bg-[color:var(--app-material-content)] p-1" />
                  <p className="text-[11px] leading-5 text-[color:var(--app-muted)]">
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


