use crate::models::{AnalysisPlanInput, AnalysisSpecInput};
use std::collections::BTreeSet;

const ANALYSIS_INPUT_FILE_COUNT_LIMIT: usize = 8;
const ANALYSIS_METHOD_FAMILIES: &[&str] = &[
    "descriptive",
    "group_comparison",
    "relationship",
    "linear_regression",
    "logistic_regression",
    "poisson_regression",
    "glm",
    "mixed_model",
    "survival",
    "time_series",
    "meta_analysis",
    "power_analysis",
];

fn analysis_column_ref_valid(value: &str) -> bool {
    let normalized = value.trim();
    if normalized.is_empty() || normalized.chars().count() > 512 || normalized.contains('\0') {
        return false;
    }
    let Some((path, column)) = normalized.rsplit_once(':') else {
        return !normalized.contains('/') && !normalized.contains('\\');
    };
    !column.trim().is_empty()
        && column.chars().count() <= 256
        && crate::storage::normalize_workspace_path(path).is_ok()
}

fn optional_column_valid(value: Option<&str>) -> bool {
    value.map_or(true, analysis_column_ref_valid)
}

fn validate_analysis_spec(
    spec: &AnalysisSpecInput,
    plan: &AnalysisPlanInput,
) -> Result<(), String> {
    if !ANALYSIS_METHOD_FAMILIES.contains(&spec.method_family.as_str()) {
        return Err("analysis.spec.method_invalid".to_string());
    }
    if !(spec.alpha.is_finite() && 0.0 < spec.alpha && spec.alpha < 1.0)
        || (spec.alpha - plan.alpha).abs() > f64::EPSILON
    {
        return Err("analysis.spec.alpha_invalid".to_string());
    }
    if spec.random_seed == 0
        || !matches!(
            spec.missing_value_strategy.as_str(),
            "complete_case" | "report_only"
        )
        || spec.missing_value_strategy != plan.missing_value_strategy
        || !matches!(
            spec.transformation_strategy.as_str(),
            "none" | "log" | "standardize"
        )
        || !matches!(
            spec.outlier_strategy.as_str(),
            "report_only" | "exclude_iqr"
        )
        || !matches!(
            spec.multiple_comparison_strategy.as_str(),
            "none" | "benjamini_hochberg"
        )
    {
        return Err("analysis.spec.strategy_invalid".to_string());
    }
    if spec.predictors.len() > 32
        || spec.covariates.len() > 32
        || !optional_column_valid(spec.outcome.as_deref())
        || !optional_column_valid(spec.group_column.as_deref())
        || !optional_column_valid(spec.subject_column.as_deref())
        || !optional_column_valid(spec.time_column.as_deref())
        || !optional_column_valid(spec.event_column.as_deref())
        || !optional_column_valid(spec.effect_column.as_deref())
        || !optional_column_valid(spec.standard_error_column.as_deref())
        || spec
            .predictors
            .iter()
            .chain(&spec.covariates)
            .any(|value| !analysis_column_ref_valid(value))
    {
        return Err("analysis.spec.columns_invalid".to_string());
    }
    let unique_columns = spec
        .predictors
        .iter()
        .chain(&spec.covariates)
        .collect::<BTreeSet<_>>();
    if unique_columns.len() != spec.predictors.len() + spec.covariates.len() {
        return Err("analysis.spec.columns_duplicate".to_string());
    }
    if spec.method_family != "descriptive"
        && (spec.rationale.trim().is_empty()
            || spec.rationale.chars().count() > 4_096
            || !spec.approval_confirmed)
    {
        return Err(if spec.approval_confirmed {
            "analysis.spec.rationale_invalid"
        } else {
            "analysis.spec.approval_required"
        }
        .to_string());
    }
    let has_outcome = spec.outcome.is_some();
    let has_predictors = !spec.predictors.is_empty();
    let design_valid = match spec.method_family.as_str() {
        "descriptive" => true,
        "group_comparison" => has_outcome && spec.group_column.is_some(),
        "relationship" => spec.predictors.len() + usize::from(has_outcome) >= 2,
        "linear_regression" | "logistic_regression" | "poisson_regression" | "glm" => {
            has_outcome && has_predictors
        }
        "mixed_model" => has_outcome && has_predictors && spec.subject_column.is_some(),
        "survival" => has_outcome && has_predictors && spec.event_column.is_some(),
        "time_series" => has_outcome && spec.time_column.is_some(),
        "meta_analysis" => spec.effect_column.is_some() && spec.standard_error_column.is_some(),
        "power_analysis" => spec.power.as_ref().is_some_and(|power| {
            power.effect_size.is_finite()
                && power.effect_size > 0.0
                && power.target_power.is_finite()
                && 0.0 < power.target_power
                && power.target_power < 1.0
                && power.group_ratio.is_finite()
                && power.group_ratio > 0.0
                && matches!(
                    power.alternative.as_str(),
                    "two-sided" | "larger" | "smaller"
                )
        }),
        _ => false,
    };
    if !design_valid {
        return Err("analysis.spec.design_incomplete".to_string());
    }
    let design_columns = match spec.method_family.as_str() {
        "group_comparison" => vec![spec.outcome.as_deref(), spec.group_column.as_deref()],
        "relationship"
        | "linear_regression"
        | "logistic_regression"
        | "poisson_regression"
        | "glm" => std::iter::once(spec.outcome.as_deref())
            .chain(spec.predictors.iter().map(|value| Some(value.as_str())))
            .chain(spec.covariates.iter().map(|value| Some(value.as_str())))
            .collect(),
        "mixed_model" => std::iter::once(spec.outcome.as_deref())
            .chain(spec.predictors.iter().map(|value| Some(value.as_str())))
            .chain(spec.covariates.iter().map(|value| Some(value.as_str())))
            .chain(std::iter::once(spec.subject_column.as_deref()))
            .collect(),
        "survival" => std::iter::once(spec.outcome.as_deref())
            .chain(spec.predictors.iter().map(|value| Some(value.as_str())))
            .chain(spec.covariates.iter().map(|value| Some(value.as_str())))
            .chain(std::iter::once(spec.event_column.as_deref()))
            .collect(),
        "time_series" => vec![spec.outcome.as_deref(), spec.time_column.as_deref()],
        "meta_analysis" => vec![
            spec.effect_column.as_deref(),
            spec.standard_error_column.as_deref(),
        ],
        _ => Vec::new(),
    }
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();
    if design_columns.iter().collect::<BTreeSet<_>>().len() != design_columns.len() {
        return Err("analysis.spec.columns_duplicate".to_string());
    }
    let glm_valid = match spec.method_family.as_str() {
        "glm" => matches!(
            (spec.glm_family.as_deref(), spec.glm_link.as_deref()),
            (Some("gaussian"), Some("identity"))
                | (Some("binomial"), Some("logit"))
                | (Some("poisson"), Some("log"))
        ),
        "logistic_regression" => {
            spec.glm_family
                .as_deref()
                .map_or(true, |value| value == "binomial")
                && spec
                    .glm_link
                    .as_deref()
                    .map_or(true, |value| value == "logit")
        }
        "poisson_regression" => {
            spec.glm_family
                .as_deref()
                .map_or(true, |value| value == "poisson")
                && spec
                    .glm_link
                    .as_deref()
                    .map_or(true, |value| value == "log")
        }
        "linear_regression" => {
            spec.glm_family
                .as_deref()
                .map_or(true, |value| value == "gaussian")
                && spec
                    .glm_link
                    .as_deref()
                    .map_or(true, |value| value == "identity")
        }
        _ => spec.glm_family.is_none() && spec.glm_link.is_none(),
    };
    if !glm_valid {
        return Err("analysis.spec.glm_invalid".to_string());
    }
    Ok(())
}

