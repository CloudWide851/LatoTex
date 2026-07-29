import { loadDataSnapshots, type AnalysisSourceSnapshot } from "./analysisDataSources";
import { resolvePromptInputFiles } from "./analysisPromptRefs";
import type { AnalysisPlan } from "../../shared/types/app";
import type { AnalysisPreflightQuestion } from "./analysisTypes";

type TranslationFn = (key: any) => string;

export type AnalysisPreflightResult = {
  questions: AnalysisPreflightQuestion[];
  prompt: string;
  plan: AnalysisPlan;
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

function columnRef(path: string, column: string): string {
  return `${path}:${column}`;
}

function columnName(reference: string): string {
  const separator = reference.lastIndexOf(":");
  return separator >= 0 ? reference.slice(separator + 1) : reference;
}

function mentionedColumnRefs(prompt: string, references: string[]): string[] {
  const normalizedPrompt = prompt.toLocaleLowerCase();
  return references.filter((reference) => {
    const name = columnName(reference).trim().toLocaleLowerCase();
    return name.length > 0 && normalizedPrompt.includes(name);
  });
}

function planWithAnswers(
  basePlan: AnalysisPlan,
  answers: Record<string, string[]>,
): AnalysisPlan {
  const inputFiles = answers.inputFiles?.filter(Boolean) ?? basePlan.inputFiles;
  const targetColumns = answers.targetColumns?.filter(Boolean) ?? basePlan.targetColumns;
  const groupColumn = answers.groupColumn?.find(Boolean) ?? basePlan.groupColumn;
  const pairedAnswer = answers.paired?.[0];
  const paired = pairedAnswer === "paired"
    ? true
    : pairedAnswer === "independent"
      ? false
      : basePlan.paired;
  return {
    ...basePlan,
    inputFiles,
    targetColumns,
    groupColumn,
    paired,
  };
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
  const chosenFiles = (refs.resolved.length > 0 ? refs.resolved : defaultFiles).slice(0, 8);
  const basePlan: AnalysisPlan = {
    intent: prompt.trim(),
    inputFiles: chosenFiles,
    targetColumns: [],
    missingValueStrategy: "complete_case",
    alpha: 0.05,
  };
  if (chosenFiles.length === 0) {
    return { questions: [], prompt, plan: basePlan };
  }
  const snapshots = await loadDataSnapshots(projectId, chosenFiles);
  const questions: AnalysisPreflightQuestion[] = [];
  if (chosenFiles.length > 1 && refs.resolved.length === 0) {
    questions.push({
      id: "inputFiles",
      title: t("analysis.preflight.filesTitle"),
      description: t("analysis.preflight.filesDescription"),
      multiple: true,
      defaultValues: snapshots.map((snapshot) => snapshot.path),
      options: snapshots.map((snapshot) => ({
        id: snapshot.path,
        label: snapshot.path,
        detail: snapshot.summary,
      })),
    });
  }
  const numericOptions = snapshots
    .flatMap((snapshot) => likelyNumericColumns(snapshot).map((column) => columnRef(snapshot.path, column)))
    .slice(0, 24);
  const numericNames = new Set(numericOptions.map((reference) => columnName(reference).toLocaleLowerCase()));
  const groupingOptions = snapshots
    .flatMap((snapshot) => firstRowCells(snapshot)
      .filter((column) => !numericNames.has(column.toLocaleLowerCase()))
      .map((column) => columnRef(snapshot.path, column)))
    .slice(0, 24);
  const promptLower = prompt.toLowerCase();
  const relationshipIntent = /\b(correlat(?:e|ed|es|ing|ion|ions)?|relationship|association|pearson|spearman|相关|关系)\b/i.test(promptLower);
  const comparisonIntent = /\b(compare|comparison|difference|group|anova|t[- ]?test|比较|差异|组间|分组)\b/i.test(promptLower);
  const mentionedTargets = mentionedColumnRefs(prompt, numericOptions);
  if (mentionedTargets.length > 0) {
    basePlan.targetColumns = relationshipIntent ? mentionedTargets.slice(0, 4) : mentionedTargets.slice(0, 1);
  } else if (numericOptions.length === 1) {
    basePlan.targetColumns = numericOptions.slice(0, 1);
  } else if (numericOptions.length > 1) {
    const defaults = relationshipIntent ? numericOptions.slice(0, 2) : numericOptions.slice(0, 1);
    questions.push({
      id: "targetColumns",
      title: t("analysis.preflight.metricTitle"),
      description: t("analysis.preflight.metricDescription"),
      multiple: relationshipIntent,
      defaultValues: defaults,
      options: numericOptions.map((item) => ({ id: item, label: item })),
    });
  }

  if (comparisonIntent) {
    const mentionedGroups = mentionedColumnRefs(prompt, groupingOptions);
    if (mentionedGroups.length > 0) {
      basePlan.groupColumn = mentionedGroups[0];
    } else if (groupingOptions.length === 1) {
      basePlan.groupColumn = groupingOptions[0];
    } else if (groupingOptions.length > 1) {
      questions.push({
        id: "groupColumn",
        title: t("analysis.preflight.groupTitle"),
        description: t("analysis.preflight.groupDescription"),
        defaultValues: groupingOptions.slice(0, 1),
        options: groupingOptions.map((item) => ({ id: item, label: item })),
      });
    }
    if (/\b(paired|配对|重复测量)\b/i.test(promptLower)) {
      basePlan.paired = true;
    } else if (/\b(independent|unpaired|独立样本|非配对)\b/i.test(promptLower)) {
      basePlan.paired = false;
    } else {
      questions.push({
        id: "paired",
        title: t("analysis.preflight.pairedTitle"),
        description: t("analysis.preflight.pairedDescription"),
        defaultValues: ["independent"],
        options: [
          { id: "independent", label: t("analysis.preflight.independent") },
          { id: "paired", label: t("analysis.preflight.paired") },
        ],
      });
    }
  }
  const nextAnswers = Object.fromEntries(
    questions.map((question) => [
      question.id,
      question.defaultValues ?? question.options.slice(0, 1).map((option) => option.id),
    ]),
  );
  const plan = planWithAnswers(basePlan, nextAnswers);
  return {
    questions,
    prompt: buildPromptWithAnswers(prompt, questions, nextAnswers),
    plan,
  };
}

export function applyAnalysisPreflightAnswers(input: {
  prompt: string;
  plan: AnalysisPlan;
  questions: AnalysisPreflightQuestion[];
  answers: Record<string, string[]>;
}): { prompt: string; plan: AnalysisPlan } {
  return {
    prompt: buildPromptWithAnswers(input.prompt, input.questions, input.answers),
    plan: planWithAnswers(input.plan, input.answers),
  };
}
