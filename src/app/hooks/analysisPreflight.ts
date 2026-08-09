import { loadDataSnapshots, type AnalysisSourceSnapshot } from "./analysisDataSources";
import { resolvePromptInputFiles } from "./analysisPromptRefs";
import type { AnalysisMethodFamily, AnalysisPlan, AnalysisSpec } from "../../shared/types/app";
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
  const groupColumn = answers.groupColumn?.find(Boolean)
    ?? answers.subjectColumn?.find(Boolean)
    ?? answers.timeColumn?.find(Boolean)
    ?? answers.eventColumn?.find(Boolean)
    ?? basePlan.groupColumn;
  const pairedAnswer = answers.paired?.[0];
  const paired = pairedAnswer === "paired"
    ? true
    : pairedAnswer === "independent"
      ? false
      : basePlan.paired;
  const outcome = targetColumns[0];
  const predictors = (answers.predictorColumns ?? basePlan.spec?.predictors ?? [])
    .filter((value) => value && value !== outcome && value !== groupColumn);
  const spec = basePlan.spec
    ? {
      ...basePlan.spec,
      outcome,
      predictors,
      groupColumn,
      subjectColumn: answers.subjectColumn?.find(Boolean) ?? basePlan.spec.subjectColumn,
      timeColumn: answers.timeColumn?.find(Boolean) ?? basePlan.spec.timeColumn,
      eventColumn: answers.eventColumn?.find(Boolean) ?? basePlan.spec.eventColumn,
      effectColumn: basePlan.spec.methodFamily === "meta_analysis" ? outcome : basePlan.spec.effectColumn,
      standardErrorColumn: basePlan.spec.methodFamily === "meta_analysis"
        ? predictors[0]
        : basePlan.spec.standardErrorColumn,
      approvalConfirmed: answers.analysisApproval?.includes("confirmed") ?? false,
    }
    : undefined;
  return {
    ...basePlan,
    inputFiles,
    targetColumns,
    groupColumn,
    paired,
    spec,
  };
}

function methodFamilyFromPrompt(prompt: string): AnalysisMethodFamily {
  if (/\b(meta[- ]?analysis|meta analysis)\b|荟萃分析|元分析/i.test(prompt)) return "meta_analysis";
  if (/\b(power analysis|sample size|statistical power)\b|功效分析|样本量估计/i.test(prompt)) return "power_analysis";
  if (/\b(survival|cox|hazard)\b|生存分析|风险比/i.test(prompt)) return "survival";
  if (/\b(time[- ]?series|arima|forecast)\b|时间序列|预测/i.test(prompt)) return "time_series";
  if (/\b(mixed[- ]?(?:effects?|model))\b|混合效应|混合模型/i.test(prompt)) return "mixed_model";
  if (/\b(logistic|logit)\b|逻辑回归/i.test(prompt)) return "logistic_regression";
  if (/\b(poisson)\b|泊松回归/i.test(prompt)) return "poisson_regression";
  if (/\b(glm|generalized linear)\b|广义线性/i.test(prompt)) return "glm";
  if (/\b(regression|regress)\b|回归/i.test(prompt)) return "linear_regression";
  if (/\b(compare|comparison|difference|group|anova|t[- ]?test)\b|比较|差异|组间|分组/i.test(prompt)) return "group_comparison";
  if (/\b(correlat(?:e|ed|es|ing|ion|ions)?|relationship|association|pearson|spearman)\b|相关|关系/i.test(prompt)) return "relationship";
  return "descriptive";
}

