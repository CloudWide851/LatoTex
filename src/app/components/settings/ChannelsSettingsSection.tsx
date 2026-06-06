import { useState } from "react";
import { Bot } from "lucide-react";
import telegramIcon from "../../../assets/brands/telegram.svg";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { channelsDingTalkTest, channelsTelegramTest } from "../../../shared/api/share";
import type { AppSettings } from "../../../shared/types/app";
import { useBackgroundImageObjectUrl } from "../../hooks/useBackgroundImageObjectUrl";
import { SettingsBooleanRow } from "./SettingsBooleanRow";

type TranslationFn = (key: any) => string;

function resolveActiveBackgroundPath(settings: AppSettings | null): string {
  const preferred = String(settings?.uiPrefs?.backgroundImagePath ?? "").trim();
  const fromList = Array.isArray(settings?.uiPrefs?.backgroundImagePaths)
    ? settings?.uiPrefs?.backgroundImagePaths ?? []
    : [];
  const normalized = fromList
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length > 0);
  return preferred && normalized.includes(preferred) ? preferred : "";
}

export function ChannelsSettingsSection(props: {
  settings: AppSettings | null;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings | null>>;
  t: TranslationFn;
}) {
  const { settings, setSettings, t } = props;
  const backgroundPath = resolveActiveBackgroundPath(settings);
  const backgroundUrl = useBackgroundImageObjectUrl(backgroundPath);
  const [testBusy, setTestBusy] = useState(false);
  const [testMessage, setTestMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [dingtalkBusy, setDingtalkBusy] = useState(false);
  const [dingtalkMessage, setDingtalkMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const setChannelField = (
    patch: Partial<NonNullable<NonNullable<AppSettings["uiPrefs"]>["channels"]>>,
  ) => {
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            uiPrefs: {
              ...(prev.uiPrefs ?? {}),
              channels: {
                ...(prev.uiPrefs?.channels ?? {}),
                ...patch,
              },
            },
          }
        : prev,
    );
  };

  const runTelegramTest = async () => {
    const token = settings?.uiPrefs?.channels?.telegramBotToken?.trim() ?? "";
    const chatId = settings?.uiPrefs?.channels?.telegramChatId?.trim() ?? "";
    const apiBaseUrl = settings?.uiPrefs?.channels?.telegramApiBaseUrl?.trim() ?? "";
    setTestBusy(true);
    setTestMessage(null);
    try {
      await channelsTelegramTest({
        token,
        chatId: chatId || undefined,
        apiBaseUrl: apiBaseUrl || undefined,
        text: t("settings.channels.telegramTestMessage"),
      });
      setTestMessage({ ok: true, text: t(chatId ? "settings.channels.telegramTestOk" : "settings.channels.telegramVerifyOk") });
    } catch (error) {
      setTestMessage({ ok: false, text: channelErrorText(String(error), t) });
    } finally {
      setTestBusy(false);
    }
  };

  const runDingTalkTest = async () => {
    const clientId = settings?.uiPrefs?.channels?.dingtalkClientId?.trim() ?? "";
    const clientSecret = settings?.uiPrefs?.channels?.dingtalkClientSecret?.trim() ?? "";
    setDingtalkBusy(true);
    setDingtalkMessage(null);
    try {
      await channelsDingTalkTest({ clientId, clientSecret });
      setDingtalkMessage({ ok: true, text: t("settings.channels.dingtalkVerifyOk") });
    } catch (error) {
      setDingtalkMessage({ ok: false, text: channelErrorText(String(error), t) });
    } finally {
      setDingtalkBusy(false);
    }
  };

  return (
    <div className="grid gap-3">
      <section className="relative overflow-hidden rounded-[22px] border border-slate-200/80 bg-white shadow-soft">
        {backgroundUrl ? (
          <>
            <div
              className="absolute inset-0 bg-cover bg-center opacity-30"
              style={{ backgroundImage: `url("${backgroundUrl}")` }}
              aria-hidden="true"
            />
            <div
              className="absolute inset-0 backdrop-blur-[calc(var(--wallpaper-blur,18px)*0.45)]"
              aria-hidden="true"
            />
          </>
        ) : null}
        <div
          className={`absolute inset-0 ${
            backgroundUrl
              ? "bg-[linear-gradient(180deg,rgba(255,255,255,0.74),rgba(248,250,252,0.92))]"
              : "bg-[linear-gradient(180deg,#f8fafc,#ffffff)]"
          }`}
          aria-hidden="true"
        />
        <div className="relative z-10 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/70 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                <span>{t("settings.section.channels")}</span>
              </div>
              <div className="mt-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                <img src={telegramIcon} alt="" className="h-5 w-5 rounded-md" />
                <span>{t("settings.channels.telegram")}</span>
              </div>
            </div>
          </div>

          <SettingsBooleanRow
            label={t("settings.channels.telegramEnabled")}
            checked={Boolean(settings?.uiPrefs?.channels?.telegramEnabled)}
            className="mt-4 rounded-2xl border border-slate-200/80 bg-white/72 px-3 py-3 text-xs text-slate-700 shadow-none"
            textClassName="text-slate-700"
            checkboxClassName="border-slate-400"
            onCheckedChange={(nextValue) => setChannelField({ telegramEnabled: nextValue })}
          />

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="px-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
                {t("settings.channels.telegramToken")}
              </span>
              <Input
                value={settings?.uiPrefs?.channels?.telegramBotToken ?? ""}
                onChange={(event) => setChannelField({ telegramBotToken: event.target.value })}
                placeholder={t("settings.channels.telegramToken")}
                autoComplete="off"
                spellCheck={false}
                className="h-9 border-slate-200/90 bg-white/78 text-xs text-slate-800 placeholder:text-slate-400"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="px-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
                {t("settings.channels.telegramChatId")}
              </span>
              <Input
                value={settings?.uiPrefs?.channels?.telegramChatId ?? ""}
                onChange={(event) => setChannelField({ telegramChatId: event.target.value })}
                placeholder={t("settings.channels.telegramChatId")}
                autoComplete="off"
                spellCheck={false}
                className="h-9 border-slate-200/90 bg-white/78 text-xs text-slate-800 placeholder:text-slate-400"
              />
            </label>
          </div>
          <label className="mt-3 grid gap-1.5">
            <span className="px-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
              {t("settings.channels.telegramApiBaseUrl")}
            </span>
            <Input
              value={settings?.uiPrefs?.channels?.telegramApiBaseUrl ?? ""}
              onChange={(event) => setChannelField({ telegramApiBaseUrl: event.target.value })}
              placeholder={t("settings.channels.telegramApiBaseUrlPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              className="h-9 border-slate-200/90 bg-white/78 text-xs text-slate-800 placeholder:text-slate-400"
            />
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={testBusy}
              onClick={() => {
                void runTelegramTest();
              }}
            >
              {testBusy ? t("common.loading") : t("settings.channels.telegramTest")}
            </Button>
            {testMessage ? (
              <span className={`rounded border px-2 py-1 text-[11px] ${
                testMessage.ok
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-rose-200 bg-rose-50 text-rose-700"
              }`}>
                {testMessage.text}
              </span>
            ) : null}
          </div>
        </div>
      </section>
      <section className="relative overflow-hidden rounded-[22px] border border-slate-200/80 bg-white shadow-soft">
        {backgroundUrl ? (
          <>
            <div
              className="absolute inset-0 bg-cover bg-center opacity-[0.24]"
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
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-[#1677ff]/10 text-[#1677ff]">
              <Bot className="h-3.5 w-3.5" />
            </span>
            <span>{t("settings.channels.dingtalk")}</span>
          </div>
          <SettingsBooleanRow
            label={t("settings.channels.dingtalkEnabled")}
            checked={Boolean(settings?.uiPrefs?.channels?.dingtalkEnabled)}
            className="mt-4 rounded-2xl border border-slate-200/80 bg-white/72 px-3 py-3 text-xs text-slate-700 shadow-none"
            textClassName="text-slate-700"
            checkboxClassName="border-slate-400"
            onCheckedChange={(nextValue) => setChannelField({ dingtalkEnabled: nextValue })}
          />
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="px-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
                {t("settings.channels.dingtalkClientId")}
              </span>
              <Input
                value={settings?.uiPrefs?.channels?.dingtalkClientId ?? ""}
                onChange={(event) => setChannelField({ dingtalkClientId: event.target.value })}
                placeholder={t("settings.channels.dingtalkClientId")}
                autoComplete="off"
                spellCheck={false}
                className="h-9 border-slate-200/90 bg-white/78 text-xs text-slate-800 placeholder:text-slate-400"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="px-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
                {t("settings.channels.dingtalkClientSecret")}
              </span>
              <Input
                type="password"
                value={settings?.uiPrefs?.channels?.dingtalkClientSecret ?? ""}
                onChange={(event) => setChannelField({ dingtalkClientSecret: event.target.value })}
                placeholder={t("settings.channels.dingtalkClientSecret")}
                autoComplete="off"
                spellCheck={false}
                className="h-9 border-slate-200/90 bg-white/78 text-xs text-slate-800 placeholder:text-slate-400"
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={dingtalkBusy}
              onClick={() => {
                void runDingTalkTest();
              }}
            >
              {dingtalkBusy ? t("common.loading") : t("settings.channels.dingtalkTest")}
            </Button>
            {dingtalkMessage ? (
              <span className={`rounded border px-2 py-1 text-[11px] ${
                dingtalkMessage.ok
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-rose-200 bg-rose-50 text-rose-700"
              }`}>
                {dingtalkMessage.text}
              </span>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

export function channelErrorText(raw: string, t: TranslationFn): string {
  const key = raw.split(":")[0]?.trim();
  const localized: Record<string, string> = {
    "channels.telegram.disabled": t("settings.channels.errorTelegramDisabled"),
    "channels.telegram.token_missing": t("settings.channels.errorTelegramTokenMissing"),
    "channels.telegram.chat_id_missing": t("settings.channels.errorTelegramChatIdMissing"),
    "channels.telegram.empty_text": t("settings.channels.errorEmptyText"),
    "channels.telegram.base_url_invalid": t("settings.channels.errorTelegramBaseUrlInvalid"),
    "channels.telegram.transport": t("settings.channels.errorTelegramTransport"),
    "channels.telegram.parse": t("settings.channels.errorTelegramParse"),
    "channels.telegram.http_401": t("settings.channels.errorTelegramUnauthorized"),
    "channels.telegram.http_403": t("settings.channels.errorTelegramForbidden"),
    "channels.telegram.send_failed": t("settings.channels.errorTelegramSendFailed"),
    "channels.telegram.verify_failed": t("settings.channels.errorTelegramVerifyFailed"),
    "channels.telegram.get_updates_failed": t("settings.channels.errorTelegramGetUpdatesFailed"),
    "channels.dingtalk.disabled": t("settings.channels.errorDingtalkDisabled"),
    "channels.dingtalk.client_id_missing": t("settings.channels.errorDingtalkClientIdMissing"),
    "channels.dingtalk.client_secret_missing": t("settings.channels.errorDingtalkClientSecretMissing"),
    "channels.dingtalk.open_invalid": t("settings.channels.errorDingtalkOpenInvalid"),
    "channels.dingtalk.empty_text": t("settings.channels.errorEmptyText"),
    "channels.dingtalk.reply_target_missing": t("settings.channels.errorDingtalkReplyTargetMissing"),
  };
  if (localized[key]) {
    return localized[key];
  }
  if (key?.startsWith("channels.telegram.http_")) {
    return t("settings.channels.errorTelegramHttp");
  }
  if (key?.startsWith("channels.telegram.")) {
    return t("settings.channels.errorTelegramGeneric");
  }
  return raw;
}
