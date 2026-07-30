import type { Dispatch, SetStateAction } from "react";
import type { AgentToolPrefs, AppSettings } from "../../../shared/types/app";
import { SettingsBooleanRow } from "./SettingsBooleanRow";
import { UnpaywallContactSettingsField } from "./UnpaywallContactSettingsField";

type TranslationFn = (key: any) => string;

export function AgentToolsSettingsSection(props: {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings | null>>;
  t: TranslationFn;
}) {
  const { settings, setSettings, t } = props;
  const prefs: AgentToolPrefs = {
    webSearchEnabled: true,
    workspaceReadEnabled: true,
    pythonEnabled: true,
    mcpEnabled: true,
    writeRequiresConfirmation: true,
    ...(settings.uiPrefs?.agentToolPrefs ?? {}),
  };
  const updateUiPrefs = (patch: Partial<NonNullable<AppSettings["uiPrefs"]>>) => {
    setSettings((prev) => {
      const base = prev ?? settings;
      return { ...base, uiPrefs: { ...(base.uiPrefs ?? {}), ...patch } };
    });
  };
  const updateToolPref = (key: keyof AgentToolPrefs, value: boolean) => {
    updateUiPrefs({ agentToolPrefs: { ...prefs, [key]: value } });
  };

  return (
    <div className="grid gap-2">
      <p className="text-xs text-slate-500">{t("settings.agentToolsHint")}</p>
      <SettingsBooleanRow label={t("settings.agentTool.webSearch")} checked={Boolean(prefs.webSearchEnabled)} onCheckedChange={(value) => updateToolPref("webSearchEnabled", value)} />
      <SettingsBooleanRow label={t("settings.agentTool.workspaceRead")} checked={Boolean(prefs.workspaceReadEnabled)} onCheckedChange={(value) => updateToolPref("workspaceReadEnabled", value)} />
      <SettingsBooleanRow label={t("settings.agentTool.python")} checked={Boolean(prefs.pythonEnabled)} onCheckedChange={(value) => updateToolPref("pythonEnabled", value)} />
      <SettingsBooleanRow label={t("settings.agentTool.mcp")} checked={Boolean(prefs.mcpEnabled)} onCheckedChange={(value) => updateToolPref("mcpEnabled", value)} />
      <SettingsBooleanRow label={t("settings.agentTool.confirmWrites")} checked={Boolean(prefs.writeRequiresConfirmation)} onCheckedChange={(value) => updateToolPref("writeRequiresConfirmation", value)} />
      <UnpaywallContactSettingsField
        value={settings.uiPrefs?.unpaywallContactEmail ?? ""}
        onChange={(value) => updateUiPrefs({ unpaywallContactEmail: value })}
        t={t}
      />
    </div>
  );
}
