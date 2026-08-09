export type AnalysisNumericSeriesItem = {
  label: string;
  value: number;
};

export type AnalysisSourceSnapshotInput = {
  path: string;
  kind: string;
  summary: string;
  excerpt: string;
  rows?: number;
  columns?: number;
  numericSeries?: AnalysisNumericSeriesItem[];
};

export type AnalysisMissingValueStrategy = "complete_case" | "report_only";

export type AnalysisMethodFamily =
  | "descriptive"
  | "group_comparison"
  | "relationship"
  | "linear_regression"
  | "logistic_regression"
  | "poisson_regression"
  | "glm"
  | "mixed_model"
  | "survival"
  | "time_series"
  | "meta_analysis"
  | "power_analysis";

export type AnalysisSpec = {
  methodFamily: AnalysisMethodFamily;
  outcome?: string;
  predictors: string[];
  covariates: string[];
  groupColumn?: string;
  subjectColumn?: string;
  timeColumn?: string;
  eventColumn?: string;
  effectColumn?: string;
  standardErrorColumn?: string;
  glmFamily?: "gaussian" | "binomial" | "poisson";
  glmLink?: "identity" | "logit" | "log";
  missingValueStrategy: AnalysisMissingValueStrategy;
  transformationStrategy: "none" | "log" | "standardize";
  outlierStrategy: "report_only" | "exclude_iqr";
  multipleComparisonStrategy: "none" | "benjamini_hochberg";
  alpha: number;
  power?: {
    effectSize: number;
    targetPower: number;
    groupRatio: number;
    alternative: "two-sided" | "larger" | "smaller";
  };
  randomSeed: number;
  rationale: string;
  approvalConfirmed: boolean;
};

export type AnalysisPlan = {
  intent: string;
  inputFiles: string[];
  targetColumns: string[];
  groupColumn?: string;
  paired?: boolean;
  missingValueStrategy: AnalysisMissingValueStrategy;
  alpha: number;
  spec?: AnalysisSpec;
};

export type AnalysisNetworkRequirement = "required" | "optional" | "not_needed";

export type AnalysisResearchPlan = {
  intent: string;
  queries: string[];
  inclusionCriteria: string[];
  exclusionCriteria: string[];
  dataChecks: string[];
  expectedValidations: string[];
  networkRequirement: AnalysisNetworkRequirement;
  networkReasonCode: string;
};

export type AnalysisResearchStageId =
  | "plan"
  | "evidence"
  | "analysis"
  | "review"
  | "conclusion";

export type AnalysisResearchStage = {
  id: AnalysisResearchStageId;
  status: "pending" | "running" | "completed" | "skipped" | "failed";
  detailCode?: string;
};

export type AnalysisRunPythonResponse = {
  status: string;
  runtimeSource: string;
  pythonPath: string;
  venvPath: string;
  stdout: string;
  stderr: string;
  diagnostics: string[];
  profileJson: Record<string, unknown>;
};
