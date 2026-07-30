import { Copy, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Select } from "../../../components/ui/select";
import type { ModelCatalogItem } from "../../../shared/types/app";
import type { AgentProfile } from "../../../shared/types/agentControl";

type TranslationFn = (key: any) => string;
const TOOL_IDS: AgentProfile["toolIds"] = ["workspace", "web", "python", "mcp"];

function csv(value: string[]): string {
  return value.join(", ");
}

function parseCsv(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

export function AgentProfileEditor(props: {
  profile: AgentProfile | null;
  models: ModelCatalogItem[];
  busy: boolean;
  onSave: (profile: AgentProfile) => Promise<void>;
  onDuplicate: (profile: AgentProfile) => void;
  onDelete: (profile: AgentProfile) => void;
  t: TranslationFn;
}) {
  const { profile, models, busy, onSave, onDuplicate, onDelete, t } = props;
  const [draft, setDraft] = useState<AgentProfile | null>(profile);

  useEffect(() => setDraft(profile), [profile]);

  if (!draft) {
    return (
      <div className="app-material-inset grid min-h-52 place-items-center rounded-lg border p-6 text-sm text-slate-500">
        {t("agents.profile.empty")}
      </div>
    );
  }

  const readonly = draft.builtIn;
  const patch = (next: Partial<AgentProfile>) => setDraft((current) => (
    current ? { ...current, ...next } : current
  ));
  const toggleTool = (tool: AgentProfile["toolIds"][number], enabled: boolean) => {
    const next = new Set(draft.toolIds);
    if (enabled) next.add(tool);
    else next.delete(tool);
    patch({ toolIds: Array.from(next) });
  };

  return (
    <section className="app-material-panel grid gap-3 rounded-lg border p-3" aria-labelledby="agent-profile-editor-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="agent-profile-editor-title" className="truncate text-sm font-semibold text-slate-900">
            {t("agents.profile.editorTitle")}
          </h2>
          <p className="text-xs text-slate-500">
            {readonly ? t("agents.profile.builtInReadonly") : t("agents.profile.customHint")}
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

      <div className="grid gap-2 md:grid-cols-[minmax(180px,1fr)_84px_minmax(180px,1fr)]">
        <label className="grid gap-1 text-xs text-slate-600">
          <span>{t("agents.profile.name")}</span>
          <Input value={draft.name} disabled={readonly} onChange={(event) => patch({ name: event.target.value })} />
        </label>
        <label className="grid gap-1 text-xs text-slate-600">
          <span>{t("agents.profile.color")}</span>
          <input
            type="color"
            value={draft.color}
            disabled={readonly}
            className="h-9 w-full rounded border border-[var(--editor-widget-border)] bg-transparent p-1"
            onChange={(event) => patch({ color: event.target.value.toUpperCase() })}
          />
        </label>
        <label className="grid gap-1 text-xs text-slate-600">
          <span>{t("agents.profile.model")}</span>
          <Select
            value={draft.modelId ?? ""}
            disabled={readonly}
            aria-label={t("agents.profile.model")}
            onChange={(event) => patch({ modelId: event.target.value || null })}
          >
            <option value="">{t("agents.profile.modelInherited")}</option>
            {models.map((model) => (
              <option key={model.id} value={model.id}>{model.displayName}</option>
            ))}
          </Select>
        </label>
      </div>

      <label className="grid gap-1 text-xs text-slate-600">
        <span>{t("agents.profile.description")}</span>
        <Input
          value={draft.description}
          disabled={readonly}
          onChange={(event) => patch({ description: event.target.value })}
        />
      </label>

      <label className="grid gap-1 text-xs text-slate-600">
        <span>{t("agents.profile.identity")}</span>
        <textarea
          value={draft.identityPrompt}
          disabled={readonly}
          className="app-material-inset min-h-24 resize-y rounded-md border px-2.5 py-2 text-xs leading-5 outline-none focus:border-[var(--app-accent)] disabled:opacity-70"
          onChange={(event) => patch({ identityPrompt: event.target.value })}
        />
      </label>

      <fieldset className="app-material-inset rounded-md border p-2">
        <legend className="px-1 text-xs font-semibold text-slate-700">{t("agents.profile.tools")}</legend>
        <div className="flex flex-wrap gap-2">
          {TOOL_IDS.map((tool) => (
            <label key={tool} className="inline-flex min-h-8 items-center gap-1.5 rounded border px-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={draft.toolIds.includes(tool)}
                disabled={readonly}
                onChange={(event) => toggleTool(tool, event.target.checked)}
              />
              {t(`agents.tool.${tool}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-2 md:grid-cols-2">
        <label className="grid gap-1 text-xs text-slate-600">
          <span>{t("agents.profile.skills")}</span>
          <Input value={csv(draft.skillIds)} disabled={readonly} onChange={(event) => patch({ skillIds: parseCsv(event.target.value) })} />
        </label>
        <label className="grid gap-1 text-xs text-slate-600">
          <span>{t("agents.profile.mcp")}</span>
          <Input value={csv(draft.mcpServerIds)} disabled={readonly} onChange={(event) => patch({ mcpServerIds: parseCsv(event.target.value) })} />
        </label>
        <label className="grid gap-1 text-xs text-slate-600">
          <span>{t("agents.profile.readScopes")}</span>
          <Input value={csv(draft.readScopes)} disabled={readonly} onChange={(event) => patch({ readScopes: parseCsv(event.target.value) })} />
        </label>
        <label className="grid gap-1 text-xs text-slate-600">
          <span>{t("agents.profile.writeScopes")}</span>
          <Input value={csv(draft.writeScopes)} disabled={readonly} onChange={(event) => patch({ writeScopes: parseCsv(event.target.value) })} />
        </label>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <label className="grid gap-1 text-xs text-slate-600">
          <span>{t("agents.profile.toolBudget")}</span>
          <Input type="number" min={1} max={64} value={draft.toolCallBudget} disabled={readonly} onChange={(event) => patch({ toolCallBudget: Number(event.target.value) })} />
        </label>
        <label className="grid gap-1 text-xs text-slate-600">
          <span>{t("agents.profile.tokenBudget")}</span>
          <Input type="number" min={1024} max={200000} step={1024} value={draft.tokenBudget} disabled={readonly} onChange={(event) => patch({ tokenBudget: Number(event.target.value) })} />
        </label>
        <label className="grid gap-1 text-xs text-slate-600">
          <span>{t("agents.profile.timeout")}</span>
          <Input type="number" min={5} max={600} value={Math.round(draft.timeoutMs / 1000)} disabled={readonly} onChange={(event) => patch({ timeoutMs: Number(event.target.value) * 1000 })} />
        </label>
      </div>

      {!readonly ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => void onSave(draft)} disabled={busy}>
            <Save className="mr-1.5 h-3.5 w-3.5" />
            {busy ? t("agents.action.saving") : t("agents.action.saveProfile")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
