import type { Dispatch, SetStateAction } from "react";
import type { AgentToolPrefs, AppSettings, McpServerConfig } from "../../../shared/types/app";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { SettingsBooleanRow } from "./SettingsBooleanRow";

type TranslationFn = (key: any) => string;

const STITCH_SERVER: McpServerConfig = {
  id: "stitch",
  command: "pnpm",
  args: ["exec", "stitch-mcp", "proxy"],
  env: { STITCH_USE_SYSTEM_GCLOUD: "1" },
  enabled: true,
};

function ensureStitchServer(servers: McpServerConfig[]): McpServerConfig[] {
  if (servers.some((server) => server.id === "stitch")) {
    return servers;
  }
  return [...servers, STITCH_SERVER];
}

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
  const servers = settings.uiPrefs?.mcpServers ?? [];
  const enabledSkills = settings.uiPrefs?.enabledSkills ?? [];
  const stitchServer = servers.find((server) => server.id === "stitch") ?? STITCH_SERVER;

  const updateUiPrefs = (patch: Partial<NonNullable<AppSettings["uiPrefs"]>>) => {
    setSettings((prev) => {
      const base = prev ?? settings;
      return { ...base, uiPrefs: { ...(base.uiPrefs ?? {}), ...patch } };
    });
  };
  const updateToolPref = (key: keyof AgentToolPrefs, value: boolean) => {
    updateUiPrefs({ agentToolPrefs: { ...prefs, [key]: value } });
  };
  const updateStitchServer = (patch: Partial<McpServerConfig>) => {
    const nextServer = { ...stitchServer, ...patch, id: "stitch" };
    updateUiPrefs({
      mcpServers: ensureStitchServer(servers).map((server) =>
        server.id === "stitch" ? nextServer : server,
      ),
    });
  };
  const toggleSkill = (skill: string, enabled: boolean) => {
    updateUiPrefs({
      enabledSkills: enabled
        ? Array.from(new Set([...enabledSkills, skill]))
        : enabledSkills.filter((item) => item !== skill),
    });
  };

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 rounded-lg border border-slate-200 p-3">
        <h3 className="text-sm font-semibold text-slate-800">
          {t("settings.agentToolsTitle")}
        </h3>
        <SettingsBooleanRow
          label={t("settings.agentTool.webSearch")}
          checked={Boolean(prefs.webSearchEnabled)}
          onCheckedChange={(value) => updateToolPref("webSearchEnabled", value)}
        />
        <SettingsBooleanRow
          label={t("settings.agentTool.workspaceRead")}
          checked={Boolean(prefs.workspaceReadEnabled)}
          onCheckedChange={(value) => updateToolPref("workspaceReadEnabled", value)}
        />
        <SettingsBooleanRow
          label={t("settings.agentTool.python")}
          checked={Boolean(prefs.pythonEnabled)}
          onCheckedChange={(value) => updateToolPref("pythonEnabled", value)}
        />
        <SettingsBooleanRow
          label={t("settings.agentTool.mcp")}
          checked={Boolean(prefs.mcpEnabled)}
          onCheckedChange={(value) => updateToolPref("mcpEnabled", value)}
        />
        <SettingsBooleanRow
          label={t("settings.agentTool.confirmWrites")}
          checked={Boolean(prefs.writeRequiresConfirmation)}
          onCheckedChange={(value) => updateToolPref("writeRequiresConfirmation", value)}
        />
      </div>
      <div className="grid gap-2 rounded-lg border border-slate-200 p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-800">
            {t("settings.mcpServersTitle")}
          </h3>
          <Button size="sm" variant="secondary" onClick={() => updateStitchServer({ enabled: true })}>
            {t("settings.mcpAddStitch")}
          </Button>
        </div>
        <SettingsBooleanRow
          label={t("settings.mcpStitchEnabled")}
          checked={stitchServer.enabled ?? true}
          onCheckedChange={(value) => updateStitchServer({ enabled: value })}
        />
        <Input
          value={stitchServer.command}
          onChange={(event) => updateStitchServer({ command: event.target.value })}
          placeholder={t("settings.mcpCommandPlaceholder")}
        />
        <Input
          value={(stitchServer.args ?? []).join(" ")}
          onChange={(event) => updateStitchServer({ args: event.target.value.split(/\s+/).filter(Boolean) })}
          placeholder={t("settings.mcpArgsPlaceholder")}
        />
      </div>
      <div className="grid gap-2 rounded-lg border border-slate-200 p-3">
        <h3 className="text-sm font-semibold text-slate-800">
          {t("settings.agentSkillsTitle")}
        </h3>
        <SettingsBooleanRow
          label={t("settings.skill.stitch")}
          checked={enabledSkills.includes("stitch")}
          onCheckedChange={(value) => toggleSkill("stitch", value)}
        />
      </div>
    </div>
  );
}
