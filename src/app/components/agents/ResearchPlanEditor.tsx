import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  CirclePlay,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Select } from "../../../components/ui/select";
import type { MessageKey } from "../../../i18n/messages/en-US/index";
import type {
  ResearchCapabilityDescriptor,
  ResearchPlanVersion,
} from "../../../shared/types/researchAgent";
import {
  createEditableResearchPlanStep,
  type EditableResearchPlanStep,
} from "./researchPlanDraft";

type TranslationFn = (key: MessageKey) => string;

function reordered(steps: EditableResearchPlanStep[], from: number, to: number) {
  if (to < 0 || to >= steps.length) return steps;
  const next = [...steps];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next.map((step, order) => ({ ...step, order }));
}

export function ResearchPlanEditor(props: {
  goal: string;
  plan: ResearchPlanVersion | null;
  versions: ResearchPlanVersion[];
  registry: ResearchCapabilityDescriptor[];
  steps: EditableResearchPlanStep[];
  busy: boolean;
  dirty: boolean;
  onStepsChange: (steps: EditableResearchPlanStep[]) => void;
  onSelectVersion: (version: number) => void;
  onSave: () => void;
  onApprove: () => void;
  onExecute: () => void;
  t: TranslationFn;
}) {
  const {
    goal,
    plan,
    versions,
    registry,
    steps,
    busy,
    dirty,
    onStepsChange,
    onSelectVersion,
    onSave,
    onApprove,
    onExecute,
    t,
  } = props;
  const approved = plan?.approvalStatus === "approved";

  const updateStep = (index: number, patch: Partial<EditableResearchPlanStep>) => {
    onStepsChange(steps.map((step, stepIndex) => (
      stepIndex === index ? { ...step, ...patch } : step
    )));
  };

  return (
    <section className="app-material-panel flex min-h-0 flex-col overflow-hidden rounded-lg border">
      <header className="grid gap-3 border-b px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-[color:var(--app-fg)]">
              {t("research.workbench.planTitle")}
            </h2>
            {plan ? (
              <span className="rounded border px-1.5 py-0.5 text-[10px] font-medium text-[color:var(--app-muted)]">
                {t("research.workbench.version")} {plan.version}
              </span>
            ) : null}
            {approved ? (
              <span className="app-status-success rounded border px-1.5 py-0.5 text-[10px] font-medium">
                {t("research.workbench.approved")}
              </span>
            ) : null}
          </div>
          <p className="mt-1 truncate text-xs text-[color:var(--app-muted)]" title={goal}>{goal}</p>
        </div>
        {versions.length > 0 ? (
          <label className="grid gap-1 text-[11px] text-[color:var(--app-muted)]">
            <span>{t("research.workbench.versionHistory")}</span>
            <Select
              value={String(plan?.version ?? versions[0].version)}
              onChange={(event) => onSelectVersion(Number(event.target.value))}
              aria-label={t("research.workbench.versionHistory")}
              disabled={busy}
            >
              {versions.map((version) => (
                <option key={version.version} value={version.version}>
                  v{version.version} · {t(`research.workbench.planStatus.${version.approvalStatus}`)}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
      </header>

      <div className="library-scrollbar min-h-0 flex-1 overflow-auto px-4 py-2">
        {steps.length === 0 ? (
          <div className="grid min-h-36 place-items-center border-b border-dashed text-center">
            <p className="max-w-sm text-xs text-[color:var(--app-muted)]">
              {t("research.workbench.planEmpty")}
            </p>
          </div>
        ) : (
          <ol className="divide-y">
            {steps.map((step, index) => (
              <li key={step.id} className="grid gap-3 py-3 lg:grid-cols-[2.25rem_minmax(0,1fr)_minmax(15rem,0.72fr)_auto] lg:items-start">
                <div className="flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-semibold text-[color:var(--app-muted)]">
                  {index + 1}
                </div>
                <div className="min-w-0 space-y-2">
                  <label className="grid gap-1 text-[11px] text-[color:var(--app-muted)]">
                    <span>{t("research.workbench.capability")}</span>
                    <Select
                      value={step.capability}
                      disabled={busy}
                      onChange={(event) => {
                        const descriptor = registry.find((item) => item.id === event.target.value);
                        if (!descriptor) return;
                        const replacement = createEditableResearchPlanStep(descriptor, goal, index, step.id);
                        updateStep(index, {
                          capability: replacement.capability,
                          riskLevel: replacement.riskLevel,
                          inputText: replacement.inputText,
                        });
                      }}
                    >
                      {registry.map((capability) => (
                        <option key={capability.id} value={capability.id}>{capability.id}</option>
                      ))}
                    </Select>
                  </label>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-[color:var(--app-muted)]">
                    <span className={`rounded border px-1.5 py-0.5 ${step.riskLevel === "high" ? "app-status-danger" : step.riskLevel === "write" ? "app-status-warning" : "app-status-info"}`}>
                      {t(`research.workbench.risk.${step.riskLevel}`)}
                    </span>
                    {step.dependencies.length > 0 ? (
                      <span>{t("research.workbench.dependsOn")} {step.dependencies.join(", ")}</span>
                    ) : null}
                  </div>
                </div>
                <label className="grid min-w-0 gap-1 text-[11px] text-[color:var(--app-muted)]">
                  <span>{t("research.workbench.stepInput")}</span>
                  <textarea
                    className="app-material-inset min-h-20 w-full resize-y rounded-md border px-2 py-1.5 font-mono text-[11px] leading-4 text-[color:var(--app-fg)] outline-none focus:border-[color:var(--app-accent)]"
                    value={step.inputText}
                    disabled={busy}
                    spellCheck={false}
                    onChange={(event) => updateStep(index, { inputText: event.target.value })}
                  />
                </label>
                <div className="flex items-center justify-end gap-1 lg:pt-5">
                  <label className="mr-1 inline-flex items-center gap-1.5 text-[11px] text-[color:var(--app-muted)]">
                    <input
                      type="checkbox"
                      checked={step.enabled}
                      disabled={busy}
                      onChange={(event) => updateStep(index, { enabled: event.target.checked })}
                    />
                    {t("research.workbench.enabled")}
                  </label>
                  <Button size="icon" variant="ghost" disabled={busy || index === 0} onClick={() => onStepsChange(reordered(steps, index, index - 1))} aria-label={t("research.workbench.moveUp")}>
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" disabled={busy || index === steps.length - 1} onClick={() => onStepsChange(reordered(steps, index, index + 1))} aria-label={t("research.workbench.moveDown")}>
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => onStepsChange(
                      steps
                        .filter((_, stepIndex) => stepIndex !== index)
                        .map((item, order) => ({
                          ...item,
                          order,
                          dependencies: item.dependencies.filter((dependency) => dependency !== step.id),
                        })),
                    )}
                    aria-label={t("research.workbench.removeStep")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="mt-2"
          disabled={busy || registry.length === 0}
          onClick={() => {
            const descriptor = registry.find((item) => item.id === "project.overview") ?? registry[0];
            if (!descriptor) return;
            onStepsChange([...steps, createEditableResearchPlanStep(descriptor, goal, steps.length)]);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          {t("research.workbench.addStep")}
        </Button>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
        <p className="text-[11px] text-[color:var(--app-muted)]">
          {dirty ? t("research.workbench.unsavedPlan") : t("research.workbench.planSaved")}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" disabled={busy || steps.length === 0 || !dirty} onClick={onSave}>
            <Save className="h-3.5 w-3.5" />
            {t("research.workbench.saveVersion")}
          </Button>
          <Button variant="secondary" size="sm" disabled={busy || !plan || dirty || approved} onClick={onApprove}>
            {approved ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            {t("research.workbench.approvePlan")}
          </Button>
          <Button size="sm" disabled={busy || !plan || dirty || !approved || steps.every((step) => !step.enabled)} onClick={onExecute}>
            <CirclePlay className="h-3.5 w-3.5" />
            {t("research.workbench.executePlan")}
          </Button>
        </div>
      </footer>
    </section>
  );
}
