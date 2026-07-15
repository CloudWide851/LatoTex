import { ChevronDown, Inbox, KeyRound, Mail, RefreshCw, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Select } from "../../../components/ui/select";
import {
  channelsEmailFetchSubmission,
  channelsEmailPasswordSaveVerified,
  channelsEmailTest,
} from "../../../shared/api/share";
import type { AppSettings, EmailSubmissionItem } from "../../../shared/types/app";
import {
  persistSettingsNow,
  SETTINGS_PERSISTENCE_UNAVAILABLE,
} from "../../settings/settingsPersistenceBridge";
import { SettingsBooleanRow } from "./SettingsBooleanRow";

type TranslationFn = (key: any) => string;
type ChannelPrefs = NonNullable<NonNullable<AppSettings["uiPrefs"]>["channels"]>;
type ChannelPatch = Partial<ChannelPrefs>;
type BusyAction = "save" | "test" | "sync";
type StatusMessage = { tone: "info" | "success" | "error"; text: string };

const SECURITY_OPTIONS = ["tls", "starttls", "plain"] as const;
const DEFAULT_KEYWORDS = "submission, manuscript, decision, revision, review, editor";

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

function defaultPort(security: string): number {
  return security === "plain" ? 143 : 993;
}

function hasAdvancedValues(channels: ChannelPrefs | undefined): boolean {
  const security = channels?.emailSecurity ?? "tls";
  const mailbox = channels?.emailMailbox?.trim() ?? "";
  const keywords = channels?.emailSearchKeywords?.trim() ?? "";
  return security !== "tls"
    || (channels?.emailImapPort !== undefined && channels.emailImapPort !== defaultPort(security))
    || Boolean(channels?.emailUsername?.trim())
    || Boolean(mailbox && mailbox.toUpperCase() !== "INBOX")
    || Boolean(keywords && keywords !== DEFAULT_KEYWORDS)
    || (channels?.emailMaxResults !== undefined && channels.emailMaxResults !== 20);
}

function messageClass(tone: StatusMessage["tone"]): string {
  if (tone === "success") {
    return "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (tone === "error") {
    return "border-red-500/35 bg-red-500/10 text-red-600 dark:text-red-300";
  }
  return "border-[color:var(--editor-widget-border)] bg-[color:var(--editor-surface-bg)] text-[color:var(--editor-tab-muted)]";
}

