import { ArrowLeft, Check, Pencil, Plus, RotateCcw } from "lucide-react";
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
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const editingTeam = useMemo(
    () => teams.find((team) => team.id === editingTeamId) ?? teams[0] ?? DEFAULT_AGENT_TEAM,
    [editingTeamId, teams],
  );
  const editingRole = useMemo(
    () => (editingTeam.roles ?? []).find((role) => role.id === editingRoleId) ?? null,
    [editingRoleId, editingTeam.roles],
  );

  useEffect(() => {
    if (editingTeamId && !teams.some((team) => team.id === editingTeamId)) {
      setEditingTeamId(null);
      setEditingRoleId(null);
    }
  }, [editingTeamId, teams]);

  useEffect(() => {
    if (editingRoleId && !(editingTeam.roles ?? []).some((role) => role.id === editingRoleId)) {
      setEditingRoleId(null);
    }
  }, [editingRoleId, editingTeam.roles]);

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
    setEditingRoleId(null);
  };

  const resetTeams = () => {
    const nextPrefs = normalizeAgentTeamPrefs(null);
    updatePrefs(nextPrefs);
    setEditingTeamId(null);
    setEditingRoleId(null);
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

      <div className="grid min-h-0 gap-3">
        <div className="grid content-start gap-2">
          {teams.map((team) => {
            const enabledRoles = (team.roles ?? []).filter((role) => role.enabled ?? true).length;
            const selected = team.id === editingTeamId;
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
                  <Button
                    size="sm"
                    variant={selected ? "surface" : "ghost"}
                    onClick={() => {
                      setEditingTeamId(team.id);
                      setEditingRoleId(null);
                    }}
                  >
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

        {editingTeamId ? (
          <div
            className="fixed inset-0 z-[430] flex items-center justify-center bg-slate-900/55 p-4 motion-overlay-enter"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setEditingTeamId(null);
                setEditingRoleId(null);
              }
            }}
          >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="agent-teams-editor-title"
            className="settings-scrollbar-hidden max-h-[min(760px,calc(100vh-40px))] w-[min(920px,calc(100vw-32px))] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-soft"
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 id="agent-teams-editor-title" className="text-sm font-semibold text-slate-900">{t("settings.agentTeamsEditorTitle")}</h3>
                <p className="text-xs text-slate-500">{t("settings.agentTeamsEditorHint")}</p>
              </div>
              <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditingTeamId(null);
                setEditingRoleId(null);
              }}
            >
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              {t("settings.agentTeamsCloseEditor")}
            </Button>
            <Button
              size="sm"
              variant={editingTeam.id === prefs.defaultTeamId ? "surface" : "secondary"}
              onClick={() => updatePrefs({ ...prefs, defaultTeamId: editingTeam.id })}
            >
              <Check className="mr-1.5 h-3.5 w-3.5" />
              {t("settings.agentTeamsSetDefault")}
            </Button>
            </div>

          {editingRole ? (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white p-2">
                <Button size="sm" variant="ghost" onClick={() => setEditingRoleId(null)}>
                  <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                  {t("settings.agentTeamsBackToTeam")}
                </Button>
                <div className="min-w-0 text-right">
                  <div className="text-xs font-semibold text-slate-800">{t("settings.agentTeamsRoleConfigTitle")}</div>
                  <div className="truncate text-[11px] text-slate-500">{editingRole.name}</div>
                </div>
              </div>

              <div className="grid gap-2 lg:grid-cols-[minmax(140px,0.8fr)_minmax(120px,0.55fr)_minmax(180px,1fr)_auto]">
                <Input value={editingRole.name} onChange={(event) => updateEditingRole(editingRole.id, { name: event.target.value })} />
                <Select
                  value={editingRole.phase ?? "research"}
                  portalClassName="settings-scrollbar-hidden"
                  onChange={(event) => updateEditingRole(editingRole.id, { phase: event.target.value as AgentTeamRolePrefs["phase"] })}
                >
                  {ROLE_PHASES.map((phase) => (
                    <option key={phase} value={phase}>{t(`settings.agentTeamRole.phase.${phase}`)}</option>
                  ))}
                </Select>
                <Select
                  value={editingRole.modelId ?? ""}
                  portalClassName="settings-scrollbar-hidden"
                  onChange={(event) => updateEditingRole(editingRole.id, { modelId: event.target.value })}
                >
                  <option value="">{t("settings.noModelAssigned")}</option>
                  {activeModelCatalog.map((model) => (
                    <option key={model.id} value={model.id}>{model.displayName}</option>
                  ))}
                </Select>
                <label className="inline-flex items-center justify-end gap-1 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={editingRole.enabled ?? true}
                    onChange={(event) => updateEditingRole(editingRole.id, { enabled: event.target.checked })}
                  />
                  {t("settings.agentTeamRole.enabled")}
                </label>
              </div>

              <textarea
                value={editingRole.identityPrompt ?? ""}
                onChange={(event) => updateEditingRole(editingRole.id, { identityPrompt: event.target.value })}
                className="settings-scrollbar-hidden h-28 w-full resize-none overflow-auto rounded border border-slate-300 bg-white px-2 py-1.5 text-xs leading-5 text-slate-700 outline-none focus:border-[var(--app-accent)]"
                placeholder={t("settings.agentTeamRole.promptPlaceholder")}
              />

              <div className="grid gap-2 md:grid-cols-[minmax(160px,1fr)_80px]">
                <label className="grid gap-1 text-[11px] text-slate-600">
                  <span>{t("settings.agentTeamRole.description")}</span>
                  <Input
                    value={editingRole.description ?? ""}
                    onChange={(event) => updateEditingRole(editingRole.id, { description: event.target.value })}
                    className="h-8 text-xs"
                  />
                </label>
                <label className="grid gap-1 text-[11px] text-slate-600">
                  <span>{t("settings.agentTeamRole.color")}</span>
                  <input
                    type="color"
                    value={editingRole.color ?? "#64748b"}
                    className="h-8 w-16 rounded border border-slate-300 bg-white p-1"
                    onChange={(event) => updateEditingRole(editingRole.id, { color: event.target.value })}
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white p-2">
                <label className="inline-flex items-center gap-1 text-[11px] text-slate-600">
                  <input
                    type="checkbox"
                    checked={editingRole.canWrite ?? false}
                    onChange={(event) => updateEditingRole(editingRole.id, { canWrite: event.target.checked })}
                  />
                  {t("settings.agentTeamRole.canWrite")}
                </label>
                {TOOL_CHOICES.map((tool) => (
                  <label key={tool} className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600">
                    <input
                      type="checkbox"
                      checked={(editingRole.toolAccess ?? []).includes(tool)}
                      onChange={(event) => updateEditingRole(editingRole.id, {
                        toolAccess: toggleValue(editingRole.toolAccess, tool, event.target.checked),
                      })}
                    />
                    {t(`settings.agentTeamTool.${tool}`)}
                  </label>
                ))}
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                <label className="grid gap-1 text-[11px] text-slate-600">
                  <span>{t("settings.agentTeamRole.mcpServers")}</span>
                  <Input
                    value={joinCsv(editingRole.mcpServerIds)}
                    onChange={(event) => updateEditingRole(editingRole.id, { mcpServerIds: splitCsv(event.target.value) })}
                    className="h-8 text-xs"
                  />
                </label>
                <label className="grid gap-1 text-[11px] text-slate-600">
                  <span>{t("settings.agentTeamRole.skills")}</span>
                  <Input
                    value={joinCsv(editingRole.skillIds)}
                    onChange={(event) => updateEditingRole(editingRole.id, { skillIds: splitCsv(event.target.value) })}
                    className="h-8 text-xs"
                  />
                </label>
              </div>
            </div>
          ) : (
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
              <div>
                <h4 className="text-xs font-semibold text-slate-700">{t("settings.agentTeamsRolesTitle")}</h4>
                <p className="text-[11px] text-slate-500">{t("settings.agentTeamsRoleTagsHint")}</p>
              </div>
              {(editingTeam.roles ?? []).map((role) => (
                <button
                  key={role.id}
                  type="button"
                  className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white p-3 text-left transition hover:border-[var(--app-accent)]"
                  onClick={() => setEditingRoleId(role.id)}
                >
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: role.color ?? "#64748b" }} />
                    <span className="truncate text-sm font-semibold text-slate-800">{role.name}</span>
                    <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-600">
                      {t(`settings.agentTeamRole.phase.${role.phase ?? "research"}`)}
                    </span>
                    {(role.toolAccess ?? []).map((tool) => (
                      <span key={tool} className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-500">
                        {t(`settings.agentTeamTool.${tool}`)}
                      </span>
                    ))}
                  </span>
                  <span className="text-[11px] text-slate-500">{t("settings.agentTeamsOpenRole")}</span>
                </button>
              ))}
            </div>
            </div>
          )}
          </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}
