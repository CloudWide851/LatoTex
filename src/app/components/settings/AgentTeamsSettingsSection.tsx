import { Check, Pencil, Plus, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
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

function createTeamId() {
  return `team-${Date.now().toString(36)}`;
}

function cloneDefaultTeam(name: string): AgentTeamConfig {
  const id = createTeamId();
  return {
    ...DEFAULT_AGENT_TEAM,
    id,
    name,
    roles: (DEFAULT_AGENT_TEAM.roles ?? []).map((role) => ({ ...role })),
  };
}

function splitCsv(value: string | undefined) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinCsv(values: string[] | undefined) {
  return (values ?? []).join(", ");
}

function toggleValue(values: string[] | undefined, value: string, enabled: boolean) {
  const set = new Set(values ?? []);
  if (enabled) {
    set.add(value);
  } else {
    set.delete(value);
  }
  return Array.from(set);
}

function updateRole(team: AgentTeamConfig, roleId: string, patch: Partial<AgentTeamRolePrefs>) {
  return {
    ...team,
    roles: (team.roles ?? []).map((role) => (role.id === roleId ? { ...role, ...patch } : role)),
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
  const teams = prefs.teams ?? [];
  const initialEditId = prefs.defaultTeamId ?? teams[0]?.id ?? DEFAULT_AGENT_TEAM.id;
  const [editingTeamId, setEditingTeamId] = useState(initialEditId);
  const editingTeam = useMemo(
    () => teams.find((team) => team.id === editingTeamId) ?? teams[0] ?? DEFAULT_AGENT_TEAM,
    [editingTeamId, teams],
  );

  useEffect(() => {
    if (!teams.some((team) => team.id === editingTeamId)) {
      setEditingTeamId(prefs.defaultTeamId ?? teams[0]?.id ?? DEFAULT_AGENT_TEAM.id);
    }
  }, [editingTeamId, prefs.defaultTeamId, teams]);

  const updatePrefs = (nextPrefs: typeof prefs) => {
    setSettings((prev) => {
      const base = prev ?? settings;
      return { ...base, uiPrefs: { ...(base.uiPrefs ?? {}), agentTeamPrefs: nextPrefs } };
    });
  };

  const updateTeam = (teamId: string, patch: Partial<AgentTeamConfig>) => {
    updatePrefs({
      ...prefs,
      teams: teams.map((team) => (team.id === teamId ? { ...team, ...patch } : team)),
    });
  };

  const updateEditingTeam = (patch: Partial<AgentTeamConfig>) => updateTeam(editingTeam.id, patch);
  const updateEditingRole = (roleId: string, patch: Partial<AgentTeamRolePrefs>) => {
    updateEditingTeam(updateRole(editingTeam, roleId, patch));
  };

  const addTeam = () => {
    const team = cloneDefaultTeam(t("settings.agentTeamsNewTeam"));
    updatePrefs({
      ...prefs,
      defaultTeamId: team.id,
      teams: [...teams, team],
    });
    setEditingTeamId(team.id);
  };

  const resetTeams = () => {
    const nextPrefs = normalizeAgentTeamPrefs(null);
    updatePrefs(nextPrefs);
    setEditingTeamId(nextPrefs.defaultTeamId ?? DEFAULT_AGENT_TEAM.id);
  };

  return (
    <div className="grid min-h-0 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-slate-500">{t("settings.agentTeamsHint")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={resetTeams}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            {t("settings.agentTeamsReset")}
          </Button>
          <Button size="sm" variant="secondary" onClick={addTeam}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t("settings.agentTeamsAdd")}
          </Button>
        </div>
      </div>

      <SettingsBooleanRow
        label={t("settings.agentTeamsEnabled")}
        checked={prefs.enabled ?? true}
        onCheckedChange={(enabled) => updatePrefs({ ...prefs, enabled })}
      />

      <div className="grid min-h-0 gap-3 xl:grid-cols-[minmax(260px,0.78fr)_minmax(360px,1.22fr)]">
        <div className="grid content-start gap-2">
          {teams.map((team) => {
            const enabledRoles = (team.roles ?? []).filter((role) => role.enabled ?? true).length;
            const selected = team.id === editingTeam.id;
            const isDefault = team.id === prefs.defaultTeamId;
            return (
              <article
                key={team.id}
                className={cn(
                  "rounded-md border bg-white p-3 text-xs transition",
                  selected ? "border-[var(--app-accent)] shadow-sm" : "border-slate-200 hover:border-slate-300",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-900">{team.name}</span>
                      {isDefault ? (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                          {t("settings.agentTeamsDefaultBadge")}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-slate-500">
                      {t("settings.agentTeamsSummary")
                        .replace("{roles}", String(enabledRoles))
                        .replace("{parallelism}", String(team.parallelism ?? 2))}
                    </div>
                  </div>
                  <Button size="sm" variant={selected ? "surface" : "ghost"} onClick={() => setEditingTeamId(team.id)}>
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                    {t("settings.agentTeamsEdit")}
                  </Button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(team.callsites ?? []).map((callsite) => (
                    <span key={callsite} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-600">
                      {t(`settings.agentTeamCallsite.${callsite}`)}
                    </span>
                  ))}
                </div>
              </article>
            );
          })}
        </div>

        <section className="min-h-0 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">{t("settings.agentTeamsEditorTitle")}</h3>
              <p className="text-xs text-slate-500">{t("settings.agentTeamsEditorHint")}</p>
            </div>
            <Button
              size="sm"
              variant={editingTeam.id === prefs.defaultTeamId ? "surface" : "secondary"}
              onClick={() => updatePrefs({ ...prefs, defaultTeamId: editingTeam.id })}
            >
              <Check className="mr-1.5 h-3.5 w-3.5" />
              {t("settings.agentTeamsSetDefault")}
            </Button>
          </div>

          <div className="grid gap-3">
            <div className="grid gap-2 md:grid-cols-[minmax(180px,1fr)_120px_120px]">
              <label className="grid gap-1 text-xs text-slate-600">
                <span>{t("settings.agentTeamsName")}</span>
                <Input value={editingTeam.name} onChange={(event) => updateEditingTeam({ name: event.target.value })} />
              </label>
              <label className="grid gap-1 text-xs text-slate-600">
                <span>{t("settings.agentTeamsParallelism")}</span>
                <Input
                  type="number"
                  min={1}
                  max={4}
                  value={editingTeam.parallelism ?? 2}
                  onChange={(event) => updateEditingTeam({ parallelism: Number(event.target.value) })}
                />
              </label>
              <label className="flex items-end gap-2 pb-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={editingTeam.enabled ?? true}
                  onChange={(event) => updateEditingTeam({ enabled: event.target.checked })}
                />
                {t("settings.agentTeamsTeamEnabled")}
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              {CALLSITE_CHOICES.map((callsite) => (
                <label key={callsite} className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600">
                  <input
                    type="checkbox"
                    checked={(editingTeam.callsites ?? []).includes(callsite)}
                    onChange={(event) => updateEditingTeam({
                      callsites: toggleValue(editingTeam.callsites, callsite, event.target.checked),
                    })}
                  />
                  {t(`settings.agentTeamCallsite.${callsite}`)}
                </label>
              ))}
            </div>

            <div className="grid gap-2">
              {(editingTeam.roles ?? []).map((role) => (
                <article key={role.id} className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="grid gap-2 lg:grid-cols-[minmax(120px,0.7fr)_minmax(110px,0.55fr)_minmax(150px,0.85fr)_auto]">
                    <Input value={role.name} onChange={(event) => updateEditingRole(role.id, { name: event.target.value })} />
                    <Select
                      value={role.phase ?? "research"}
                      onChange={(event) => updateEditingRole(role.id, { phase: event.target.value as AgentTeamRolePrefs["phase"] })}
                    >
                      {ROLE_PHASES.map((phase) => (
                        <option key={phase} value={phase}>{t(`settings.agentTeamRole.phase.${phase}`)}</option>
                      ))}
                    </Select>
                    <Select
                      value={role.modelId ?? ""}
                      onChange={(event) => updateEditingRole(role.id, { modelId: event.target.value })}
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
                        onChange={(event) => updateEditingRole(role.id, { enabled: event.target.checked })}
                      />
                      {t("settings.agentTeamRole.enabled")}
                    </label>
                  </div>

                  <textarea
                    value={role.identityPrompt ?? ""}
                    onChange={(event) => updateEditingRole(role.id, { identityPrompt: event.target.value })}
                    className="library-scrollbar mt-2 h-24 w-full resize-none overflow-auto rounded border border-slate-300 bg-white px-2 py-1.5 text-xs leading-5 text-slate-700 outline-none focus:border-[var(--app-accent)]"
                    placeholder={t("settings.agentTeamRole.promptPlaceholder")}
                  />

                  <div className="mt-2 grid gap-2 md:grid-cols-[minmax(160px,1fr)_minmax(160px,1fr)]">
                    <label className="grid gap-1 text-[11px] text-slate-600">
                      <span>{t("settings.agentTeamRole.description")}</span>
                      <Input
                        value={role.description ?? ""}
                        onChange={(event) => updateEditingRole(role.id, { description: event.target.value })}
                        className="h-8 text-xs"
                      />
                    </label>
                    <label className="grid gap-1 text-[11px] text-slate-600">
                      <span>{t("settings.agentTeamRole.color")}</span>
                      <input
                        type="color"
                        value={role.color ?? "#64748b"}
                        className="h-8 w-16 rounded border border-slate-300 bg-white p-1"
                        onChange={(event) => updateEditingRole(role.id, { color: event.target.value })}
                      />
                    </label>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-1 text-[11px] text-slate-600">
                      <input
                        type="checkbox"
                        checked={role.canWrite ?? false}
                        onChange={(event) => updateEditingRole(role.id, { canWrite: event.target.checked })}
                      />
                      {t("settings.agentTeamRole.canWrite")}
                    </label>
                    {TOOL_CHOICES.map((tool) => (
                      <label key={tool} className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600">
                        <input
                          type="checkbox"
                          checked={(role.toolAccess ?? []).includes(tool)}
                          onChange={(event) => updateEditingRole(role.id, {
                            toolAccess: toggleValue(role.toolAccess, tool, event.target.checked),
                          })}
                        />
                        {t(`settings.agentTeamTool.${tool}`)}
                      </label>
                    ))}
                  </div>

                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    <label className="grid gap-1 text-[11px] text-slate-600">
                      <span>{t("settings.agentTeamRole.mcpServers")}</span>
                      <Input
                        value={joinCsv(role.mcpServerIds)}
                        onChange={(event) => updateEditingRole(role.id, { mcpServerIds: splitCsv(event.target.value) })}
                        className="h-8 text-xs"
                      />
                    </label>
                    <label className="grid gap-1 text-[11px] text-slate-600">
                      <span>{t("settings.agentTeamRole.skills")}</span>
                      <Input
                        value={joinCsv(role.skillIds)}
                        onChange={(event) => updateEditingRole(role.id, { skillIds: splitCsv(event.target.value) })}
                        className="h-8 text-xs"
                      />
                    </label>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
