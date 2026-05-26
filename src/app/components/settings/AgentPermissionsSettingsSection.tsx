import type { Dispatch, SetStateAction } from "react";
import type { AgentPermissionPrefs, AppSettings, PermissionMode } from "../../../shared/types/app";
import { SettingsSelectRow } from "./SettingsSelectRow";

type TranslationFn = (key: any) => string;

const PERMISSION_OPTIONS: Array<{ value: PermissionMode; key: string }> = [
  { value: "allow", key: "settings.agentPermission.allow" },
  { value: "ask", key: "settings.agentPermission.ask" },
  { value: "deny", key: "settings.agentPermission.deny" },
];

function normalizePermissions(prefs: AgentPermissionPrefs | undefined): AgentPermissionPrefs {
  return {
    webSearch: prefs?.webSearch ?? "allow",
    workspaceRead: prefs?.workspaceRead ?? "allow",
    python: prefs?.python ?? "ask",
    mcp: prefs?.mcp ?? "ask",
    skills: prefs?.skills ?? "allow",
    pluginCommands: prefs?.pluginCommands ?? "ask",
    nonLatexWrites: prefs?.nonLatexWrites ?? "ask",
    mcpServerModes: prefs?.mcpServerModes ?? {},
    pluginModes: prefs?.pluginModes ?? {},
  };
}

export function AgentPermissionsSettingsSection(props: {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings | null>>;
  t: TranslationFn;
}) {
  const { settings, setSettings, t } = props;
  const prefs = normalizePermissions(settings.uiPrefs?.agentPermissionPrefs);
  const options = PERMISSION_OPTIONS.map((item) => ({ value: item.value, label: t(item.key) }));
  const update = (key: keyof AgentPermissionPrefs, value: PermissionMode) => {
    setSettings((prev) => {
      const base = prev ?? settings;
      return {
        ...base,
        uiPrefs: {
          ...(base.uiPrefs ?? {}),
          agentPermissionPrefs: { ...normalizePermissions(base.uiPrefs?.agentPermissionPrefs), [key]: value },
        },
      };
    });
  };

  return (
    <div className="grid gap-3">
      <p className="text-xs text-slate-500">{t("settings.agentPermissionsHint")}</p>
      <SettingsSelectRow
        title={t("settings.agentPermission.webSearch")}
        value={prefs.webSearch ?? "allow"}
        description={t("settings.agentPermission.webSearchHint")}
        options={options}
        onChange={(value) => update("webSearch", value as PermissionMode)}
      />
      <SettingsSelectRow
        title={t("settings.agentPermission.workspaceRead")}
        value={prefs.workspaceRead ?? "allow"}
        description={t("settings.agentPermission.workspaceReadHint")}
        options={options}
        onChange={(value) => update("workspaceRead", value as PermissionMode)}
      />
      <SettingsSelectRow
        title={t("settings.agentPermission.python")}
        value={prefs.python ?? "ask"}
        description={t("settings.agentPermission.pythonHint")}
        options={options}
        onChange={(value) => update("python", value as PermissionMode)}
      />
      <SettingsSelectRow
        title={t("settings.agentPermission.mcp")}
        value={prefs.mcp ?? "ask"}
        description={t("settings.agentPermission.mcpHint")}
        options={options}
        onChange={(value) => update("mcp", value as PermissionMode)}
      />
      <SettingsSelectRow
        title={t("settings.agentPermission.skills")}
        value={prefs.skills ?? "allow"}
        description={t("settings.agentPermission.skillsHint")}
        options={options}
        onChange={(value) => update("skills", value as PermissionMode)}
      />
      <SettingsSelectRow
        title={t("settings.agentPermission.pluginCommands")}
        value={prefs.pluginCommands ?? "ask"}
        description={t("settings.agentPermission.pluginCommandsHint")}
        options={options}
        onChange={(value) => update("pluginCommands", value as PermissionMode)}
      />
      <SettingsSelectRow
        title={t("settings.agentPermission.nonLatexWrites")}
        value={prefs.nonLatexWrites ?? "ask"}
        description={t("settings.agentPermission.nonLatexWritesHint")}
        options={options}
        onChange={(value) => update("nonLatexWrites", value as PermissionMode)}
      />
    </div>
  );
}
