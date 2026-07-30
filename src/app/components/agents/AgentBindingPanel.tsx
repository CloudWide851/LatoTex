import { RotateCcw, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Select } from "../../../components/ui/select";
import type {
  AgentBinding,
  AgentCallsiteDescriptor,
  AgentGraphTemplate,
  AgentProfile,
} from "../../../shared/types/agentControl";

type TranslationFn = (key: any) => string;

export function AgentBindingPanel(props: {
  projectId: string | null;
  callsites: AgentCallsiteDescriptor[];
  profiles: AgentProfile[];
  graphs: AgentGraphTemplate[];
  busy: boolean;
  onSave: (binding: AgentBinding) => Promise<void>;
  onReset: (projectId: string | null, callsite: string) => Promise<void>;
  t: TranslationFn;
}) {
  const { projectId, callsites, profiles, graphs, busy, onSave, onReset, t } = props;
  const [scope, setScope] = useState<"project" | "global">(projectId ? "project" : "global");
  const initialDrafts = useMemo(
    () => Object.fromEntries(callsites.map((callsite) => [
      callsite.id,
      {
        profileId: callsite.effectiveProfileId,
        graphTemplateId: callsite.effectiveGraphTemplateId ?? "",
      },
    ])),
    [callsites],
  );
  const [drafts, setDrafts] = useState(initialDrafts);
  useEffect(() => setDrafts(initialDrafts), [initialDrafts]);
  useEffect(() => {
    if (!projectId) setScope("global");
  }, [projectId]);

  const patch = (callsite: string, next: Partial<{ profileId: string; graphTemplateId: string }>) => {
    setDrafts((current) => ({
      ...current,
      [callsite]: { ...current[callsite], ...next },
    }));
  };

  return (
    <section className="app-material-panel grid gap-3 rounded-lg border p-3" aria-labelledby="agent-binding-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="agent-binding-title" className="text-sm font-semibold text-slate-900">
            {t("agents.binding.title")}
          </h2>
          <p className="text-xs text-slate-500">{t("agents.binding.hint")}</p>
        </div>
        <div className="inline-flex rounded-md border p-0.5" role="group" aria-label={t("agents.binding.scope")}>
          <button
            type="button"
            className={`rounded px-2 py-1 text-xs ${scope === "global" ? "bg-[var(--app-accent)] text-white" : "text-slate-600"}`}
            onClick={() => setScope("global")}
          >
            {t("agents.binding.global")}
          </button>
          <button
            type="button"
            className={`rounded px-2 py-1 text-xs ${scope === "project" ? "bg-[var(--app-accent)] text-white" : "text-slate-600"}`}
            onClick={() => setScope("project")}
            disabled={!projectId}
          >
            {t("agents.binding.project")}
          </button>
        </div>
      </div>

      <div className="grid gap-2">
        {callsites.map((callsite) => {
          const draft = drafts[callsite.id] ?? {
            profileId: callsite.effectiveProfileId,
            graphTemplateId: callsite.effectiveGraphTemplateId ?? "",
          };
          return (
            <article key={callsite.id} className="app-material-inset grid gap-2 rounded-md border p-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-xs font-semibold text-slate-800">{t(callsite.labelKey)}</h3>
                  <p className="text-[11px] text-slate-500">{t(callsite.descriptionKey)}</p>
                </div>
                <span className="rounded-full border px-1.5 py-0.5 text-[10px] text-slate-500">
                  {t(`agents.binding.source.${callsite.bindingSource}`)}
                </span>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <label className="grid gap-1 text-[11px] text-slate-600">
                  <span>{t("agents.binding.profile")}</span>
                  <Select
                    value={draft.profileId}
                    aria-label={`${t("agents.binding.profile")}: ${t(callsite.labelKey)}`}
                    onChange={(event) => patch(callsite.id, { profileId: event.target.value })}
                  >
                    {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                  </Select>
                </label>
                <label className="grid gap-1 text-[11px] text-slate-600">
                  <span>{t("agents.binding.graph")}</span>
                  <Select
                    value={draft.graphTemplateId}
                    aria-label={`${t("agents.binding.graph")}: ${t(callsite.labelKey)}`}
                    onChange={(event) => patch(callsite.id, { graphTemplateId: event.target.value })}
                  >
                    <option value="">{t("agents.binding.noGraph")}</option>
                    {graphs.map((graph) => <option key={graph.id} value={graph.id}>{graph.name}</option>)}
                  </Select>
                </label>
              </div>
              <div className="flex justify-end gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void onReset(scope === "project" ? projectId : null, callsite.id)}
                >
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  {t("agents.binding.reset")}
                </Button>
                <Button
                  size="sm"
                  disabled={busy || !draft.profileId}
                  onClick={() => void onSave({
                    projectId: scope === "project" ? projectId : null,
                    callsite: callsite.id,
                    profileId: draft.profileId,
                    graphTemplateId: draft.graphTemplateId || null,
                    updatedAt: "",
                  })}
                >
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                  {t("agents.binding.save")}
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
