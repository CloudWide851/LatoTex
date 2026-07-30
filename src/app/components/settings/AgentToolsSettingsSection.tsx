import { AlertCircle, BookOpenCheck, CheckCircle2, Plus, Puzzle, Trash2 } from "lucide-react";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { AppSettings, McpServerConfig, McpValidationResult, ResearchSkillDescriptor, SkillValidationResult, SwarmEvent } from "../../../shared/types/app";
import { executeWorkflowStart, getEvents } from "../../../shared/api/agent";
import { getPluginCatalog, listInstalledPlugins } from "../../../shared/api/plugins";
import { getAgentSkillCatalog, validateAgentSkill, validateMcpServer } from "../../../shared/api/settings";
import type { PluginManifest } from "../../../shared/plugins/pluginTypes";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { cn } from "../../../lib/utils";
import { AgentTraceCards } from "../agent/AgentTraceCards";
import { extractEventCards } from "../../hooks/analysisWorkspaceHelpers";

export { AgentToolsSettingsSection } from "./AgentToolAccessSettingsSection";

type TranslationFn = (key: any) => string;

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

function formatSkillValidationMessage(result: SkillValidationResult, t: TranslationFn): string {
  if (result.message === "skill.validation.builtIn") {
    return t("settings.skillValidateBuiltIn");
  }
  if (result.message === "skill.validation.configured") {
    return t("settings.skillValidateConfigured");
  }
  if (result.message === "skill.validation.custom") {
    return t("settings.skillValidateCustom");
  }
  if (result.message === "skill.validation.invalid_id") {
    return t("settings.skillValidateInvalid");
  }
  if (result.message === "skill.validation.invalid_manifest") {
    return t("settings.skillValidateManifestInvalid");
  }
  if (result.message === "skill.validation.manifest_missing") {
    return t("settings.skillValidateManifestMissing");
  }
  return result.message;
}

function formatSkillValidationDetail(detail: string, t: TranslationFn): string {
  const key = `settings.${detail.replace(/\./g, "_")}`;
  const translated = t(key);
  return translated === key ? detail : translated;
}

