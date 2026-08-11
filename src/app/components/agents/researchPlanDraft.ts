import type {
  ResearchCapabilityDescriptor,
  ResearchPlanStep,
} from "../../../shared/types/researchAgent";

export type EditableResearchPlanStep = Omit<ResearchPlanStep, "input" | "status" | "runId"> & {
  inputText: string;
};

function defaultCapabilityInput(capability: string, goal: string): unknown {
  switch (capability) {
    case "literature.search":
      return { queries: [goal], deep: true };
    case "ui.navigate":
      return { pageId: "latex" };
    case "workspace.read":
      return { path: "main.tex", maxChars: 16_000 };
    case "workspace.propose_latex":
      return { path: "main.tex", instruction: goal };
    case "workspace.apply_latex":
      return { path: "main.tex", proposalId: "" };
    case "workspace.write_non_latex":
      return { path: "", content: "" };
    case "workspace.compile":
      return { mainPath: "main.tex" };
    case "analysis.run":
      return { prompt: goal, inputFiles: [] };
    case "report.generate":
      return { title: goal };
    case "report.export":
      return { reportId: "", format: "pdf" };
    case "draw.create":
      return { name: "research-flow.drawio" };
    case "draw.open":
      return { path: "research-flow.drawio" };
    case "draw.export":
      return { path: "research-flow.drawio", format: "png" };
    case "submission.check":
    case "submission.build":
      return { mainPath: "main.tex", profileId: "generic" };
    case "submission.send":
      return { artifactId: "", channel: "" };
    case "git.diff":
      return { path: "main.tex" };
    case "git.commit":
      return { message: "research: update manuscript", paths: ["main.tex"] };
    case "runtime.update":
      return { runtimeId: "codex-cli" };
    case "plugin.update":
      return { pluginId: "" };
    case "settings.change":
      return { patch: {} };
    case "literature.import":
      return { source: "" };
    case "literature.open":
      return { path: "" };
    case "literature.citation_trace":
      return { doi: "", direction: "both" };
    default:
      return {};
  }
}

function editableStep(input: {
  id: string;
  order: number;
  capability: ResearchCapabilityDescriptor;
  goal: string;
  dependencies?: string[];
}): EditableResearchPlanStep {
  return {
    id: input.id,
    order: input.order,
    enabled: true,
    dependencies: input.dependencies ?? [],
    capability: input.capability.id,
    riskLevel: input.capability.riskLevel,
    inputText: JSON.stringify(defaultCapabilityInput(input.capability.id, input.goal), null, 2),
  };
}

export function buildStarterResearchPlan(
  goal: string,
  registry: ResearchCapabilityDescriptor[],
  createId: () => string = () => `step-${crypto.randomUUID()}`,
): EditableResearchPlanStep[] {
  const byId = new Map(registry.map((descriptor) => [descriptor.id, descriptor]));
  const sequence = ["project.overview", "literature.search"]
    .map((id) => byId.get(id))
    .filter((item): item is ResearchCapabilityDescriptor => Boolean(item));
  const steps: EditableResearchPlanStep[] = [];
  for (const capability of sequence) {
    const id = createId();
    steps.push(editableStep({
      id,
      order: steps.length,
      capability,
      goal,
      dependencies: steps.length > 0 ? [steps[steps.length - 1].id] : [],
    }));
  }
  return steps;
}

export function createEditableResearchPlanStep(
  capability: ResearchCapabilityDescriptor,
  goal: string,
  order: number,
  id = `step-${crypto.randomUUID()}`,
): EditableResearchPlanStep {
  return editableStep({ id, order, capability, goal });
}

export function editableStepsFromPlan(steps: ResearchPlanStep[]): EditableResearchPlanStep[] {
  return [...steps]
    .sort((left, right) => left.order - right.order)
    .map((step, order) => ({
      id: step.id,
      order,
      enabled: step.enabled,
      dependencies: [...step.dependencies],
      capability: step.capability,
      riskLevel: step.riskLevel,
      inputText: JSON.stringify(step.input ?? {}, null, 2),
    }));
}

export function parseEditableResearchPlanSteps(steps: EditableResearchPlanStep[]) {
  return steps.map((step, order) => ({
    id: step.id,
    enabled: step.enabled,
    dependencies: step.dependencies,
    capability: step.capability,
    input: JSON.parse(step.inputText || "{}") as unknown,
    riskLevel: step.riskLevel,
    order,
  }));
}