export function EmailChannelSettingsCard(props: {
  settings: AppSettings | null;
  setChannelField: (patch: ChannelPatch) => void;
  formatError: (raw: string, t: TranslationFn) => string;
  t: TranslationFn;
}) {
  const { settings, setChannelField, formatError, t } = props;
  const channels = settings?.uiPrefs?.channels;
  const security = channels?.emailSecurity ?? "tls";
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const busyRef = useRef<BusyAction | null>(null);
  const [message, setMessage] = useState<StatusMessage | null>(null);
  const [items, setItems] = useState<EmailSubmissionItem[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(() => hasAdvancedValues(channels));
  const maxResults = channels?.emailMaxResults ?? 20;
  const keywords = channels?.emailSearchKeywords ?? DEFAULT_KEYWORDS;
  const portValue = String(channels?.emailImapPort ?? defaultPort(security));
  const syncSummary = useMemo(() => (
    items.length === 0
      ? t("settings.channels.emailSyncEmpty")
      : formatMessage(t("settings.channels.emailSyncOk"), { count: items.length })
  ), [items.length, t]);

  useEffect(() => {
    if (security === "plain" || hasAdvancedValues(channels)) {
      setAdvancedOpen(true);
    }
  }, [channels, security]);

  const savePasswordIfNeeded = async () => {
    const nextPassword = password.trim();
    if (!nextPassword) {
      return;
    }
    await channelsEmailPasswordSaveVerified({ password: nextPassword });
    setPassword("");
  };

  const beginBusy = (action: BusyAction): boolean => {
    if (busyRef.current) {
      return false;
    }
    busyRef.current = action;
    setBusy(action);
    return true;
  };

  const endBusy = () => {
    busyRef.current = null;
    setBusy(null);
  };

  const runPasswordSave = async () => {
    if (!beginBusy("save")) {
      return;
    }
    setMessage(null);
    try {
      await savePasswordIfNeeded();
      setMessage({ tone: "success", text: t("settings.channels.emailPasswordSaved") });
    } catch (error) {
      setMessage({ tone: "error", text: formatError(String(error), t) });
    } finally {
      endBusy();
    }
  };

  const runConnectionAction = async (action: "test" | "sync") => {
    if (!beginBusy(action)) {
      return;
    }
    setMessage({ tone: "info", text: t("settings.channels.emailSavingSettings") });
    try {
      if (!settings) {
        throw SETTINGS_PERSISTENCE_UNAVAILABLE;
      }
      await persistSettingsNow(settings);
      await savePasswordIfNeeded();
      if (action === "test") {
        await channelsEmailTest();
        setMessage({ tone: "success", text: t("settings.channels.emailTestOk") });
        return;
      }
      const result = await channelsEmailFetchSubmission({ limit: maxResults });
      setItems(result.items);
      setMessage({
        tone: "success",
        text: result.items.length > 0
          ? formatMessage(t("settings.channels.emailSyncOk"), { count: result.items.length })
          : t("settings.channels.emailSyncEmpty"),
      });
    } catch (error) {
      setMessage({ tone: "error", text: formatError(String(error), t) });
    } finally {
      endBusy();
    }
  };

  return (
    <section className="rounded-lg border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-widget-bg)] p-4 text-[color:var(--editor-tab-text)] shadow-sm motion-card-pop">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <Mail className="h-4 w-4 shrink-0 text-[color:var(--app-accent)]" />
            <span className="truncate">{t("settings.channels.email")}</span>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[color:var(--editor-tab-muted)]">
            {t("settings.channels.emailDescription")}
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy !== null}
          onClick={() => void runConnectionAction("sync")}
        >
          {busy === "sync" ? t("common.loading") : t("settings.channels.emailSync")}
        </Button>
      </div>

      <SettingsBooleanRow
        label={t("settings.channels.emailEnabled")}
        checked={Boolean(channels?.emailEnabled)}
        className="mt-4 rounded-md border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-surface-bg)] px-3 py-3 text-xs shadow-none"
        textClassName="text-[color:var(--editor-tab-text)]"
        onCheckedChange={(nextValue) => setChannelField({ emailEnabled: nextValue })}
      />

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="grid min-w-0 gap-1.5 text-xs font-medium text-[color:var(--editor-tab-muted)]">
          <span>{t("settings.channels.emailAddress")}</span>
          <Input
            value={channels?.emailAddress ?? ""}
            onChange={(event) => setChannelField({ emailAddress: event.target.value })}
            placeholder={t("settings.channels.emailAddress")}
            autoComplete="email"
            spellCheck={false}
            className="h-9 text-xs"
          />
        </label>
        <label className="grid min-w-0 gap-1.5 text-xs font-medium text-[color:var(--editor-tab-muted)]">
          <span>{t("settings.channels.emailPassword")}</span>
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t("settings.channels.emailPasswordPlaceholder")}
            autoComplete="current-password"
            spellCheck={false}
            className="h-9 text-xs"
          />
        </label>
      </div>

      <label className="mt-3 grid min-w-0 gap-1.5 text-xs font-medium text-[color:var(--editor-tab-muted)]">
        <span>{t("settings.channels.emailImapHost")}</span>
        <Input
          value={channels?.emailImapHost ?? ""}
          onChange={(event) => setChannelField({ emailImapHost: event.target.value })}
          placeholder="imap.example.com"
          autoComplete="off"
          spellCheck={false}
          className="h-9 text-xs"
        />
      </label>

      <div className="mt-3 border-t border-[color:var(--editor-widget-border)] pt-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="px-2"
          aria-expanded={advancedOpen}
          aria-controls="email-advanced-settings"
          onClick={() => setAdvancedOpen((value) => !value)}
        >
          <ChevronDown className={`mr-1.5 h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
          {t(advancedOpen ? "settings.channels.emailAdvancedHide" : "settings.channels.emailAdvancedShow")}
        </Button>
      </div>

      {advancedOpen ? (
        <div id="email-advanced-settings" className="mt-2 grid gap-3 border-t border-[color:var(--editor-widget-border)] pt-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="grid min-w-0 gap-1.5 text-xs font-medium text-[color:var(--editor-tab-muted)]">
            <span>{t("settings.channels.emailPort")}</span>
            <Input
              value={portValue}
              inputMode="numeric"
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                setChannelField({ emailImapPort: Number.isFinite(parsed) ? parsed : undefined });
              }}
              className="h-9 text-xs"
            />
          </label>
          <label className="grid min-w-0 gap-1.5 text-xs font-medium text-[color:var(--editor-tab-muted)]">
            <span>{t("settings.channels.emailSecurity")}</span>
            <Select
              uiSize="sm"
              value={security}
              onChange={(event) => setChannelField({ emailSecurity: event.currentTarget.value })}
              aria-label={t("settings.channels.emailSecurity")}
              className="h-9 text-xs"
            >
              {SECURITY_OPTIONS.map((option) => (
                <option key={option} value={option}>{t(`settings.channels.emailSecurity.${option}`)}</option>
              ))}
            </Select>
          </label>
          <label className="grid min-w-0 gap-1.5 text-xs font-medium text-[color:var(--editor-tab-muted)]">
            <span>{t("settings.channels.emailMaxResults")}</span>
            <Input
              value={String(maxResults)}
              inputMode="numeric"
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                setChannelField({ emailMaxResults: Number.isFinite(parsed) ? parsed : undefined });
              }}
              className="h-9 text-xs"
            />
          </label>
          <label className="grid min-w-0 gap-1.5 text-xs font-medium text-[color:var(--editor-tab-muted)]">
            <span>{t("settings.channels.emailUsername")}</span>
            <Input
              value={channels?.emailUsername ?? ""}
              onChange={(event) => setChannelField({ emailUsername: event.target.value })}
              placeholder={t("settings.channels.emailUsernamePlaceholder")}
              autoComplete="username"
              spellCheck={false}
              className="h-9 text-xs"
            />
          </label>
          <label className="grid min-w-0 gap-1.5 text-xs font-medium text-[color:var(--editor-tab-muted)]">
            <span>{t("settings.channels.emailMailbox")}</span>
            <Input
              value={channels?.emailMailbox ?? "INBOX"}
              onChange={(event) => setChannelField({ emailMailbox: event.target.value })}
              placeholder="INBOX"
              autoComplete="off"
              spellCheck={false}
              className="h-9 text-xs"
            />
          </label>
          <label className="grid min-w-0 gap-1.5 text-xs font-medium text-[color:var(--editor-tab-muted)] sm:col-span-2 lg:col-span-3">
            <span>{t("settings.channels.emailKeywords")}</span>
            <Input
              value={keywords}
              onChange={(event) => setChannelField({ emailSearchKeywords: event.target.value })}
              placeholder={t("settings.channels.emailKeywordsPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              className="h-9 text-xs"
            />
          </label>
        </div>
      ) : null}

      {security === "plain" ? (
        <div role="alert" className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-800 dark:text-amber-200">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t("settings.channels.emailPlainWarning")}</span>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={busy !== null || !password.trim()}
          onClick={() => void runPasswordSave()}
        >
          <KeyRound className="mr-1.5 h-3.5 w-3.5" />
          {busy === "save" ? t("common.loading") : t("settings.channels.emailSavePassword")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy !== null}
          onClick={() => void runConnectionAction("test")}
        >
          <Inbox className="mr-1.5 h-3.5 w-3.5" />
          {busy === "test" ? t("common.loading") : t("settings.channels.emailTest")}
        </Button>
        {message ? (
          <span
            role={message.tone === "error" ? "alert" : "status"}
            aria-live={message.tone === "error" ? "assertive" : "polite"}
            className={`min-w-0 rounded-md border px-2.5 py-1.5 text-xs ${messageClass(message.tone)}`}
          >
            {message.text}
          </span>
        ) : null}
      </div>

      {items.length > 0 ? (
        <div className="mt-3 border-t border-[color:var(--editor-widget-border)] pt-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[color:var(--editor-tab-muted)]">
            <RefreshCw className="h-3.5 w-3.5" />
            <span>{syncSummary}</span>
          </div>
          <div className="grid gap-2 lg:grid-cols-3">
            {items.slice(0, 3).map((item) => (
              <div key={item.id} className="min-w-0 rounded-md border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-surface-bg)] px-2.5 py-2">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold">{item.subject || t("settings.channels.emailUntitled")}</span>
                  <span className="shrink-0 rounded-full border border-[color:var(--editor-widget-border)] px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--editor-tab-muted)]">
                    {emailStatusLabel(item.statusTag, t)}
                  </span>
                </div>
                <div className="mt-1 truncate text-xs text-[color:var(--editor-tab-muted)]">{item.from || item.date}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
