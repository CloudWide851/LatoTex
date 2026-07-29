import { KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import telegramIcon from "../../../assets/brands/telegram.svg";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Select } from "../../../components/ui/select";
import {
  channelsTelegramTest,
  channelsTelegramTokenClear,
  channelsTelegramTokenSaveVerified,
} from "../../../shared/api/share";
import type { AppSettings, TelegramConnectionResult, TelegramProxyMode } from "../../../shared/types/app";
import {
  persistSettingsNow,
  SETTINGS_PERSISTENCE_UNAVAILABLE,
} from "../../settings/settingsPersistenceBridge";
import { SettingsBooleanRow } from "./SettingsBooleanRow";

type TranslationFn = (key: any) => string;
type ChannelPatch = Partial<NonNullable<NonNullable<AppSettings["uiPrefs"]>["channels"]>>;
type BusyAction = "verify" | "clear";
type StatusMessage = { ok: boolean; text: string; result?: TelegramConnectionResult };

const PROXY_MODES: TelegramProxyMode[] = ["system", "manual", "direct"];

function proxySourceLabel(source: string, t: TranslationFn): string {
  const keys: Record<string, string> = {
    direct: "settings.channels.telegramProxySource.direct",
    environment: "settings.channels.telegramProxySource.environment",
    manual: "settings.channels.telegramProxySource.manual",
    wininet: "settings.channels.telegramProxySource.wininet",
    wininet_bypass: "settings.channels.telegramProxySource.wininetBypass",
    wininet_direct: "settings.channels.telegramProxySource.wininetDirect",
    winhttp_auto: "settings.channels.telegramProxySource.winhttpAuto",
    unresolved: "settings.channels.telegramProxySource.unresolved",
  };
  return t(keys[source] ?? "settings.channels.telegramProxySource.unresolved");
}

function stageLabel(stage: string, t: TranslationFn): string {
  const keys: Record<string, string> = {
    configuration: "settings.channels.telegramStage.configuration",
    proxyResolve: "settings.channels.telegramStage.proxyResolve",
    proxyConnect: "settings.channels.telegramStage.proxyConnect",
    dns: "settings.channels.telegramStage.dns",
    tls: "settings.channels.telegramStage.tls",
    http: "settings.channels.telegramStage.http",
    auth: "settings.channels.telegramStage.auth",
    responseParse: "settings.channels.telegramStage.responseParse",
    complete: "settings.channels.telegramStage.complete",
  };
  return t(keys[stage] ?? "settings.channels.telegramStage.http");
}

