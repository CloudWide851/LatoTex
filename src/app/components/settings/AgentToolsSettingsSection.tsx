import { AlertCircle, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { useState, type Dispatch, type SetStateAction } from "react";
import type { AgentToolPrefs, AppSettings, McpServerConfig, McpValidationResult } from "../../../shared/types/app";
import { validateMcpServer } from "../../../shared/api/settings";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { cn } from "../../../lib/utils";
import { SettingsBooleanRow } from "./SettingsBooleanRow";

type TranslationFn = (key: any) => string;

const STITCH_SERVER: McpServerConfig = {
  id: "stitch",
  command: "pnpm",
  args: ["exec", "stitch-mcp", "proxy"],
  env: { STITCH_USE_SYSTEM_GCLOUD: "1" },
  enabled: true,
};

const BUILT_IN_SKILLS = ["stitch", "frontend-design", "optimize", "polish"] as const;

function parseArgs(value: string): string[] {
  return value.split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

function parseEnv(value: string): Record<string, string> {
  return Object.fromEntries(
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf("=");
        return index < 0
          ? [line, ""]
          : [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      })
      .filter(([key]) => key.length > 0),
  );
}

function formatEnv(env: Record<string, string> | undefined): string {
  return Object.entries(env ?? {}).map(([key, value]) => `${key}=${value}`).join("\n");
}

function createMcpServer(existing: McpServerConfig[]): McpServerConfig {
  let index = existing.length + 1;
  let id = `mcp-${index}`;
  const ids = new Set(existing.map((server) => server.id));
  while (ids.has(id)) {
    index += 1;
    id = `mcp-${index}`;
  }
  return { id, command: "", args: [], env: {}, enabled: true };
}

function statusTone(result: McpValidationResult | { ok: boolean; message: string } | undefined) {
  if (!result) {
    return "border-slate-200 bg-slate-50 text-slate-500";
  }
  return result.ok
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-rose-200 bg-rose-50 text-rose-700";
}

function formatMcpValidationMessage(result: McpValidationResult, t: TranslationFn): string {
  if (result.message.startsWith("mcp.validation.tools:")) {
    return t("settings.mcpValidateTools").replace("{count}", result.message.split(":")[1] ?? "0");
  }
  if (result.message === "mcp.validation.connected") {
    return t("settings.mcpValidateOk");
  }
  if (result.message === "mcp.validation.id_missing") {
    return t("settings.mcpValidateIdMissing");
  }
  if (result.message === "mcp.validation.command_missing") {
    return t("settings.mcpValidateCommandMissing");
  }
  return result.message;
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
    </div>
  );
}