pub(super) fn validate_analysis_plan(plan: &AnalysisPlanInput) -> Result<(), String> {
    if plan.intent.trim().is_empty() || plan.intent.chars().count() > 16_000 {
        return Err("analysis.plan.invalid_intent".to_string());
    }
    let power_without_files = plan
        .spec
        .as_ref()
        .is_some_and(|spec| spec.method_family == "power_analysis");
    if plan.input_files.is_empty() && !power_without_files {
        return Err("analysis.input.missing".to_string());
    }
    if plan.input_files.len() > ANALYSIS_INPUT_FILE_COUNT_LIMIT {
        return Err("analysis.input.too_many_files".to_string());
    }
    if !(plan.alpha.is_finite() && 0.0 < plan.alpha && plan.alpha < 1.0) {
        return Err("analysis.plan.invalid_alpha".to_string());
    }
    if !matches!(
        plan.missing_value_strategy.as_str(),
        "complete_case" | "report_only"
    ) {
        return Err("analysis.plan.invalid_missing_strategy".to_string());
    }
    if plan.target_columns.len() > 32
        || plan
            .target_columns
            .iter()
            .any(|value| !analysis_column_ref_valid(value))
        || !optional_column_valid(plan.group_column.as_deref())
    {
        return Err("analysis.plan.invalid_columns".to_string());
    }
    if let Some(spec) = &plan.spec {
        validate_analysis_spec(spec, plan)?;
    } else if !plan.target_columns.is_empty() || plan.group_column.is_some() {
        return Err("analysis.spec.required".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{AnalysisPowerSpecInput, AnalysisSpecInput};

    fn plan(method_family: &str, approved: bool) -> AnalysisPlanInput {
        AnalysisPlanInput {
            intent: "Estimate the adjusted outcome".to_string(),
            input_files: vec!["data.csv".to_string()],
            target_columns: vec!["data.csv:y".to_string()],
            group_column: None,
            paired: None,
            missing_value_strategy: "complete_case".to_string(),
            alpha: 0.05,
            spec: Some(AnalysisSpecInput {
                method_family: method_family.to_string(),
                outcome: Some("data.csv:y".to_string()),
                predictors: vec!["data.csv:x".to_string()],
                covariates: Vec::new(),
                group_column: None,
                subject_column: None,
                time_column: None,
                event_column: None,
                effect_column: None,
                standard_error_column: None,
                glm_family: None,
                glm_link: None,
                missing_value_strategy: "complete_case".to_string(),
                transformation_strategy: "none".to_string(),
                outlier_strategy: "report_only".to_string(),
                multiple_comparison_strategy: "none".to_string(),
                alpha: 0.05,
                power: None,
                random_seed: 20260729,
                rationale: "Estimate the adjusted association".to_string(),
                approval_confirmed: approved,
            }),
        }
    }

    #[test]
    fn inference_requires_an_approved_complete_spec() {
        let pending = plan("linear_regression", false);
        assert_eq!(
            validate_analysis_plan(&pending).unwrap_err(),
            "analysis.spec.approval_required"
        );
        assert!(validate_analysis_plan(&plan("linear_regression", true)).is_ok());
    }

    #[test]
    fn power_analysis_accepts_no_input_file_after_approval() {
        let mut power = plan("power_analysis", true);
        power.input_files.clear();
        let spec = power.spec.as_mut().unwrap();
        spec.outcome = None;
        spec.predictors.clear();
        spec.power = Some(AnalysisPowerSpecInput {
            effect_size: 0.5,
            target_power: 0.8,
            group_ratio: 1.0,
            alternative: "two-sided".to_string(),
        });
        assert!(validate_analysis_plan(&power).is_ok());
    }

    #[test]
    fn inference_rejects_duplicate_roles_and_mismatched_links() {
        let mut duplicate = plan("linear_regression", true);
        duplicate.spec.as_mut().unwrap().predictors = vec!["data.csv:y".to_string()];
        assert_eq!(
            validate_analysis_plan(&duplicate).unwrap_err(),
            "analysis.spec.columns_duplicate"
        );

        let mut mismatched = plan("logistic_regression", true);
        mismatched.spec.as_mut().unwrap().glm_link = Some("identity".to_string());
        assert_eq!(
            validate_analysis_plan(&mismatched).unwrap_err(),
            "analysis.spec.glm_invalid"
        );
    }
}