export function TelegramChannelSettingsCard(props: {
  settings: AppSettings | null;
  setChannelField: (patch: ChannelPatch) => void;
  formatError: (raw: string, t: TranslationFn) => string;
  t: TranslationFn;
}) {
  const { settings, setChannelField, formatError, t } = props;
  const channels = settings?.uiPrefs?.channels;
  const proxyMode = channels?.telegramProxyMode
    ?? (channels?.telegramProxyEnabled === false ? "direct" : "system");
  const tokenStored = Boolean(channels?.telegramTokenStored);
  const [tokenDraft, setTokenDraft] = useState("");
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const busyRef = useRef<BusyAction | null>(null);
  const [message, setMessage] = useState<StatusMessage | null>(null);

  const begin = (action: BusyAction) => {
    if (busyRef.current) return false;
    busyRef.current = action;
    setBusy(action);
    setMessage(null);
    return true;
  };

  const end = () => {
    busyRef.current = null;
    setBusy(null);
  };

  const verify = async () => {
    if (!begin("verify")) return;
    try {
      if (!settings) throw SETTINGS_PERSISTENCE_UNAVAILABLE;
      await persistSettingsNow(settings);
      const nextToken = tokenDraft.trim();
      if (nextToken) {
        await channelsTelegramTokenSaveVerified({ token: nextToken });
        setTokenDraft("");
        setChannelField({ telegramTokenStored: true });
      }
      const result = await channelsTelegramTest({
        text: t("settings.channels.telegramTestMessage"),
      });
      setMessage({
        ok: result.ok,
        text: result.ok
          ? t(channels?.telegramChatId?.trim()
            ? "settings.channels.telegramTestOk"
            : "settings.channels.telegramVerifyOk")
          : formatError(result.code, t),
        result,
      });
    } catch (error) {
      setMessage({ ok: false, text: formatError(String(error), t) });
    } finally {
      end();
    }
  };

  const clearToken = async () => {
    if (!begin("clear")) return;
    try {
      await channelsTelegramTokenClear();
      setTokenDraft("");
      setChannelField({ telegramTokenStored: false });
      setMessage({ ok: true, text: t("settings.channels.telegramTokenCleared") });
    } catch (error) {
      setMessage({ ok: false, text: formatError(String(error), t) });
    } finally {
      end();
    }
  };

  return (
    <section className="app-material-content rounded-[22px] border p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--editor-tab-text)]">
            <img src={telegramIcon} alt="" className="h-5 w-5 rounded-md" />
            <span>{t("settings.channels.telegram")}</span>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[color:var(--editor-tab-muted)]">
            {t("settings.channels.telegramDescription")}
          </p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
          tokenStored
            ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            : "border-[color:var(--editor-widget-border)] text-[color:var(--editor-tab-muted)]"
        }`}>
          <ShieldCheck className="h-3.5 w-3.5" />
          {t(tokenStored
            ? "settings.channels.telegramTokenStored"
            : "settings.channels.telegramTokenNotStored")}
        </span>
      </div>

      <SettingsBooleanRow
        label={t("settings.channels.telegramEnabled")}
        checked={Boolean(channels?.telegramEnabled)}
        className="app-material-inset mt-4 rounded-xl border px-3 py-3 text-xs shadow-none"
        textClassName="text-[color:var(--editor-tab-text)]"
        onCheckedChange={(telegramEnabled) => setChannelField({ telegramEnabled })}
      />

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="grid min-w-0 gap-1.5 text-xs font-medium text-[color:var(--editor-tab-muted)]">
          <span>{t("settings.channels.telegramToken")}</span>
          <Input
            type="password"
            value={tokenDraft}
            onChange={(event) => setTokenDraft(event.target.value)}
            placeholder={tokenStored
              ? t("settings.channels.telegramTokenReplacePlaceholder")
              : t("settings.channels.telegramToken")}
            autoComplete="new-password"
            spellCheck={false}
            className="h-9 text-xs"
          />
        </label>
        <label className="grid min-w-0 gap-1.5 text-xs font-medium text-[color:var(--editor-tab-muted)]">
          <span>{t("settings.channels.telegramChatId")}</span>
          <Input
            value={channels?.telegramChatId ?? ""}
            onChange={(event) => setChannelField({ telegramChatId: event.target.value })}
            placeholder={t("settings.channels.telegramChatId")}
            autoComplete="off"
            spellCheck={false}
            className="h-9 text-xs"
          />
        </label>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="grid min-w-0 gap-1.5 text-xs font-medium text-[color:var(--editor-tab-muted)]">
          <span>{t("settings.channels.telegramProxyMode")}</span>
          <Select
            uiSize="sm"
            value={proxyMode}
            onChange={(event) => setChannelField({
              telegramProxyMode: event.currentTarget.value as TelegramProxyMode,
            })}
            className="h-9 text-xs"
          >
            {PROXY_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t(`settings.channels.telegramProxyMode.${mode}`)}
              </option>
            ))}
          </Select>
        </label>
        {proxyMode === "manual" ? (
          <label className="grid min-w-0 gap-1.5 text-xs font-medium text-[color:var(--editor-tab-muted)]">
            <span>{t("settings.channels.telegramManualProxyUrl")}</span>
            <Input
              value={channels?.telegramManualProxyUrl ?? ""}
              onChange={(event) => setChannelField({ telegramManualProxyUrl: event.target.value })}
              placeholder={t("settings.channels.telegramManualProxyPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              className="h-9 text-xs"
            />
          </label>
        ) : null}
      </div>

      <label className="mt-3 grid min-w-0 gap-1.5 text-xs font-medium text-[color:var(--editor-tab-muted)]">
        <span>{t("settings.channels.telegramApiBaseUrl")}</span>
        <Input
          value={channels?.telegramApiBaseUrl ?? ""}
          onChange={(event) => setChannelField({ telegramApiBaseUrl: event.target.value })}
          placeholder={t("settings.channels.telegramApiBaseUrlPlaceholder")}
          autoComplete="off"
          spellCheck={false}
          className="h-9 text-xs"
        />
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={busy !== null || (!tokenStored && !tokenDraft.trim())}
          onClick={() => void verify()}
        >
          <KeyRound className="mr-1.5 h-3.5 w-3.5" />
          {busy === "verify"
            ? t("common.loading")
            : t(tokenDraft.trim()
              ? "settings.channels.telegramSaveAndVerify"
              : "settings.channels.telegramTest")}
        </Button>
        {tokenStored ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => void clearToken()}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            {busy === "clear" ? t("common.loading") : t("settings.channels.telegramTokenClear")}
          </Button>
        ) : null}
      </div>

      {message ? (
        <div
          role={message.ok ? "status" : "alert"}
          className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
            message.ok
              ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-red-500/35 bg-red-500/10 text-red-600 dark:text-red-300"
          }`}
        >
          <div>{message.text}</div>
          {message.result ? (
            <div className="mt-1 text-[11px] opacity-80">
              {stageLabel(message.result.stage, t)}
              {" · "}
              {proxySourceLabel(message.result.proxySource, t)}
              {message.result.retryable ? ` · ${t("settings.channels.telegramRetrySafe")}` : ""}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
