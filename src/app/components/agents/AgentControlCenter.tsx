import { Activity, Bot, Network, Plus, RefreshCw, ShieldCheck, Workflow } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Select } from "../../../components/ui/select";
import {
  deleteAgentBinding,
  deleteAgentGraph,
  deleteAgentProfile,
  getAgentControlCatalog,
  saveAgentBinding,
  saveAgentGraph,
  saveAgentProfile,
} from "../../../shared/api/agent";
import type { ModelCatalogItem } from "../../../shared/types/app";
import type {
  AgentControlCatalog,
  AgentGraphTemplate,
  AgentProfile,
} from "../../../shared/types/agentControl";
import { AgentBindingPanel } from "./AgentBindingPanel";
import { AgentGraphEditor } from "./AgentGraphEditor";
import { AgentProfileEditor } from "./AgentProfileEditor";

type TranslationFn = (key: any) => string;
type MobileTab = "profiles" | "workflow" | "health";

function agentControlErrorKey(error: unknown): string {
  const code = String(error);
  if (code.startsWith("agent.profile.")) return "agents.error.profile";
  if (code.startsWith("agent.graph.")) return "agents.error.graph";
  if (code.startsWith("agent.binding.")) return "agents.error.binding";
  return "agents.error.load";
}

function customId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`;
}

export function AgentControlCenter(props: {
  projectId: string | null;
  models: ModelCatalogItem[];
  t: TranslationFn;
}) {
  const { projectId, models, t } = props;
  const [catalog, setCatalog] = useState<AgentControlCatalog | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [selectedGraphId, setSelectedGraphId] = useState("");
  const [mobileTab, setMobileTab] = useState<MobileTab>("workflow");
  const [busyAction, setBusyAction] = useState("");
  const [errorKey, setErrorKey] = useState("");

  const refresh = useCallback(async () => {
    setBusyAction("refresh");
    setErrorKey("");
    try {
      const next = await getAgentControlCatalog(projectId);
      setCatalog(next);
      setSelectedProfileId((current) => (
        next.profiles.some((profile) => profile.id === current)
          ? current
          : next.callsites[0]?.effectiveProfileId ?? next.profiles[0]?.id ?? ""
      ));
      setSelectedGraphId((current) => (
        next.graphTemplates.some((graph) => graph.id === current)
          ? current
          : next.callsites[0]?.effectiveGraphTemplateId ?? next.graphTemplates[0]?.id ?? ""
      ));
    } catch (error) {
      setErrorKey(agentControlErrorKey(error));
    } finally {
      setBusyAction("");
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedProfile = useMemo(
    () => catalog?.profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [catalog?.profiles, selectedProfileId],
  );
  const selectedGraph = useMemo(
    () => catalog?.graphTemplates.find((graph) => graph.id === selectedGraphId) ?? null,
    [catalog?.graphTemplates, selectedGraphId],
  );

  const runAction = useCallback(async (action: string, work: () => Promise<void>) => {
    if (busyAction) return;
    setBusyAction(action);
    setErrorKey("");
    try {
      await work();
    } catch (error) {
      setErrorKey(agentControlErrorKey(error));
    } finally {
      setBusyAction("");
    }
  }, [busyAction]);

  const persistProfile = async (profile: AgentProfile) => {
    await runAction("profile", async () => {
      const saved = await saveAgentProfile(profile);
      setSelectedProfileId(saved.id);
      await refresh();
    });
  };
  const duplicateProfile = (profile: AgentProfile) => {
    const copy: AgentProfile = {
      ...profile,
      id: customId("profile"),
      name: `${profile.name} · ${t("agents.copySuffix")}`,
      builtIn: false,
      createdAt: "",
      updatedAt: "",
    };
    void persistProfile(copy);
  };
  const removeProfile = (profile: AgentProfile) => {
    const affectedBindings = catalog?.bindings.filter((binding) => binding.profileId === profile.id).length ?? 0;
    const affectedNodes = catalog?.graphTemplates.reduce(
      (count, graph) => count + graph.nodes.filter((node) => node.profileId === profile.id).length,
      0,
    ) ?? 0;
    const prompt = t("agents.profile.deleteConfirm")
      .replace("{bindings}", String(affectedBindings))
      .replace("{nodes}", String(affectedNodes));
    if (!window.confirm(prompt)) return;
    void runAction("profile-delete", async () => {
      await deleteAgentProfile(profile.id);
      setSelectedProfileId("");
      await refresh();
    });
  };

  const persistGraph = async (graph: AgentGraphTemplate) => {
    await runAction("graph", async () => {
      const saved = await saveAgentGraph(graph);
      setSelectedGraphId(saved.id);
      await refresh();
    });
  };
  const duplicateGraph = (graph: AgentGraphTemplate) => {
    const copy: AgentGraphTemplate = {
      ...graph,
      id: customId("graph"),
      name: `${graph.name} · ${t("agents.copySuffix")}`,
      builtIn: false,
      createdAt: "",
      updatedAt: "",
    };
    void persistGraph(copy);
  };
  const removeGraph = (graph: AgentGraphTemplate) => {
    if (!window.confirm(t("agents.graph.deleteConfirm"))) return;
    void runAction("graph-delete", async () => {
      await deleteAgentGraph(graph.id);
      setSelectedGraphId("");
      await refresh();
    });
  };

  if (!catalog && busyAction === "refresh") {
    return (
      <section className="grid h-full place-items-center" aria-busy="true">
        <div className="app-material-panel rounded-lg border px-5 py-4 text-sm text-slate-600">
          {t("agents.loading")}
        </div>
      </section>
    );
  }

  const mobileTabs: Array<{ id: MobileTab; icon: typeof Bot }> = [
    { id: "profiles", icon: Bot },
    { id: "workflow", icon: Workflow },
    { id: "health", icon: Activity },
  ];
  const profiles = catalog?.profiles ?? [];
  const graphs = catalog?.graphTemplates ?? [];
  const busy = Boolean(busyAction);

  return (
    <section className="flex h-full min-h-0 flex-col gap-2 overflow-hidden" aria-labelledby="agents-page-title">
      <header className="app-material-panel flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5">
        <div className="min-w-0">
          <h1 id="agents-page-title" className="truncate text-base font-semibold text-slate-900">{t("agents.title")}</h1>
          <p className="truncate text-xs text-slate-500">{t("agents.subtitle")}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => void refresh()} disabled={busy}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${busyAction === "refresh" ? "animate-spin" : ""}`} />
          {t("agents.refresh")}
        </Button>
      </header>

      {errorKey ? (
        <div role="alert" className="app-status-danger rounded-md border px-3 py-2 text-xs">
          {t(errorKey)}
        </div>
      ) : null}

      <nav className="app-material-inset grid grid-cols-3 gap-1 rounded-lg border p-1 xl:hidden" aria-label={t("agents.mobileSections")}>
        {mobileTabs.map(({ id, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`flex min-h-9 items-center justify-center gap-1.5 rounded text-xs font-medium ${mobileTab === id ? "bg-[var(--app-accent)] text-white" : "text-slate-600"}`}
            onClick={() => setMobileTab(id)}
          >
            <Icon className="h-3.5 w-3.5" />
            {t(`agents.tab.${id}`)}
          </button>
        ))}
      </nav>

      <div className="grid min-h-0 flex-1 gap-2 overflow-hidden xl:grid-cols-[250px_minmax(420px,1fr)_280px]">
        <aside className={`${mobileTab === "profiles" ? "flex" : "hidden"} app-material-panel min-h-0 flex-col rounded-lg border xl:flex`}>
          <div className="flex items-center justify-between border-b px-2.5 py-2">
            <div>
              <h2 className="text-xs font-semibold text-slate-800">{t("agents.profiles.title")}</h2>
              <p className="text-[11px] text-slate-500">{t("agents.profiles.hint")}</p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("agents.profile.new")}
              title={t("agents.profile.new")}
              disabled={busy || profiles.length === 0}
              onClick={() => {
                const template = profiles.find((profile) => profile.id === "builtin-researcher") ?? profiles[0];
                if (template) duplicateProfile(template);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-1.5">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                className={`mb-1 flex w-full items-start gap-2 rounded-md border px-2 py-2 text-left transition last:mb-0 ${selectedProfileId === profile.id ? "border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)]" : "border-transparent hover:border-[var(--editor-widget-border)]"}`}
                onClick={() => {
                  setSelectedProfileId(profile.id);
                  setMobileTab("workflow");
                }}
              >
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: profile.color }} />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-slate-800">{profile.name}</span>
                  <span className="block truncate text-[11px] text-slate-500">
                    {profile.builtIn ? t("agents.profile.builtIn") : t("agents.profile.custom")}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <main className={`${mobileTab === "workflow" ? "block" : "hidden"} min-h-0 overflow-auto xl:block`}>
          <div className="grid gap-2">
            <AgentProfileEditor
              profile={selectedProfile}
              models={models}
              busy={busy}
              onSave={persistProfile}
              onDuplicate={duplicateProfile}
              onDelete={removeProfile}
              t={t}
            />
            <AgentBindingPanel
              projectId={projectId}
              callsites={catalog?.callsites ?? []}
              profiles={profiles}
              graphs={graphs}
              busy={busy}
              onSave={async (binding) => {
                await runAction("binding", async () => {
                  await saveAgentBinding(binding);
                  await refresh();
                });
              }}
              onReset={async (scopeProjectId, callsite) => {
                await runAction("binding-reset", async () => {
                  await deleteAgentBinding(scopeProjectId, callsite);
                  await refresh();
                });
              }}
              t={t}
            />
            <section className="app-material-panel grid gap-2 rounded-lg border p-3">
              <label className="grid gap-1 text-xs text-slate-600">
                <span className="font-semibold text-slate-800">{t("agents.graph.select")}</span>
                <Select
                  value={selectedGraphId}
                  aria-label={t("agents.graph.select")}
                  onChange={(event) => setSelectedGraphId(event.target.value)}
                >
                  {graphs.map((graph) => <option key={graph.id} value={graph.id}>{graph.name}</option>)}
                </Select>
              </label>
              <AgentGraphEditor
                graph={selectedGraph}
                profiles={profiles}
                busy={busy}
                onSave={persistGraph}
                onDuplicate={duplicateGraph}
                onDelete={removeGraph}
                t={t}
              />
            </section>
          </div>
        </main>

        <aside className={`${mobileTab === "health" ? "block" : "hidden"} min-h-0 overflow-auto xl:block`}>
          <div className="grid gap-2">
            <section className="app-material-panel rounded-lg border p-3">
              <div className="mb-2 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                <h2 className="text-xs font-semibold text-slate-800">{t("agents.health.permissions")}</h2>
              </div>
              <ul className="grid gap-1.5 text-[11px] text-slate-600">
                <li>{t("agents.health.systemLocked")}</li>
                <li>{t("agents.health.approvalEnforced")}</li>
                <li>{t("agents.health.graphBounded")}</li>
                <li>{t("agents.health.contextScoped")}</li>
              </ul>
            </section>
            <section className="app-material-panel rounded-lg border p-3">
              <div className="mb-2 flex items-center gap-2">
                <Network className="h-4 w-4 text-[var(--app-accent)]" />
                <h2 className="text-xs font-semibold text-slate-800">{t("agents.health.catalog")}</h2>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div className="app-material-inset rounded border p-2">
                  <dt className="text-[10px] text-slate-500">{t("agents.health.profiles")}</dt>
                  <dd className="text-lg font-semibold text-slate-800">{profiles.length}</dd>
                </div>
                <div className="app-material-inset rounded border p-2">
                  <dt className="text-[10px] text-slate-500">{t("agents.health.graphs")}</dt>
                  <dd className="text-lg font-semibold text-slate-800">{graphs.length}</dd>
                </div>
              </dl>
            </section>
            <section className="app-material-panel rounded-lg border p-3">
              <div className="mb-2 flex items-center gap-2">
                <Activity className="h-4 w-4 text-sky-600" />
                <h2 className="text-xs font-semibold text-slate-800">{t("agents.health.recentRuns")}</h2>
              </div>
              <div className="grid gap-1.5">
                {(catalog?.recentRuns ?? []).length === 0 ? (
                  <p className="text-[11px] text-slate-500">{t("agents.health.noRuns")}</p>
                ) : (catalog?.recentRuns ?? []).map((run) => (
                  <article key={run.runId} className="app-material-inset rounded border p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[11px] font-medium text-slate-700">{t(`agents.callsite.${run.callsite}.label`)}</span>
                      <span className="rounded-full border px-1.5 py-0.5 text-[10px] text-slate-500">{t(`agents.run.${run.status}`)}</span>
                    </div>
                    <time className="mt-1 block text-[10px] text-slate-500">{new Date(run.updatedAt).toLocaleString()}</time>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </aside>
      </div>
    </section>
  );
}
