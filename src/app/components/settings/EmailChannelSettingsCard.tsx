import { Inbox, KeyRound, Mail, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Select } from "../../../components/ui/select";
import {
  channelsEmailFetchSubmission,
  channelsEmailPasswordSaveVerified,
  channelsEmailTest,
} from "../../../shared/api/share";
import type { AppSettings, EmailSubmissionItem } from "../../../shared/types/app";
import { SettingsBooleanRow } from "./SettingsBooleanRow";

type TranslationFn = (key: any) => string;
type ChannelPatch = Partial<NonNullable<NonNullable<AppSettings["uiPrefs"]>["channels"]>>;

const SECURITY_OPTIONS = ["tls", "starttls", "plain"] as const;

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

function messageClass(ok: boolean) {
  return ok
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-rose-200 bg-rose-50 text-rose-700";
}

export function EmailChannelSettingsCard(props: {
  settings: AppSettings | null;
  backgroundUrl: string | null | undefined;
  setChannelField: (patch: ChannelPatch) => void;
  formatError: (raw: string, t: TranslationFn) => string;
  t: TranslationFn;
}) {
  const { settings, backgroundUrl, setChannelField, formatError, t } = props;
  const channels = settings?.uiPrefs?.channels;
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "sync" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [items, setItems] = useState<EmailSubmissionItem[]>([]);
  const maxResults = channels?.emailMaxResults ?? 20;
  const keywords = channels?.emailSearchKeywords ?? "submission, manuscript, decision, revision, review, editor";
  const security = channels?.emailSecurity ?? "tls";
  const portValue = String(channels?.emailImapPort ?? (security === "plain" ? 143 : 993));
  const syncSummary = useMemo(() => {
    if (items.length === 0) {
      return t("settings.channels.emailSyncEmpty");
    }
    return formatMessage(t("settings.channels.emailSyncOk"), { count: items.length });
  }, [items.length, t]);

  const savePasswordIfNeeded = async () => {
    const nextPassword = password.trim();
    if (!nextPassword) {
      return;
    }
    await channelsEmailPasswordSaveVerified({ password: nextPassword });
    setPassword("");
  };

  const runPasswordSave = async () => {
    setBusy("save");
    setMessage(null);
    try {
      await savePasswordIfNeeded();
      setMessage({ ok: true, text: t("settings.channels.emailPasswordSaved") });
    } catch (error) {
      setMessage({ ok: false, text: formatError(String(error), t) });
    } finally {
      setBusy(null);
    }
  };

  const runEmailTest = async () => {
    setBusy("test");
    setMessage(null);
    try {
      await savePasswordIfNeeded();
      await channelsEmailTest();
      setMessage({ ok: true, text: t("settings.channels.emailTestOk") });
    } catch (error) {
      setMessage({ ok: false, text: formatError(String(error), t) });
    } finally {
      setBusy(null);
    }
  };

  const runEmailSync = async () => {
    setBusy("sync");
    setMessage(null);
    try {
      await savePasswordIfNeeded();
      const result = await channelsEmailFetchSubmission({ limit: maxResults });
      setItems(result.items);
      setMessage({
        ok: true,
        text: result.items.length > 0 ? formatMessage(t("settings.channels.emailSyncOk"), { count: result.items.length }) : t("settings.channels.emailSyncEmpty"),
      });
    } catch (error) {
      setMessage({ ok: false, text: formatError(String(error), t) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="relative overflow-hidden rounded-[22px] border border-slate-200/80 bg-white shadow-soft motion-card-pop">
      {backgroundUrl ? (
        <>
          <div
            className="absolute inset-0 bg-cover bg-center opacity-[0.22]"
            style={{ backgroundImage: `url("${backgroundUrl}")` }}
            aria-hidden="true"
          />
          <div className="absolute inset-0 backdrop-blur-[calc(var(--wallpaper-blur,18px)*0.45)]" aria-hidden="true" />
        </>
      ) : null}
      <div
        className={`absolute inset-0 ${
          backgroundUrl
            ? "bg-[linear-gradient(180deg,rgba(255,255,255,0.78),rgba(248,250,252,0.94))]"
            : "bg-[linear-gradient(180deg,#f8fafc,#ffffff)]"
        }`}
        aria-hidden="true"
      />
      <div className="relative z-10 p-4">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-900">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-700">
              <Mail className="h-3.5 w-3.5" />
            </span>
            <span className="truncate">{t("settings.channels.email")}</span>
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy === "sync"}
            onClick={() => {
              void runEmailSync();
            }}
          >
            {busy === "sync" ? t("common.loading") : t("settings.channels.emailSync")}
          </Button>
        </div>

        <SettingsBooleanRow
          label={t("settings.channels.emailEnabled")}
          checked={Boolean(channels?.emailEnabled)}
          className="mt-4 rounded-2xl border border-slate-200/80 bg-white/72 px-3 py-3 text-xs text-slate-700 shadow-none"
          textClassName="text-slate-700"
          checkboxClassName="border-slate-400"
          onCheckedChange={(nextValue) => setChannelField({ emailEnabled: nextValue })}
        />

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="px-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
              {t("settings.channels.emailAddress")}
            </span>
            <Input
              value={channels?.emailAddress ?? ""}
              onChange={(event) => setChannelField({ emailAddress: event.target.value })}
              placeholder={t("settings.channels.emailAddress")}
              autoComplete="email"
              spellCheck={false}
              className="h-9 border-slate-200/90 bg-white/78 text-xs text-slate-800 placeholder:text-slate-400"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="px-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
              {t("settings.channels.emailPassword")}
            </span>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t("settings.channels.emailPasswordPlaceholder")}
              autoComplete="current-password"
              spellCheck={false}
              className="h-9 border-slate-200/90 bg-white/78 text-xs text-slate-800 placeholder:text-slate-400"
            />
          </label>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_96px_128px]">
          <label className="grid gap-1.5">
            <span className="px-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
              {t("settings.channels.emailImapHost")}
            </span>
            <Input
              value={channels?.emailImapHost ?? ""}
              onChange={(event) => setChannelField({ emailImapHost: event.target.value })}
              placeholder="imap.example.com"
              autoComplete="off"
              spellCheck={false}
              className="h-9 border-slate-200/90 bg-white/78 text-xs text-slate-800 placeholder:text-slate-400"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="px-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
              {t("settings.channels.emailPort")}
            </span>
            <Input
              value={portValue}
              inputMode="numeric"
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                setChannelField({ emailImapPort: Number.isFinite(parsed) ? parsed : undefined });
              }}
              className="h-9 border-slate-200/90 bg-white/78 text-xs text-slate-800 placeholder:text-slate-400"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="px-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
              {t("settings.channels.emailSecurity")}
            </span>
            <Select
              uiSize="sm"
              value={security}
              onChange={(event) => setChannelField({ emailSecurity: event.currentTarget.value })}
              aria-label={t("settings.channels.emailSecurity")}
              className="h-9 border-slate-200/90 bg-white/78 text-xs text-slate-800"
            >
              {SECURITY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {t(`settings.channels.emailSecurity.${option}`)}
                </option>
              ))}
            </Select>
          </label>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="px-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
              {t("settings.channels.emailUsername")}
            </span>
            <Input
              value={channels?.emailUsername ?? ""}
              onChange={(event) => setChannelField({ emailUsername: event.target.value })}
              placeholder={t("settings.channels.emailUsernamePlaceholder")}
              autoComplete="username"
              spellCheck={false}
              className="h-9 border-slate-200/90 bg-white/78 text-xs text-slate-800 placeholder:text-slate-400"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="px-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
              {t("settings.channels.emailMailbox")}
            </span>
            <Input
              value={channels?.emailMailbox ?? "INBOX"}
              onChange={(event) => setChannelField({ emailMailbox: event.target.value })}
              placeholder="INBOX"
              autoComplete="off"
              spellCheck={false}
              className="h-9 border-slate-200/90 bg-white/78 text-xs text-slate-800 placeholder:text-slate-400"
            />
          </label>
        </div>

        <label className="mt-3 grid gap-1.5">
          <span className="px-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
            {t("settings.channels.emailKeywords")}
          </span>
          <Input
            value={keywords}
            onChange={(event) => setChannelField({ emailSearchKeywords: event.target.value })}
            placeholder={t("settings.channels.emailKeywordsPlaceholder")}
            autoComplete="off"
            spellCheck={false}
            className="h-9 border-slate-200/90 bg-white/78 text-xs text-slate-800 placeholder:text-slate-400"
          />
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy === "save" || !password.trim()}
            onClick={() => {
              void runPasswordSave();
            }}
          >
            <KeyRound className="mr-1.5 h-3.5 w-3.5" />
            {busy === "save" ? t("common.loading") : t("settings.channels.emailSavePassword")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy === "test"}
            onClick={() => {
              void runEmailTest();
            }}
          >
            <Inbox className="mr-1.5 h-3.5 w-3.5" />
            {busy === "test" ? t("common.loading") : t("settings.channels.emailTest")}
          </Button>
          {message ? (
            <span className={`rounded border px-2 py-1 text-[11px] ${messageClass(message.ok)}`}>
              {message.text}
            </span>
          ) : null}
        </div>

        {items.length > 0 ? (
          <div className="mt-3 rounded-2xl border border-slate-200/80 bg-white/70 p-2">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              <RefreshCw className="h-3 w-3" />
              <span>{syncSummary}</span>
            </div>
            <div className="grid gap-1.5">
              {items.slice(0, 3).map((item) => (
                <div key={item.id} className="min-w-0 rounded-xl border border-slate-200/70 bg-white/72 px-2 py-1.5">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-slate-800">{item.subject || t("settings.channels.emailUntitled")}</span>
                    <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                      {emailStatusLabel(item.statusTag, t)}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-slate-500">{item.from || item.date}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