export function McpSettingsSection(props: {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings | null>>;
  t: TranslationFn;
}) {
  const { settings, setSettings, t } = props;
  const servers = settings.uiPrefs?.mcpServers ?? [];
  const [validationById, setValidationById] = useState<Record<string, McpValidationResult | undefined>>({});
  const [validatingId, setValidatingId] = useState<string | null>(null);

  const updateUiPrefs = (patch: Partial<NonNullable<AppSettings["uiPrefs"]>>) => {
    setSettings((prev) => {
      const base = prev ?? settings;
      return { ...base, uiPrefs: { ...(base.uiPrefs ?? {}), ...patch } };
    });
  };
  const updateServers = (nextServers: McpServerConfig[]) => updateUiPrefs({ mcpServers: nextServers });
  const updateServer = (id: string, patch: Partial<McpServerConfig>) => {
    updateServers(servers.map((server) => (server.id === id ? { ...server, ...patch } : server)));
  };
  const addServer = (server: McpServerConfig) => {
    if (servers.some((item) => item.id === server.id)) {
      return;
    }
    updateServers([...servers, server]);
  };
  const validateServer = async (server: McpServerConfig) => {
    setValidatingId(server.id);
    try {
      const result = await validateMcpServer(server);
      setValidationById((prev) => ({ ...prev, [server.id]: result }));
    } catch (error) {
      setValidationById((prev) => ({
        ...prev,
        [server.id]: { ok: false, message: String(error), tools: [] },
      }));
    } finally {
      setValidatingId(null);
    }
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">{t("settings.mcpServersHint")}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => addServer(STITCH_SERVER)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t("settings.mcpAddStitch")}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => addServer(createMcpServer(servers))}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t("settings.mcpAddCustom")}
          </Button>
        </div>
      </div>

      {servers.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-xs text-slate-500">
          {t("settings.mcpEmpty")}
        </div>
      ) : servers.map((server) => {
        const validation = validationById[server.id];
        return (
          <section key={server.id} className="grid gap-2 rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={server.enabled ?? true}
                  onChange={(event) => updateServer(server.id, { enabled: event.target.checked })}
                />
                {server.id || t("settings.mcpUnnamed")}
              </label>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={validatingId === server.id} onClick={() => void validateServer(server)}>
                  {validatingId === server.id ? t("common.loading") : t("settings.mcpValidate")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => updateServers(servers.filter((item) => item.id !== server.id))}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-[minmax(120px,0.5fr)_minmax(160px,1fr)_minmax(160px,1fr)]">
              <Input value={server.id} onChange={(event) => updateServer(server.id, { id: event.target.value.trim() })} placeholder={t("settings.mcpIdPlaceholder")} className="h-8 text-xs" />
              <Input value={server.command} onChange={(event) => updateServer(server.id, { command: event.target.value })} placeholder={t("settings.mcpCommandPlaceholder")} className="h-8 text-xs" />
              <Input value={(server.args ?? []).join(" ")} onChange={(event) => updateServer(server.id, { args: parseArgs(event.target.value) })} placeholder={t("settings.mcpArgsPlaceholder")} className="h-8 text-xs" />
            </div>
            <textarea
              value={formatEnv(server.env)}
              onChange={(event) => updateServer(server.id, { env: parseEnv(event.target.value) })}
              placeholder={t("settings.mcpEnvPlaceholder")}
              className="settings-scrollbar-hidden min-h-16 resize-none rounded border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-[11px] leading-5 text-slate-700 outline-none focus:border-[var(--app-accent)]"
            />
            {validation ? (
              <div className={cn("flex items-start gap-2 rounded border px-2 py-1.5 text-[11px]", statusTone(validation))}>
                {validation.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                <span>
                  {formatMcpValidationMessage(validation, t)}
                  {validation.tools.length > 0 ? ` (${validation.tools.join(", ")})` : ""}
                </span>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

export function SkillsSettingsSection(props: {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings | null>>;
  t: TranslationFn;
}) {
  const { settings, setSettings, t } = props;
  const enabledSkills = settings.uiPrefs?.enabledSkills ?? [];
  const [customSkill, setCustomSkill] = useState("");
  const [validationBySkill, setValidationBySkill] = useState<Record<string, { ok: boolean; message: string }>>({});

  const updateUiPrefs = (patch: Partial<NonNullable<AppSettings["uiPrefs"]>>) => {
    setSettings((prev) => {
      const base = prev ?? settings;
      return { ...base, uiPrefs: { ...(base.uiPrefs ?? {}), ...patch } };
    });
  };
  const setSkills = (skills: string[]) => updateUiPrefs({ enabledSkills: Array.from(new Set(skills.map((item) => item.trim()).filter(Boolean))) });
  const toggleSkill = (skill: string, enabled: boolean) => {
    setSkills(enabled ? [...enabledSkills, skill] : enabledSkills.filter((item) => item !== skill));
  };
  const addCustomSkill = () => {
    const skill = customSkill.trim();
    if (!skill) {
      return;
    }
    setSkills([...enabledSkills, skill]);
    setCustomSkill("");
  };
  const validateSkill = (skill: string) => {
    const normalized = skill.trim();
    const ok = normalized.length > 0 && !/\s/.test(normalized);
    setValidationBySkill((prev) => ({
      ...prev,
      [skill]: {
        ok,
        message: ok ? t("settings.skillValidateOk") : t("settings.skillValidateInvalid"),
      },
    }));
  };
  const visibleSkills = Array.from(new Set([...BUILT_IN_SKILLS, ...enabledSkills]));

  return (
    <div className="grid gap-3">
      <p className="text-xs text-slate-500">{t("settings.agentSkillsHint")}</p>
      <div className="flex gap-2">
        <Input value={customSkill} onChange={(event) => setCustomSkill(event.target.value)} placeholder={t("settings.skillAddPlaceholder")} className="h-9 text-xs" />
        <Button size="sm" variant="secondary" onClick={addCustomSkill}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {t("settings.skillAdd")}
        </Button>
      </div>
      <div className="grid gap-2">
        {visibleSkills.map((skill) => {
          const validation = validationBySkill[skill];
          return (
            <div key={skill} className="rounded-md border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={enabledSkills.includes(skill)}
                    onChange={(event) => toggleSkill(skill, event.target.checked)}
                  />
                  {t(`settings.skill.${skill}`) === `settings.skill.${skill}` ? skill : t(`settings.skill.${skill}`)}
                </label>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => validateSkill(skill)}>
                    {t("settings.skillValidate")}
                  </Button>
                  {!BUILT_IN_SKILLS.includes(skill as typeof BUILT_IN_SKILLS[number]) ? (
                    <Button size="sm" variant="ghost" onClick={() => setSkills(enabledSkills.filter((item) => item !== skill))}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </div>
              </div>
              {validation ? (
                <div className={cn("mt-2 rounded border px-2 py-1 text-[11px]", statusTone(validation))}>
                  {validation.message}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
