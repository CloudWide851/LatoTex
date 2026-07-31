import { analysisSaveReport, referenceCheck } from "../../shared/api/analysis";
import { runtimeLogWrite } from "../../shared/api/runtime";
import type {
  AcademicEvidence,
  AcademicProviderHealth,
  AnalysisResearchPlan,
  AnalysisResearchStage,
  ReferenceCheckResponse,
} from "../../shared/types/app";
import { collectResearchEvidence, updateResearchStage } from "./analysisResearchPlan";
import { buildEvidenceBibtex, textToDataUrl } from "./analysisResearchPlan";
import type { AnalysisTask, AnalysisTaskRun } from "./analysisTypes";
import { nowIso } from "./analysisTypes";
import { upsertRun } from "./analysisWorkspaceHelpers";

export type AnalysisResearchEvidenceOutcome = {
  response: ReferenceCheckResponse | null;
  stages: AnalysisResearchStage[];
  academicEvidence: AcademicEvidence[];
  webEvidence: AcademicEvidence[];
  providerHealth: AcademicProviderHealth[];
};

export function createResearchProgressUpdater(input: {
  taskId: string;
  runId: string;
  researchPlan: AnalysisResearchPlan;
  getStages: () => AnalysisResearchStage[];
  updateTaskById: (taskId: string, updater: (task: AnalysisTask) => AnalysisTask) => void;
}) {
  return (patch?: Partial<AnalysisTaskRun>) => {
    input.updateTaskById(input.taskId, (task) => {
      const existing = task.runs.find((candidate) => candidate.id === input.runId);
      return existing
        ? upsertRun(task, {
            ...existing,
            ...patch,
            researchPlan: input.researchPlan,
            researchStages: input.getStages(),
            updatedAt: nowIso(),
          })
        : task;
    });
  };
}

export function saveAnalysisResearchReport(input: {
  projectId: string;
  runId: string;
  title: string;
  reportHtml: string;
  chartDataUrl: string;
  academicEvidence: AcademicEvidence[];
}) {
  const evidenceBibtex = buildEvidenceBibtex(input.academicEvidence);
  return analysisSaveReport({
    projectId: input.projectId,
    runId: input.runId,
    title: input.title,
    reportHtml: input.reportHtml,
    assets: [
      { fileName: "chart.svg", dataUrl: input.chartDataUrl },
      ...(evidenceBibtex
        ? [{
            fileName: "evidence.bib",
            dataUrl: textToDataUrl(evidenceBibtex, "application/x-bibtex;charset=utf-8"),
          }]
        : []),
    ],
  });
}

export function moveResearchToConclusion(
  stages: AnalysisResearchStage[],
  announce: (id: "review" | "conclusion", stages: AnalysisResearchStage[]) => void,
): AnalysisResearchStage[] {
  let next = updateResearchStage(stages, "analysis", "completed");
  next = updateResearchStage(next, "review", "running");
  announce("review", next);
  next = updateResearchStage(next, "review", "completed", "structured_output_validated");
  next = updateResearchStage(next, "conclusion", "running");
  announce("conclusion", next);
  return next;
}

export async function runAnalysisResearchEvidence(input: {
  projectId: string;
  plan: AnalysisResearchPlan;
  stages: AnalysisResearchStage[];
  onProgress: (outcome: AnalysisResearchEvidenceOutcome) => void;
  search?: typeof referenceCheck;
}): Promise<AnalysisResearchEvidenceOutcome> {
  const search = input.search ?? referenceCheck;
  let outcome: AnalysisResearchEvidenceOutcome = {
    response: null,
    stages: input.stages,
    academicEvidence: [],
    webEvidence: [],
    providerHealth: [],
  };
  const publish = () => input.onProgress(outcome);
  if (input.plan.networkRequirement === "not_needed") {
    outcome = {
      ...outcome,
      stages: updateResearchStage(
        outcome.stages,
        "evidence",
        "skipped",
        input.plan.networkReasonCode,
      ),
    };
    publish();
    return outcome;
  }

  outcome = {
    ...outcome,
    stages: updateResearchStage(outcome.stages, "evidence", "running"),
  };
  publish();
  try {
    const response = await search(
      input.plan.queries,
      6,
      input.projectId,
      undefined,
      input.plan,
      true,
    );
    const collected = collectResearchEvidence(response);
    outcome = {
      response,
      academicEvidence: collected.academic,
      webEvidence: collected.web,
      providerHealth: response.items.flatMap((item) => item.providerHealth),
      stages: updateResearchStage(
        outcome.stages,
        "evidence",
        "completed",
        response.items.some((item) => item.providerErrors.length > 0)
          ? "partial_sources"
          : "all_sources",
      ),
    };
  } catch {
    outcome = {
      ...outcome,
      stages: updateResearchStage(
        outcome.stages,
        "evidence",
        "failed",
        "providers_unavailable",
      ),
    };
    await runtimeLogWrite(
      "WARN",
      "analysis research evidence unavailable: providers_unavailable",
    ).catch(() => undefined);
  }
  publish();
  return outcome;
}
