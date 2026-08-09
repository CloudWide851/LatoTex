import { Bot, Plus, RefreshCw, Workflow } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../../components/ui/button";
import { cspStyle } from "../../../shared/ui/cspStyle";
import { Select } from "../../../components/ui/select";
import { requestAppConfirm } from "../../dialog/appDialogBridge";
import {
  deleteAgentBinding,
  deleteAgentGraph,
  deleteAgentProfile,
  getAgentControlCatalog,
  refreshAgentRuntimes,
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
type MobileTab = "profiles" | "workflow";

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

  const refreshRuntimes = () => {
    void runAction("runtime-refresh", async () => {
      const runtimes = await refreshAgentRuntimes("manual");
      setCatalog((current) => current ? { ...current, runtimes } : current);
    });
  };

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
  const removeProfile = async (profile: AgentProfile) => {
    const affectedBindings = catalog?.bindings.filter((binding) => binding.profileId === profile.id).length ?? 0;
    const affectedNodes = catalog?.graphTemplates.reduce(
      (count, graph) => count + graph.nodes.filter((node) => node.profileId === profile.id).length,
      0,
    ) ?? 0;
    const prompt = t("agents.profile.deleteConfirm")
      .replace("{bindings}", String(affectedBindings))
      .replace("{nodes}", String(affectedNodes));
    const confirmed = await requestAppConfirm({ title: prompt, tone: "danger" });
    if (!confirmed) return;
    await runAction("profile-delete", async () => {
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
  const removeGraph = async (graph: AgentGraphTemplate) => {
    const confirmed = await requestAppConfirm({
      title: t("agents.graph.deleteConfirm"),
      tone: "danger",
    });
    if (!confirmed) return;
    await runAction("graph-delete", async () => {
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
  ];
  const profiles = catalog?.profiles ?? [];
  const graphs = catalog?.graphTemplates ?? [];
  const busy = Boolean(busyAction);

  return (
    <section className="flex h-full min-h-0 flex-col gap-2 overflow-hidden" aria-label={t("agents.title")}>
      {errorKey ? (
        <div role="alert" className="app-status-danger rounded-md border px-3 py-2 text-xs">
          {t(errorKey)}
        </div>
      ) : null}

      <nav className="app-material-inset grid grid-cols-2 gap-1 rounded-lg border p-1 xl:hidden" aria-label={t("agents.mobileSections")}>
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

      <div className="grid min-h-0 flex-1 gap-2 overflow-hidden xl:grid-cols-[250px_minmax(420px,1fr)]">
        <aside className={`${mobileTab === "profiles" ? "flex" : "hidden"} app-material-panel min-h-0 flex-col rounded-lg border xl:flex`}>
          <div className="flex items-center justify-between border-b px-2.5 py-2">
            <h2 className="text-xs font-semibold text-slate-800">{t("agents.profiles.title")}</h2>
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("agents.refresh")}
                title={t("agents.refresh")}
                disabled={busy}
                onClick={refreshRuntimes}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${busyAction === "runtime-refresh" ? "animate-spin" : ""}`} />
              </Button>
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
                <span
                  className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                  {...cspStyle({ backgroundColor: profile.color })}
                />
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
              runtimes={catalog?.runtimes ?? []}
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

      </div>
    </section>
  );
}
