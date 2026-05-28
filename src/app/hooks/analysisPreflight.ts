import { loadDataSnapshots, type AnalysisSourceSnapshot } from "./analysisDataSources";
import { resolvePromptInputFiles } from "./analysisPromptRefs";
import type { AnalysisPreflightQuestion } from "./analysisTypes";

type TranslationFn = (key: any) => string;

export type AnalysisPreflightResult = {
  questions: AnalysisPreflightQuestion[];
  prompt: string;
};

function firstRowCells(snapshot: AnalysisSourceSnapshot): string[] {
  const firstLine = snapshot.excerpt.split(/\r?\n/g).find((line) => line.trim().length > 0) ?? "";
  return firstLine
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function likelyNumericColumns(snapshot: AnalysisSourceSnapshot): string[] {
  if (snapshot.numericSeries && snapshot.numericSeries.length > 0) {
    return snapshot.numericSeries.map((item) => item.label).filter(Boolean).slice(0, 8);
  }
  return firstRowCells(snapshot).slice(0, 8);
}

function buildPromptWithAnswers(
  prompt: string,
  questions: AnalysisPreflightQuestion[],
  answers: Record<string, string[]>,
): string {
  const lines = questions
    .map((question) => {
      const selected = new Set(answers[question.id] ?? []);
      const labels = question.options
        .filter((option) => selected.has(option.id))
        .map((option) => question.id === "inputFiles" ? `@${option.id}` : option.label)
        .join(", ");
      return labels ? `- ${question.title}: ${labels}` : "";
    })
    .filter(Boolean);
  if (lines.length === 0) {
    return prompt;
  }
  return `${prompt.trim()}\n\nAnalysis preflight answers:\n${lines.join("\n")}`;
}

export async function buildAnalysisPreflight(input: {
  projectId: string;
  prompt: string;
  candidateFiles: string[];
  csvCandidateFiles: string[];
  t: TranslationFn;
}): Promise<AnalysisPreflightResult> {
  const { projectId, prompt, candidateFiles, csvCandidateFiles, t } = input;
  const refs = resolvePromptInputFiles(prompt, candidateFiles);
  const defaultFiles = csvCandidateFiles.length > 0 ? csvCandidateFiles : candidateFiles;
  const chosenFiles = refs.resolved.length > 0 ? refs.resolved : defaultFiles;
  if (chosenFiles.length === 0 || refs.resolved.length > 0) {
    return { questions: [], prompt };
  }
  const snapshots = await loadDataSnapshots(projectId, chosenFiles.slice(0, 6));
  const questions: AnalysisPreflightQuestion[] = [];
  if (chosenFiles.length > 1) {
    questions.push({
      id: "inputFiles",
      title: t("analysis.preflight.filesTitle"),
      description: t("analysis.preflight.filesDescription"),
      multiple: true,
      options: snapshots.map((snapshot) => ({
        id: snapshot.path,
        label: snapshot.path,
        detail: snapshot.summary,
      })),
    });
  }
  const numericOptions = snapshots
    .flatMap((snapshot) => likelyNumericColumns(snapshot).map((column) => `${snapshot.path}:${column}`))
    .slice(0, 12);
  const promptLower = prompt.toLowerCase();
  const mentionsMetric = /\b(column|metric|target|指标|列|目标)\b/i.test(promptLower);
  if (numericOptions.length > 1 && !mentionsMetric) {
    questions.push({
      id: "targetMetric",
      title: t("analysis.preflight.metricTitle"),
      description: t("analysis.preflight.metricDescription"),
      options: numericOptions.map((item) => ({ id: item, label: item })),
    });
  }
  const nextAnswers: Record<string, string[]> = {};
  for (const question of questions) {
    nextAnswers[question.id] = question.multiple
      ? question.options.map((option) => option.id)
      : question.options.slice(0, 1).map((option) => option.id);
  }
  return {
    questions,
    prompt: buildPromptWithAnswers(prompt, questions, nextAnswers),
  };
}

export function applyAnalysisPreflightAnswers(input: {
  prompt: string;
  questions: AnalysisPreflightQuestion[];
  answers: Record<string, string[]>;
}): string {
  return buildPromptWithAnswers(input.prompt, input.questions, input.answers);
}