export function McpSettingsSection(props: {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings | null>>;
  t: TranslationFn;
}) {
  const { settings, setSettings, t } = props;
  const servers = settings.uiPrefs?.mcpServers ?? [];
  const [installablePlugins, setInstallablePlugins] = useState<PluginManifest[]>([]);
  const [validationByKey, setValidationByKey] = useState<Record<string, McpValidationResult | undefined>>({});
  const [validatingKey, setValidatingKey] = useState<string | null>(null);
  const [installingMcp, setInstallingMcp] = useState(false);

  const updateUiPrefs = (patch: Partial<NonNullable<AppSettings["uiPrefs"]>>) => {
    setSettings((prev) => {
      const base = prev ?? settings;
      return { ...base, uiPrefs: { ...(base.uiPrefs ?? {}), ...patch } };
    });
  };
  const updateServers = (nextServers: McpServerConfig[]) => updateUiPrefs({ mcpServers: nextServers });
  const serverKey = (index: number) => `mcp-row-${index}`;
  const updateServer = (index: number, patch: Partial<McpServerConfig>) => {
    updateServers(servers.map((server, itemIndex) => (itemIndex === index ? { ...server, ...patch } : server)));
  };
  const addServer = (server: McpServerConfig) => {
    if (servers.some((item) => item.id === server.id)) {
      return;
    }
    updateServers([...servers, server]);
  };
  const loadInstallableMcp = async () => {
    setInstallingMcp(true);
    try {
      const [installed, catalog] = await Promise.all([
        listInstalledPlugins().catch(() => []),
        getPluginCatalog(settings.uiPrefs?.pluginCatalogSources ?? []).catch(() => ({ items: [], warnings: [], schema: "latotex.marketplace.v1" })),
      ]);
      const installedIds = new Set(installed.filter((item) => item.enabled).map((item) => item.manifest.id));
      const candidates = [
        ...installed.filter((item) => item.enabled).map((item) => item.manifest),
        ...catalog.items.map((item) => item.manifest).filter((item) => !installedIds.has(item.id)),
      ].filter((item) => item.contributions.some((contribution) => contribution.kind === "mcpServer" && contribution.mcpServer));
      setInstallablePlugins(candidates);
    } finally {
      setInstallingMcp(false);
    }
  };
  const installMcpTemplate = (manifest: PluginManifest, contributionId: string) => {
    const contribution = manifest.contributions.find((item) => item.id === contributionId);
    const template = contribution?.mcpServer;
    if (!template) {
      return;
    }
    addServer({
      id: template.id,
      command: template.command,
      args: template.args ?? [],
      env: template.env ?? {},
      enabled: true,
    });
  };
  const validateServer = async (server: McpServerConfig, key: string) => {
    setValidatingKey(key);
    try {
      const result = await validateMcpServer(server);
      setValidationByKey((prev) => ({ ...prev, [key]: result }));
    } catch (error) {
      setValidationByKey((prev) => ({
        ...prev,
        [key]: { ok: false, message: String(error), tools: [] },
      }));
    } finally {
      setValidatingKey(null);
    }
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">{t("settings.mcpServersHint")}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={installingMcp} onClick={() => void loadInstallableMcp()}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {installingMcp ? t("common.loading") : t("settings.mcpInstall")}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => addServer(createMcpServer(servers))}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t("settings.mcpAddCustom")}
          </Button>
        </div>
      </div>

      {installablePlugins.length > 0 ? (
        <div className="app-material-inset grid gap-2 rounded-md border p-2">
          <div className="text-[11px] font-semibold text-slate-600">{t("settings.mcpInstallTemplates")}</div>
          <div className="flex flex-wrap gap-2">
            {installablePlugins.flatMap((plugin) =>
              plugin.contributions
                .filter((contribution) => contribution.kind === "mcpServer" && contribution.mcpServer)
                .map((contribution) => (
                  <Button
                    key={`${plugin.id}:${contribution.id}`}
                    size="sm"
                    variant="secondary"
                    onClick={() => installMcpTemplate(plugin, contribution.id)}
                  >
                    {contribution.title}
                  </Button>
                )),
            )}
          </div>
        </div>
      ) : null}

      {servers.length === 0 ? (
        <div className="app-material-inset rounded-md border border-dashed p-4 text-xs text-slate-500">
          {t("settings.mcpEmpty")}
        </div>
      ) : servers.map((server, index) => {
        const key = serverKey(index);
        const validation = validationByKey[key];
        return (
          <section key={key} className="app-material-inset grid gap-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={server.enabled ?? true}
                  onChange={(event) => updateServer(index, { enabled: event.target.checked })}
                />
                {server.id || t("settings.mcpUnnamed")}
              </label>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={validatingKey === key} onClick={() => void validateServer(server, key)}>
                  {validatingKey === key ? t("common.loading") : t("settings.mcpValidate")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => updateServers(servers.filter((_, itemIndex) => itemIndex !== index))}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-[minmax(120px,0.5fr)_minmax(160px,1fr)_minmax(160px,1fr)]">
              <Input value={server.id} onChange={(event) => updateServer(index, { id: event.target.value.trim() })} placeholder={t("settings.mcpIdPlaceholder")} className="h-8 text-xs" />
              <Input value={server.command} onChange={(event) => updateServer(index, { command: event.target.value })} placeholder={t("settings.mcpCommandPlaceholder")} className="h-8 text-xs" />
              <Input value={(server.args ?? []).join(" ")} onChange={(event) => updateServer(index, { args: parseArgs(event.target.value) })} placeholder={t("settings.mcpArgsPlaceholder")} className="h-8 text-xs" />
            </div>
            <textarea
              value={formatEnv(server.env)}
              onChange={(event) => updateServer(index, { env: parseEnv(event.target.value) })}
              placeholder={t("settings.mcpEnvPlaceholder")}
              className="app-material-content settings-scrollbar-hidden min-h-16 resize-none rounded border px-2 py-1.5 font-mono text-[11px] leading-5 text-slate-700 outline-none focus:border-[var(--app-accent)]"
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
  activeProjectId: string | null;
  setSettings: Dispatch<SetStateAction<AppSettings | null>>;
  t: TranslationFn;
}) {
  const { settings, activeProjectId, setSettings, t } = props;
  const enabledSkills = settings.uiPrefs?.enabledSkills ?? [];
  const hiddenSkills = settings.uiPrefs?.hiddenSkills ?? [];
  const [customSkill, setCustomSkill] = useState("");
  const [validationBySkill, setValidationBySkill] = useState<Record<string, SkillValidationResult | undefined>>({});
  const [skillCatalog, setSkillCatalog] = useState<ResearchSkillDescriptor[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [validatingSkill, setValidatingSkill] = useState<string | null>(null);
  const [agentRunBySkill, setAgentRunBySkill] = useState<Record<string, string | undefined>>({});
  const [agentEventsByRun, setAgentEventsByRun] = useState<Record<string, SwarmEvent[]>>({});
  const [runningSkill, setRunningSkill] = useState<string | null>(null);
  const activeSkillRunIds = Object.values(agentRunBySkill)
    .filter((runId): runId is string => Boolean(runId && !runId.startsWith("error:")));

  useEffect(() => {
    let disposed = false;
    setCatalogLoading(true);
    void getAgentSkillCatalog()
      .then((catalog) => {
        if (disposed) {
          return;
        }
        setSkillCatalog(catalog);
        setValidationBySkill(Object.fromEntries(
          catalog.map((skill) => [skill.id, skill.validation]),
        ));
      })
      .catch(() => {
        if (!disposed) {
          setSkillCatalog([]);
        }
      })
      .finally(() => {
        if (!disposed) {
          setCatalogLoading(false);
        }
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (activeSkillRunIds.length === 0) {
      return;
    }
    let disposed = false;
    const cursors = new Map(activeSkillRunIds.map((runId) => [runId, 0]));
    const poll = async () => {
      for (const runId of activeSkillRunIds) {
        const batch = await getEvents(cursors.get(runId) ?? 0, 80, runId, 600, ["agent.run.heartbeat"]).catch(() => null);
        if (!batch || disposed) {
          continue;
        }
        cursors.set(runId, batch.nextCursor);
        if (batch.events.length > 0) {
          setAgentEventsByRun((prev) => ({
            ...prev,
            [runId]: [...(prev[runId] ?? []), ...batch.events].slice(-120),
          }));
        }
      }
      if (!disposed) {
        window.setTimeout(poll, 1200);
      }
    };
    void poll();
    return () => {
      disposed = true;
    };
  }, [activeSkillRunIds.join("|")]);

  const updateUiPrefs = (patch: Partial<NonNullable<AppSettings["uiPrefs"]>>) => {
    setSettings((prev) => {
      const base = prev ?? settings;
      return { ...base, uiPrefs: { ...(base.uiPrefs ?? {}), ...patch } };
    });
  };
  const setSkills = (skills: string[]) => updateUiPrefs({ enabledSkills: Array.from(new Set(skills.map((item) => item.trim()).filter(Boolean))) });
  const setHiddenSkills = (skills: string[]) => updateUiPrefs({ hiddenSkills: Array.from(new Set(skills.map((item) => item.trim()).filter(Boolean))) });
  const toggleSkill = (skill: string, enabled: boolean) => {
    setSkills(enabled ? [...enabledSkills, skill] : enabledSkills.filter((item) => item !== skill));
  };
  const addCustomSkill = () => {
    const skill = customSkill.trim();
    if (!skill) {
      return;
    }
    setSkills([...enabledSkills, skill]);
    setSkillCatalog((current) => current.some((item) => item.id === skill)
      ? current
      : [...current, {
          id: skill,
          name: skill,
          description: t("settings.skillCustomDescription"),
          enabled: true,
          hidden: false,
          source: "custom",
          validation: {
            ok: false,
            skillId: skill,
            message: "skill.validation.manifest_missing",
            source: "custom",
          },
        }]);
    setCustomSkill("");
  };
  const validateSkill = async (skill: string) => {
    const normalized = skill.trim();
    setValidatingSkill(skill);
    try {
      const result = await validateAgentSkill(normalized);
      setValidationBySkill((prev) => ({ ...prev, [skill]: result }));
    } catch (error) {
      setValidationBySkill((prev) => ({
        ...prev,
        [skill]: {
          ok: false,
          skillId: normalized,
          message: String(error),
          source: "custom",
        },
      }));
    } finally {
      setValidatingSkill(null);
    }
  };
  const runSkillAgent = async (skill: string) => {
    if (!activeProjectId) {
      setAgentRunBySkill((prev) => ({ ...prev, [skill]: `error:${t("settings.skillRunNoProject")}` }));
      return;
    }
    setRunningSkill(skill);
    try {
      const accepted = await executeWorkflowStart({
        projectId: activeProjectId,
        workflowId: "skill.run",
        callsite: "chat.workspace",
        prompt: [
          `Use the enabled skill "${skill}" as operating guidance.`,
          "Validate whether the skill format and instructions are suitable for this project.",
          "Apply it to a concise research question, literature query, or data-analysis scenario and report evidence limits.",
          "Do not write files unless the normal app permission flow asks for confirmation.",
        ].join("\n"),
        contextRefs: [],
        teamMode: "auto",
        bypassCache: true,
      });
      setAgentRunBySkill((prev) => ({ ...prev, [skill]: accepted.runId }));
    } catch (error) {
      setAgentRunBySkill((prev) => ({ ...prev, [skill]: `error:${String(error)}` }));
    } finally {
      setRunningSkill(null);
    }
  };
  const visibleSkills = [
    ...skillCatalog,
    ...enabledSkills
      .filter((id) => !skillCatalog.some((item) => item.id === id))
      .map((id): ResearchSkillDescriptor => ({
        id,
        name: id,
        description: t("settings.skillCustomDescription"),
        enabled: true,
        hidden: false,
        source: "custom",
        validation: validationBySkill[id] ?? {
          ok: false,
          skillId: id,
          message: "skill.validation.manifest_missing",
          source: "custom",
        },
      })),
  ].filter((skill) => !hiddenSkills.includes(skill.id));

  return (
    <div className="grid gap-3">
      <p className="text-xs text-slate-500">{t("settings.agentSkillsHint")}</p>
      <div className="flex flex-wrap gap-2">
        <Input value={customSkill} onChange={(event) => setCustomSkill(event.target.value)} placeholder={t("settings.skillAddPlaceholder")} className="h-9 text-xs" />
        <Button size="sm" variant="secondary" onClick={addCustomSkill}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {t("settings.skillAdd")}
        </Button>
        {hiddenSkills.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => setHiddenSkills([])}>
            {t("settings.skillRestoreBuiltIns")}
          </Button>
        ) : null}
      </div>
      {catalogLoading ? <div className="text-xs text-slate-500">{t("common.loading")}</div> : null}
      <div className="grid gap-2 lg:grid-cols-2">
        {visibleSkills.map((skill) => {
          const validation = validationBySkill[skill.id] ?? skill.validation;
          const builtIn = skill.source === "builtIn";
          const SkillIcon = builtIn ? BookOpenCheck : Puzzle;
          return (
            <article key={skill.id} className="app-material-inset grid min-w-0 gap-3 rounded-lg border p-3">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className="rounded-lg border border-[color:var(--app-accent)]/25 bg-[color:var(--app-accent)]/10 p-2 text-[color:var(--app-accent)]">
                    <SkillIcon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h4 className="truncate text-xs font-semibold text-slate-700">{skill.name}</h4>
                      <span className="rounded-full border px-1.5 py-0.5 text-[10px] text-slate-500">
                        {builtIn ? t("settings.skillSourceBuiltIn") : t("settings.skillSourceCustom")}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{skill.description}</p>
                  </div>
                </div>
                <label className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-slate-600">
                  <input
                    type="checkbox"
                    checked={enabledSkills.includes(skill.id)}
                    onChange={(event) => toggleSkill(skill.id, event.target.checked)}
                  />
                  {t("settings.skillEnabled")}
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" disabled={validatingSkill === skill.id} onClick={() => void validateSkill(skill.id)}>
                    {validatingSkill === skill.id ? t("common.loading") : t("settings.skillValidate")}
                  </Button>
                  <Button size="sm" variant="secondary" disabled={runningSkill === skill.id} onClick={() => void runSkillAgent(skill.id)}>
                    {runningSkill === skill.id ? t("common.loading") : t("settings.skillRunAgent")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => {
                    setSkills(enabledSkills.filter((item) => item !== skill.id));
                    if (builtIn) {
                      setHiddenSkills([...hiddenSkills, skill.id]);
                    } else {
                      setSkillCatalog((current) => current.filter((item) => item.id !== skill.id));
                    }
                  }} aria-label={builtIn ? t("settings.skillHide") : t("settings.skillRemove")}>
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      {builtIn ? t("settings.skillHide") : t("settings.skillRemove")}
                  </Button>
              </div>
              {validation ? (
                <div className={cn("mt-2 grid gap-1 rounded border px-2 py-1 text-[11px]", statusTone(validation))}>
                  <span>{formatSkillValidationMessage(validation, t)}</span>
                  {validation.manifestPath ? <span className="break-all font-mono opacity-80">{validation.manifestPath}</span> : null}
                  {(validation.details ?? []).length > 0 ? (
                    <span className="break-words opacity-80">
                      {(validation.details ?? []).map((detail) => formatSkillValidationDetail(detail, t)).join(", ")}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {agentRunBySkill[skill.id] ? (
                <div className="app-material-content mt-2 rounded border px-2 py-1 text-[11px] text-slate-600">
                  {agentRunBySkill[skill.id]?.startsWith("error:")
                    ? agentRunBySkill[skill.id]?.slice(6)
                    : t("settings.skillRunStarted").replace("{runId}", agentRunBySkill[skill.id] ?? "")}
                </div>
              ) : null}
              {agentRunBySkill[skill.id] && !agentRunBySkill[skill.id]?.startsWith("error:") ? (
                <AgentTraceCards
                  cards={extractEventCards(agentEventsByRun[agentRunBySkill[skill.id] ?? ""] ?? [], [agentRunBySkill[skill.id] ?? ""])}
                  title={t("settings.skillRunTrace")}
                  t={t}
                  className="app-material-content mt-2 rounded border px-2 py-2"
                  bodyClassName="max-h-72"
                  compact
                />
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
