import { useState } from "react";
import { Bot } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { channelsDingTalkTest } from "../../../shared/api/share";
import type { AppSettings, ChannelPrefs } from "../../../shared/types/app";
import { useBackgroundImageObjectUrl } from "../../hooks/useBackgroundImageObjectUrl";
import { EmailChannelSettingsCard } from "./EmailChannelSettingsCard";
import { SettingsBooleanRow } from "./SettingsBooleanRow";
import { TelegramChannelSettingsCard } from "./TelegramChannelSettingsCard";

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

export function telegramProxyEnabledValue(
  channels?: Pick<ChannelPrefs, "telegramProxyEnabled" | "telegramProxyMode"> | null,
): boolean {
  return channels?.telegramProxyMode
    ? channels.telegramProxyMode !== "direct"
    : channels?.telegramProxyEnabled !== false;
}

export function ChannelsSettingsSection(props: {
  settings: AppSettings | null;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings | null>>;
  t: TranslationFn;
}) {
  const { settings, setSettings, t } = props;
  const backgroundPath = resolveActiveBackgroundPath(settings);
  const backgroundUrl = useBackgroundImageObjectUrl(backgroundPath);
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
      <TelegramChannelSettingsCard
        settings={settings}
        setChannelField={setChannelField}
        formatError={channelErrorText}
        t={t}
      />
      <EmailChannelSettingsCard
        settings={settings}
        setChannelField={setChannelField}
        formatError={channelErrorText}
        t={t}
      />
      <section className="app-material-content relative overflow-hidden rounded-[22px] border">
        {backgroundUrl ? (
          <>
            <div
              className="absolute inset-0 bg-cover bg-center opacity-[0.24]"
              style={{ backgroundImage: `url("${backgroundUrl}")` }}
              aria-hidden="true"
            />
          </>
        ) : null}
        <div className="absolute inset-0 bg-[color:var(--app-material-content)]" aria-hidden="true" />
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
            className="app-material-inset mt-4 rounded-2xl border px-3 py-3 text-xs text-slate-700 shadow-none"
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
                className="app-material-inset h-9 text-xs text-slate-800 placeholder:text-slate-400"
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
                className="app-material-inset h-9 text-xs text-slate-800 placeholder:text-slate-400"
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
    "channels.telegram.proxy_mode_invalid": t("settings.channels.errorTelegramProxyModeInvalid"),
    "channels.telegram.proxy_manual_invalid": t("settings.channels.errorTelegramProxyManualInvalid"),
    "channels.telegram.proxy_pac_failed": t("settings.channels.errorTelegramProxyPacFailed"),
    "channels.telegram.proxy_connect": t("settings.channels.errorTelegramProxyConnect"),
    "channels.telegram.dns": t("settings.channels.errorTelegramDns"),
    "channels.telegram.tls": t("settings.channels.errorTelegramTls"),
    "channels.telegram.timeout": t("settings.channels.errorTelegramTimeout"),
    "channels.telegram.transport": t("settings.channels.errorTelegramTransport"),
    "channels.telegram.parse": t("settings.channels.errorTelegramParse"),
    "channels.telegram.http_401": t("settings.channels.errorTelegramUnauthorized"),
    "channels.telegram.http_403": t("settings.channels.errorTelegramForbidden"),
    "channels.telegram.send_failed": t("settings.channels.errorTelegramSendFailed"),
    "channels.telegram.verify_failed": t("settings.channels.errorTelegramVerifyFailed"),
    "channels.telegram.get_updates_failed": t("settings.channels.errorTelegramGetUpdatesFailed"),
    "channels.telegram.token_invalid": t("settings.channels.errorTelegramTokenInvalid"),
    "channels.telegram.token_save_failed": t("settings.channels.errorTelegramTokenSaveFailed"),
    "channels.telegram.token_verify_failed": t("settings.channels.errorTelegramTokenVerifyFailed"),
    "channels.telegram.token_clear_failed": t("settings.channels.errorTelegramTokenClearFailed"),
    "channels.telegram.token_migration_failed": t("settings.channels.errorTelegramTokenMigrationFailed"),
    "channels.telegram.token_migration_verify_failed": t("settings.channels.errorTelegramTokenMigrationFailed"),
    "channels.dingtalk.disabled": t("settings.channels.errorDingtalkDisabled"),
    "channels.dingtalk.client_id_missing": t("settings.channels.errorDingtalkClientIdMissing"),
    "channels.dingtalk.client_secret_missing": t("settings.channels.errorDingtalkClientSecretMissing"),
    "channels.dingtalk.open_invalid": t("settings.channels.errorDingtalkOpenInvalid"),
    "channels.dingtalk.empty_text": t("settings.channels.errorEmptyText"),
    "channels.dingtalk.reply_target_missing": t("settings.channels.errorDingtalkReplyTargetMissing"),
    "channels.email.disabled": t("settings.channels.errorEmailDisabled"),
    "channels.email.address_missing": t("settings.channels.errorEmailAddressMissing"),
    "channels.email.host_missing": t("settings.channels.errorEmailHostMissing"),
    "channels.email.host_invalid": t("settings.channels.errorEmailHostInvalid"),
    "channels.email.port_invalid": t("settings.channels.errorEmailPortInvalid"),
    "channels.email.security_invalid": t("settings.channels.errorEmailSecurityInvalid"),
    "channels.email.password_missing": t("settings.channels.errorEmailPasswordMissing"),
    "channels.email.password_save_failed": t("settings.channels.errorEmailPasswordSaveFailed"),
    "channels.email.password_verify_failed": t("settings.channels.errorEmailPasswordVerifyFailed"),
    "settings.persistence.unavailable": t("settings.channels.errorSettingsPersistenceUnavailable"),
    "channels.email.transport": t("settings.channels.errorEmailTransport"),
    "channels.email.auth_failed": t("settings.channels.errorEmailAuthFailed"),
    "channels.email.mailbox_failed": t("settings.channels.errorEmailMailboxFailed"),
    "channels.email.parse": t("settings.channels.errorEmailParse"),
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
  if (key?.startsWith("channels.email.")) {
    return t("settings.channels.errorEmailGeneric");
  }
  return raw;
}
