import { Inbox, MailCheck, MessageSquareReply, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { channelsEmailFetchSubmission } from "../../../shared/api/share";
import type { EmailSubmissionItem } from "../../../shared/types/app";

type TranslationFn = (key: any) => string;

function formatMessage(template: string, params: Record<string, string | number> = {}) {
  return Object.entries(params).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

function emailStatusLabel(status: string, t: TranslationFn): string {
  const key = `settings.channels.emailStatus.${status}`;
  const label = t(key);
  return label === key ? status : label;
}

export function emailChannelErrorText(raw: string, t: TranslationFn): string {
  const key = raw.split(":")[0]?.trim();
  const localized: Record<string, string> = {
    "channels.email.disabled": t("settings.channels.errorEmailDisabled"),
    "channels.email.address_missing": t("settings.channels.errorEmailAddressMissing"),
    "channels.email.host_missing": t("settings.channels.errorEmailHostMissing"),
    "channels.email.host_invalid": t("settings.channels.errorEmailHostInvalid"),
    "channels.email.port_invalid": t("settings.channels.errorEmailPortInvalid"),
    "channels.email.security_invalid": t("settings.channels.errorEmailSecurityInvalid"),
    "channels.email.password_missing": t("settings.channels.errorEmailPasswordMissing"),
    "channels.email.transport": t("settings.channels.errorEmailTransport"),
    "channels.email.auth_failed": t("settings.channels.errorEmailAuthFailed"),
    "channels.email.mailbox_failed": t("settings.channels.errorEmailMailboxFailed"),
    "channels.email.parse": t("settings.channels.errorEmailParse"),
  };
  if (localized[key]) {
    return localized[key];
  }
  if (key?.startsWith("channels.email.")) {
    return t("settings.channels.errorEmailGeneric");
  }
  return raw;
}

export function buildEmailRebuttalDraft(item: EmailSubmissionItem, t: TranslationFn): string {
  const subject = item.subject?.trim() || t("settings.channels.emailUntitled");
  const lines = [`${t("research.email.rebuttalSubject")}: ${subject}`];
  if (item.from?.trim()) {
    lines.push(`${t("research.email.rebuttalFrom")}: ${item.from.trim()}`);
  }
  if (item.date?.trim()) {
    lines.push(`${t("research.email.rebuttalDate")}: ${item.date.trim()}`);
  }
  const preview = item.preview?.trim();
  if (preview) {
    lines.push("", preview);
  }
  return lines.join("\n");
}

export function SubmissionEmailWorkbench(props: {
  busy: boolean;
  canUseRebuttal: boolean;
  onUseEmail: (draft: string) => void;
  t: TranslationFn;
}) {
  const { busy, canUseRebuttal, onUseEmail, t } = props;
  const [syncBusy, setSyncBusy] = useState(false);
  const [items, setItems] = useState<EmailSubmissionItem[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const summary = useMemo(() => {
    if (syncBusy) {
      return t("research.email.syncing");
    }
    if (message) {
      return message.text;
    }
    return items.length > 0
      ? formatMessage(t("research.email.synced"), { count: items.length })
      : t("research.email.empty");
  }, [items.length, message, syncBusy, t]);

  const runSync = async () => {
    setSyncBusy(true);
    setMessage(null);
    try {
      const result = await channelsEmailFetchSubmission({ limit: 8 });
      setItems(result.items);
      setMessage({
        ok: true,
        text: result.items.length > 0
          ? formatMessage(t("research.email.synced"), { count: result.items.length })
          : t("research.email.empty"),
      });
    } catch (error) {
      setMessage({ ok: false, text: emailChannelErrorText(String(error), t) });
    } finally {
      setSyncBusy(false);
    }
  };

  return (
    <div className="mt-3 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2 rounded-md border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-surface-bg)] p-2">
      <button
        type="button"
        className="panel-topbar-btn h-9 w-9 justify-center p-0 disabled:opacity-50"
        disabled={syncBusy}
        title={t("research.email.sync")}
        aria-label={t("research.email.sync")}
        onClick={() => {
          void runSync();
        }}
      >
        {syncBusy ? <RefreshCw className="h-4 w-4 motion-rotate-soft" /> : <Inbox className="h-4 w-4" />}
      </button>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-[color:var(--editor-tab-muted)]">
          <MailCheck className="h-3.5 w-3.5 shrink-0 text-[color:var(--app-accent)]" />
          <span className="shrink-0 font-semibold text-[color:var(--editor-tab-text)]">{t("research.email.queue")}</span>
          <span
            className={[
              "min-w-0 truncate",
              message && !message.ok ? "text-red-500 dark:text-red-300" : "",
            ].join(" ")}
          >
            {summary}
          </span>
        </div>
        <div className="mt-2 grid min-w-0 grid-cols-3 gap-2 max-[940px]:grid-cols-2 max-[700px]:grid-cols-1">
          {items.slice(0, 3).map((item) => {
            const subject = item.subject?.trim() || t("settings.channels.emailUntitled");
            return (
              <div
                key={item.id}
                className="submission-ci-mail-item min-w-0 rounded-md border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-widget-bg)] px-2 py-1.5"
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[color:var(--editor-tab-text)]">
                    {subject}
                  </span>
                  <span className="shrink-0 rounded-full border border-[color:var(--editor-widget-border)] px-1.5 py-0.5 text-[9px] font-semibold text-[color:var(--editor-tab-muted)]">
                    {emailStatusLabel(item.statusTag, t)}
                  </span>
                  <button
                    type="button"
                    className="panel-topbar-btn h-6 w-6 shrink-0 justify-center p-0 disabled:opacity-50"
                    disabled={!canUseRebuttal || busy}
                    title={t("research.email.use")}
                    aria-label={`${t("research.email.use")}: ${subject}`}
                    onClick={() => onUseEmail(buildEmailRebuttalDraft(item, t))}
                  >
                    <MessageSquareReply className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-1 truncate text-[10px] text-[color:var(--editor-tab-muted)]">
                  {item.from || item.date || item.matchReason}
                </div>
              </div>
            );
          })}
          {items.length === 0 ? (
            <div className="rounded-md border border-dashed border-[color:var(--editor-widget-border)] px-2 py-2 text-[11px] text-[color:var(--editor-tab-muted)]">
              {syncBusy ? t("research.email.syncing") : t("research.email.empty")}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
