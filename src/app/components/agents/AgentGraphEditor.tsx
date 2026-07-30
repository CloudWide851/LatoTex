import { Copy, Plus, Save, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Select } from "../../../components/ui/select";
import type {
  AgentGraphRole,
  AgentGraphTemplate,
  AgentProfile,
} from "../../../shared/types/agentControl";

type TranslationFn = (key: any) => string;
const ROLES: AgentGraphRole[] = [
  "planner",
  "researcher",
  "analyst",
  "writer",
  "reviewer",
  "synthesizer",
];

function nextNodeId(graph: AgentGraphTemplate): string {
  for (let index = 1; index <= 8; index += 1) {
    const id = `node-${index}`;
    if (!graph.nodes.some((node) => node.id === id)) return id;
  }
  return `node-${Date.now().toString(36)}`;
}

export function AgentGraphEditor(props: {
  graph: AgentGraphTemplate | null;
  profiles: AgentProfile[];
  busy: boolean;
  onSave: (graph: AgentGraphTemplate) => Promise<void>;
  onDuplicate: (graph: AgentGraphTemplate) => void;
  onDelete: (graph: AgentGraphTemplate) => void;
  t: TranslationFn;
}) {
  const { graph, profiles, busy, onSave, onDuplicate, onDelete, t } = props;
  const [draft, setDraft] = useState<AgentGraphTemplate | null>(graph);
  useEffect(() => setDraft(graph), [graph]);

  if (!draft) {
    return (
      <div className="app-material-inset grid min-h-48 place-items-center rounded-lg border p-6 text-sm text-slate-500">
        {t("agents.graph.empty")}
      </div>
    );
  }

  const readonly = draft.builtIn;
  const patch = (next: Partial<AgentGraphTemplate>) => setDraft((current) => (
    current ? { ...current, ...next } : current
  ));
  const patchNode = (id: string, next: Partial<AgentGraphTemplate["nodes"][number]>) => {
    patch({ nodes: draft.nodes.map((node) => (node.id === id ? { ...node, ...next } : node)) });
  };
  const removeNode = (id: string) => {
    patch({
      nodes: draft.nodes.filter((node) => node.id !== id),
      edges: draft.edges.filter((edge) => edge.from !== id && edge.to !== id),
    });
  };
  const addNode = () => {
    if (draft.nodes.length >= 8) return;
    const id = nextNodeId(draft);
    patch({
      nodes: [
        ...draft.nodes,
        {
          id,
          role: "researcher",
          title: t("agents.graph.newNode"),
          profileId: profiles.find((profile) => profile.id === "builtin-researcher")?.id
            ?? profiles[0]?.id
            ?? null,
          instruction: "",
          optional: false,
        },
      ],
    });
  };
  const toggleDependency = (from: string, to: string, enabled: boolean) => {
    const without = draft.edges.filter((edge) => !(edge.from === from && edge.to === to));
    patch({ edges: enabled ? [...without, { from, to }] : without });
  };

  return (
    <section className="app-material-panel grid gap-3 rounded-lg border p-3" aria-labelledby="agent-graph-editor-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="agent-graph-editor-title" className="text-sm font-semibold text-slate-900">
            {t("agents.graph.editorTitle")}
          </h2>
          <p className="text-xs text-slate-500">
            {readonly ? t("agents.graph.builtInReadonly") : t("agents.graph.hint")}
          </p>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => onDuplicate(draft)} disabled={busy}>
            <Copy className="mr-1.5 h-3.5 w-3.5" />
            {t("agents.action.duplicate")}
          </Button>
          {!readonly ? (
            <Button size="sm" variant="ghost" onClick={() => onDelete(draft)} disabled={busy}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {t("agents.action.delete")}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-[minmax(180px,1fr)_130px]">
        <label className="grid gap-1 text-xs text-slate-600">
          <span>{t("agents.graph.name")}</span>
          <Input value={draft.name} disabled={readonly} onChange={(event) => patch({ name: event.target.value })} />
        </label>
        <label className="grid gap-1 text-xs text-slate-600">
          <span>{t("agents.graph.parallelism")}</span>
          <Select
            value={draft.maxParallelism}
            disabled={readonly}
            aria-label={t("agents.graph.parallelism")}
            onChange={(event) => patch({ maxParallelism: Number(event.target.value) })}
          >
            {[1, 2, 3].map((value) => <option key={value} value={value}>{value}</option>)}
          </Select>
        </label>
      </div>
      <label className="grid gap-1 text-xs text-slate-600">
        <span>{t("agents.graph.description")}</span>
        <Input value={draft.description} disabled={readonly} onChange={(event) => patch({ description: event.target.value })} />
      </label>

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold text-slate-700">{t("agents.graph.nodes")}</h3>
            <p className="text-[11px] text-slate-500">{t("agents.graph.directDependencies")}</p>
          </div>
          {!readonly ? (
            <Button size="sm" variant="secondary" onClick={addNode} disabled={busy || draft.nodes.length >= 8}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              {t("agents.graph.addNode")}
            </Button>
          ) : null}
        </div>

        {draft.nodes.map((node, index) => {
          const incoming = new Set(draft.edges.filter((edge) => edge.to === node.id).map((edge) => edge.from));
          return (
            <article key={node.id} className="app-material-inset grid gap-2 rounded-md border p-2.5">
              <div className="grid items-end gap-2 md:grid-cols-[38px_minmax(120px,0.7fr)_minmax(130px,0.8fr)_minmax(150px,1fr)_auto]">
                <span className="grid h-8 place-items-center rounded-full border text-xs font-semibold text-slate-600">
                  {index + 1}
                </span>
                <label className="grid gap-1 text-[11px] text-slate-600">
                  <span>{t("agents.graph.nodeTitle")}</span>
                  <Input value={node.title} disabled={readonly} onChange={(event) => patchNode(node.id, { title: event.target.value })} />
                </label>
                <label className="grid gap-1 text-[11px] text-slate-600">
                  <span>{t("agents.graph.role")}</span>
                  <Select
                    value={node.role}
                    disabled={readonly}
                    aria-label={`${t("agents.graph.role")}: ${node.title}`}
                    onChange={(event) => patchNode(node.id, { role: event.target.value as AgentGraphRole })}
                  >
                    {ROLES.map((role) => <option key={role} value={role}>{t(`agents.role.${role}`)}</option>)}
                  </Select>
                </label>
                <label className="grid gap-1 text-[11px] text-slate-600">
                  <span>{t("agents.graph.profile")}</span>
                  <Select
                    value={node.profileId ?? ""}
                    disabled={readonly}
                    aria-label={`${t("agents.graph.profile")}: ${node.title}`}
                    onChange={(event) => patchNode(node.id, { profileId: event.target.value || null })}
                  >
                    {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                  </Select>
                </label>
                {!readonly ? (
                  <Button size="icon" variant="ghost" aria-label={t("agents.graph.removeNode")} title={t("agents.graph.removeNode")} onClick={() => removeNode(node.id)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </div>
              <label className="grid gap-1 text-[11px] text-slate-600">
                <span>{t("agents.graph.instruction")}</span>
                <Input value={node.instruction} disabled={readonly} onChange={(event) => patchNode(node.id, { instruction: event.target.value })} />
              </label>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-medium text-slate-600">{t("agents.graph.dependsOn")}</span>
                {draft.nodes.filter((candidate) => candidate.id !== node.id).map((candidate) => (
                  <label key={candidate.id} className="inline-flex min-h-7 items-center gap-1 rounded border px-1.5 text-[11px] text-slate-600">
                    <input
                      type="checkbox"
                      checked={incoming.has(candidate.id)}
                      disabled={readonly}
                      onChange={(event) => toggleDependency(candidate.id, node.id, event.target.checked)}
                    />
                    {candidate.title}
                  </label>
                ))}
                <label className="ml-auto inline-flex min-h-7 items-center gap-1 text-[11px] text-slate-600">
                  <input type="checkbox" checked={node.optional} disabled={readonly} onChange={(event) => patchNode(node.id, { optional: event.target.checked })} />
                  {t("agents.graph.optional")}
                </label>
              </div>
            </article>
          );
        })}
      </div>

      {!readonly ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => void onSave(draft)} disabled={busy}>
            <Save className="mr-1.5 h-3.5 w-3.5" />
            {busy ? t("agents.action.saving") : t("agents.action.saveGraph")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
