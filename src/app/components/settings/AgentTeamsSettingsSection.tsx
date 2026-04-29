import type { Dispatch, SetStateAction } from "react";
import { Plus, RotateCcw } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Select } from "../../../components/ui/select";
import { cn } from "../../../lib/utils";
import type { AgentTeamConfig, AgentTeamRolePrefs, AppSettings, ModelCatalogItem } from "../../../shared/types/app";
import { DEFAULT_AGENT_TEAM, normalizeAgentTeamPrefs } from "../../settings/agentTeamDefaults";
import { SettingsBooleanRow } from "./SettingsBooleanRow";

type TranslationFn = (key: any) => string;

const ROLE_PHASES = ["plan", "research", "edit", "review", "final"] as const;
const TOOL_CHOICES = ["workspace", "web", "python", "mcp"] as const;
const CALLSITE_CHOICES = ["latex.overlay", "analysis.workspace", "chat.workspace"] as const;

function updateRole(team: AgentTeamConfig, roleId: string, patch: Partial<AgentTeamRolePrefs>): AgentTeamConfig {
  return {
    ...team,
    roles: (team.roles ?? []).map((role) => role.id === roleId ? { ...role, ...patch } : role),
  };
}

export function AgentTeamsSettingsSection(props: {
  settings: AppSettings;
  activeModelCatalog: ModelCatalogItem[];
  setSettings: Dispatch<SetStateAction<AppSettings | null>>;
  t: TranslationFn;
}) {
  const { settings, activeModelCatalog, setSettings, t } = props;
  const prefs = normalizeAgentTeamPrefs(settings.uiPrefs?.agentTeamPrefs);
  const activeTeam = prefs.teams?.find((team) => team.id === prefs.defaultTeamId) ?? prefs.teams?.[0] ?? DEFAULT_AGENT_TEAM;

  const updatePrefs = (nextPrefs: typeof prefs) => {
    setSettings((prev) => {
      const base = prev ?? settings;
      return { ...base, uiPrefs: { ...(base.uiPrefs ?? {}), agentTeamPrefs: nextPrefs } };
    });
  };
  const updateActiveTeam = (patch: Partial<AgentTeamConfig>) => {
    const nextTeam = { ...activeTeam, ...patch };
    updatePrefs({
      ...prefs,
      defaultTeamId: nextTeam.id,
      teams: (prefs.teams ?? []).map((team) => team.id === activeTeam.id ? nextTeam : team),
    });
  };
  const updateActiveRole = (roleId: string, patch: Partial<AgentTeamRolePrefs>) => {
    updateActiveTeam(updateRole(activeTeam, roleId, patch));
  };
  const toggleValue = (values: string[] | undefined, value: string, enabled: boolean) => {
    const set = new Set(values ?? []);
    if (enabled) {
      set.add(value);
    } else {
      set.delete(value);
    }
    return Array.from(set);
  };

  return (
    <div className="grid gap-3">
      <p className="text-xs text-slate-500">{t("settings.agentTeamsHint")}</p>
      <SettingsBooleanRow
        label={t("settings.agentTeamsEnabled")}
        checked={prefs.enabled ?? true}
        onCheckedChange={(enabled) => updatePrefs({ ...prefs, enabled })}
      />
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t("settings.agentTeamsDefaultTeam")}
            </div>
            <Input
              value={activeTeam.name}
              onChange={(event) => updateActiveTeam({ name: event.target.value })}
              className="mt-1"
            />
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => updatePrefs(normalizeAgentTeamPrefs(null))}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            {t("settings.agentTeamsReset")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const id = `team-${Date.now().toString(36)}`;
              const team = { ...DEFAULT_AGENT_TEAM, id, name: t("settings.agentTeamsNewTeam") };
              updatePrefs({ ...prefs, defaultTeamId: id, teams: [...(prefs.teams ?? []), team] });
            }}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t("settings.agentTeamsAdd")}
          </Button>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]">
          <Select
            value={activeTeam.id}
            onChange={(event) => updatePrefs({ ...prefs, defaultTeamId: event.target.value })}
          >
            {(prefs.teams ?? []).map((team) => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </Select>
          <Input
            type="number"
            min={1}
            max={4}
            value={activeTeam.parallelism ?? 2}
            onChange={(event) => updateActiveTeam({ parallelism: Number(event.target.value) })}
            title={t("settings.agentTeamsParallelism")}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {CALLSITE_CHOICES.map((callsite) => (
            <label key={callsite} className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600">
              <input
                type="checkbox"
                checked={(activeTeam.callsites ?? []).includes(callsite)}
                onChange={(event) => updateActiveTeam({
                  callsites: toggleValue(activeTeam.callsites, callsite, event.target.checked),
                })}
              />
              {callsite}
            </label>
          ))}
        </div>
      </div>
      <div className="grid gap-2">
        {(activeTeam.roles ?? []).map((role) => (
          <article key={role.id} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="grid gap-2 md:grid-cols-[minmax(120px,0.8fr)_minmax(120px,0.7fr)_minmax(140px,0.8fr)_auto]">
              <Input value={role.name} onChange={(event) => updateActiveRole(role.id, { name: event.target.value })} />
              <Select
                value={role.phase ?? "research"}
                onChange={(event) => updateActiveRole(role.id, { phase: event.target.value as AgentTeamRolePrefs["phase"] })}
              >
                {ROLE_PHASES.map((phase) => (
                  <option key={phase} value={phase}>{t(`settings.agentTeamRole.phase.${phase}`)}</option>
                ))}
              </Select>
              <Select
                value={role.modelId ?? ""}
                onChange={(event) => updateActiveRole(role.id, { modelId: event.target.value })}
              >
                <option value="">{t("settings.noModelAssigned")}</option>
                {activeModelCatalog.map((model) => (
                  <option key={model.id} value={model.id}>{model.displayName}</option>
                ))}
              </Select>
              <label className="inline-flex items-center justify-end gap-1 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={role.enabled ?? true}
                  onChange={(event) => updateActiveRole(role.id, { enabled: event.target.checked })}
                />
                {t("settings.agentTeamRole.enabled")}
              </label>
            </div>
            <textarea
              value={role.identityPrompt ?? ""}
              onChange={(event) => updateActiveRole(role.id, { identityPrompt: event.target.value })}
              className="mt-2 min-h-16 w-full resize-y rounded border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-[var(--app-accent)]"
              placeholder={t("settings.agentTeamRole.promptPlaceholder")}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold text-white")} style={{ backgroundColor: role.color ?? "#64748b" }}>
                {role.id}
              </span>
              <label className="inline-flex items-center gap-1 text-[11px] text-slate-600">
                <input
                  type="checkbox"
                  checked={role.canWrite ?? false}
                  onChange={(event) => updateActiveRole(role.id, { canWrite: event.target.checked })}
                />
                {t("settings.agentTeamRole.canWrite")}
              </label>
              {TOOL_CHOICES.map((tool) => (
                <label key={tool} className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600">
                  <input
                    type="checkbox"
                    checked={(role.toolAccess ?? []).includes(tool)}
                    onChange={(event) => updateActiveRole(role.id, {
                      toolAccess: toggleValue(role.toolAccess, tool, event.target.checked),
                    })}
                  />
                  {t(`settings.agentTeamTool.${tool}`)}
                </label>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