function buildAnalysisSpec(input: {
  methodFamily: AnalysisMethodFamily;
  prompt: string;
  plan: AnalysisPlan;
  predictors: string[];
}): AnalysisSpec {
  const { methodFamily, prompt, plan, predictors } = input;
  const outcome = plan.targetColumns[0];
  const grouping = plan.groupColumn;
  return {
    methodFamily,
    outcome,
    predictors: predictors.filter((value) => value !== outcome),
    covariates: [],
    groupColumn: methodFamily === "group_comparison" ? grouping : undefined,
    subjectColumn: methodFamily === "mixed_model" ? grouping : undefined,
    timeColumn: methodFamily === "time_series" ? grouping : undefined,
    eventColumn: methodFamily === "survival" ? grouping : undefined,
    effectColumn: methodFamily === "meta_analysis" ? outcome : undefined,
    standardErrorColumn: methodFamily === "meta_analysis" ? predictors[0] : undefined,
    glmFamily: methodFamily === "logistic_regression"
      ? "binomial"
      : methodFamily === "poisson_regression"
        ? "poisson"
        : methodFamily === "glm"
          ? "gaussian"
          : methodFamily === "linear_regression"
            ? "gaussian"
            : undefined,
    glmLink: methodFamily === "logistic_regression"
      ? "logit"
      : methodFamily === "poisson_regression"
        ? "log"
        : methodFamily === "glm" || methodFamily === "linear_regression"
          ? "identity"
          : undefined,
    missingValueStrategy: plan.missingValueStrategy,
    transformationStrategy: "none",
    outlierStrategy: "report_only",
    multipleComparisonStrategy: ["group_comparison", "relationship"].includes(methodFamily)
      ? "benjamini_hochberg"
      : "none",
    alpha: plan.alpha,
    power: methodFamily === "power_analysis"
      ? { effectSize: 0.5, targetPower: 0.8, groupRatio: 1, alternative: "two-sided" }
      : undefined,
    randomSeed: 20260729,
    rationale: prompt.trim().slice(0, 4_096),
    approvalConfirmed: false,
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
  const methodFamily = methodFamilyFromPrompt(prompt);
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
    if (methodFamily === "power_analysis") {
      const questions: AnalysisPreflightQuestion[] = [{
        id: "analysisApproval",
        title: t("analysis.preflight.approvalTitle"),
        description: t("analysis.preflight.approvalDescription"),
        defaultValues: [],
        options: [{ id: "confirmed", label: t("analysis.preflight.approvalConfirm") }],
      }];
      const answers = { analysisApproval: [] };
      return {
        questions,
        prompt: buildPromptWithAnswers(prompt, questions, answers),
        plan: {
          ...basePlan,
          spec: buildAnalysisSpec({ methodFamily, prompt, plan: basePlan, predictors: [] }),
        },
      };
    }
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
  const allColumnOptions = Array.from(new Set(snapshots
    .flatMap((snapshot) => firstRowCells(snapshot).map((column) => columnRef(snapshot.path, column)))))
    .slice(0, 24);
  const promptLower = prompt.toLowerCase();
  const relationshipIntent = methodFamily === "relationship";
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

  const roleConfig = methodFamily === "group_comparison"
    ? {
      id: "groupColumn",
      title: "analysis.preflight.groupTitle",
      description: "analysis.preflight.groupDescription",
      options: groupingOptions.length > 0 ? groupingOptions : allColumnOptions,
    }
    : methodFamily === "mixed_model"
      ? {
        id: "subjectColumn",
        title: "analysis.preflight.subjectTitle",
        description: "analysis.preflight.subjectDescription",
        options: allColumnOptions,
      }
      : methodFamily === "survival"
        ? {
          id: "eventColumn",
          title: "analysis.preflight.eventTitle",
          description: "analysis.preflight.eventDescription",
          options: numericOptions,
        }
        : methodFamily === "time_series"
          ? {
            id: "timeColumn",
            title: "analysis.preflight.timeTitle",
            description: "analysis.preflight.timeDescription",
            options: allColumnOptions,
          }
          : null;
  if (roleConfig) {
    const roleOptions = roleConfig.options.filter((value) => !basePlan.targetColumns.includes(value));
    const mentionedGroups = mentionedColumnRefs(prompt, roleOptions);
    if (mentionedGroups.length > 0) {
      basePlan.groupColumn = mentionedGroups[0];
    } else if (roleOptions.length === 1) {
      basePlan.groupColumn = roleOptions[0];
    } else if (roleOptions.length > 1) {
      questions.push({
        id: roleConfig.id,
        title: t(roleConfig.title),
        description: t(roleConfig.description),
        defaultValues: roleOptions.slice(0, 1),
        options: roleOptions.map((item) => ({ id: item, label: item })),
      });
    }
  }
  if (methodFamily === "group_comparison") {
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
  const predictorMethods: AnalysisMethodFamily[] = [
    "linear_regression",
    "logistic_regression",
    "poisson_regression",
    "glm",
    "mixed_model",
    "survival",
    "meta_analysis",
  ];
  const roleDefault = basePlan.groupColumn
    ?? questions.find((question) => ["groupColumn", "subjectColumn", "timeColumn", "eventColumn"].includes(question.id))
      ?.defaultValues?.[0];
  const predictorOptions = numericOptions.filter((value) => (
    !basePlan.targetColumns.includes(value) && value !== roleDefault
  ));
  if (predictorMethods.includes(methodFamily) && predictorOptions.length > 0) {
    questions.push({
      id: "predictorColumns",
      title: t("analysis.preflight.predictorsTitle"),
      description: t("analysis.preflight.predictorsDescription"),
      multiple: methodFamily !== "meta_analysis",
      defaultValues: predictorOptions.slice(0, 1),
      options: predictorOptions.map((item) => ({ id: item, label: item })),
    });
  }
  if (methodFamily !== "descriptive") {
    questions.push({
      id: "analysisApproval",
      title: t("analysis.preflight.approvalTitle"),
      description: t("analysis.preflight.approvalDescription"),
      defaultValues: [],
      options: [{ id: "confirmed", label: t("analysis.preflight.approvalConfirm") }],
    });
  }
  const nextAnswers = Object.fromEntries(
    questions.map((question) => [
      question.id,
      question.defaultValues ?? question.options.slice(0, 1).map((option) => option.id),
    ]),
  );
  const resolvedPlan = planWithAnswers(basePlan, nextAnswers);
  const plan: AnalysisPlan = {
    ...resolvedPlan,
    spec: buildAnalysisSpec({
      methodFamily,
      prompt,
      plan: resolvedPlan,
      predictors: methodFamily === "relationship"
        ? resolvedPlan.targetColumns.slice(1)
        : nextAnswers.predictorColumns ?? [],
    }),
  };
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

export function analysisPreflightCanSubmit(
  questions: AnalysisPreflightQuestion[],
  answers: Record<string, string[]>,
): boolean {
  return questions.every((question) => (answers[question.id] ?? []).length > 0);
}
