import math
from typing import Any

import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy import stats
from statsmodels.duration.hazard_regression import PHReg
from statsmodels.stats.multitest import multipletests
from statsmodels.stats.power import TTestIndPower
from statsmodels.tools.sm_exceptions import PerfectSeparationError
from statsmodels.tsa.arima.model import ARIMA

from analysis_runtime_core import AnalysisRuntimeError, finite_or_none, resolve_column
from analysis_runtime_core import transform_numeric


def resolved_columns(
    references: list[str],
    datasets: list[dict[str, Any]],
) -> tuple[dict[str, Any], list[str]]:
    resolved = [resolve_column(reference, datasets) for reference in references]
    if any(item is None for item in resolved):
        raise AnalysisRuntimeError("analysis.runtime.column_not_found")
    items = [item for item in resolved if item is not None]
    if not items or any(item[0] is not items[0][0] for item in items):
        raise AnalysisRuntimeError("analysis.runtime.columns_cross_file")
    return items[0][0], [item[1] for item in items]


def prepare_model_frame(
    spec: dict,
    datasets: list[dict[str, Any]],
    references: list[str],
    outcome_index: int = 0,
    numeric_indices: list[int] | None = None,
    transform_indices: list[int] | None = None,
) -> tuple[dict[str, Any], pd.DataFrame, list[str], int, int]:
    dataset, columns = resolved_columns(references, datasets)
    frame = dataset["frame"][columns].copy()
    numeric_indices = numeric_indices if numeric_indices is not None else list(range(len(columns)))
    transform_indices = transform_indices if transform_indices is not None else [
        index for index in numeric_indices if index != outcome_index
    ]
    for index in numeric_indices:
        frame[columns[index]] = pd.to_numeric(frame[columns[index]], errors="coerce")
    transform_numeric(
        frame,
        [columns[index] for index in transform_indices],
        str(spec.get("transformationStrategy") or "none"),
    )
    missing_rows = int(frame.isna().any(axis=1).sum())
    if missing_rows and spec.get("missingValueStrategy") == "report_only":
        raise AnalysisRuntimeError("analysis.runtime.missing_values_unresolved")
    frame = frame.dropna()
    outlier_rows = 0
    if spec.get("outlierStrategy") == "exclude_iqr" and not frame.empty:
        outcome = frame[columns[outcome_index]]
        q1, q3 = outcome.quantile([0.25, 0.75])
        iqr = float(q3 - q1)
        keep = (outcome >= q1 - 1.5 * iqr) & (outcome <= q3 + 1.5 * iqr)
        outlier_rows = int((~keep).sum())
        frame = frame.loc[keep]
    if len(frame) < max(5, len(columns) + 2):
        raise AnalysisRuntimeError("analysis.runtime.insufficient_complete_rows")
    return dataset, frame, columns, missing_rows, outlier_rows


def adjusted_coefficients(rows: list[dict[str, Any]], spec: dict) -> list[dict[str, Any]]:
    if spec.get("multipleComparisonStrategy") != "benjamini_hochberg":
        return rows
    eligible = [index for index, row in enumerate(rows) if row["term"] != "const" and row["pValue"] is not None]
    if not eligible:
        return rows
    _, adjusted, _, _ = multipletests(
        [float(rows[index]["pValue"]) for index in eligible],
        alpha=float(spec.get("alpha") or 0.05),
        method="fdr_bh",
    )
    for offset, index in enumerate(eligible):
        rows[index]["adjustedPValue"] = finite_or_none(adjusted[offset])
    return rows


def coefficient_rows(
    names: list[str],
    params: Any,
    standard_errors: Any,
    statistics: Any,
    p_values: Any,
    confidence: Any,
    spec: dict,
) -> list[dict[str, Any]]:
    rows = []
    for index, name in enumerate(names):
        interval = confidence[index]
        rows.append({
            "term": str(name),
            "estimate": finite_or_none(params[index]),
            "standardError": finite_or_none(standard_errors[index]),
            "statistic": finite_or_none(statistics[index]),
            "pValue": finite_or_none(p_values[index]),
            "confidenceInterval95": [finite_or_none(interval[0]), finite_or_none(interval[1])],
        })
    return adjusted_coefficients(rows, spec)


def regression_analysis(spec: dict, datasets: list[dict[str, Any]]) -> dict[str, Any]:
    references = [spec["outcome"], *(spec.get("predictors") or []), *(spec.get("covariates") or [])]
    dataset, frame, columns, missing_rows, outlier_rows = prepare_model_frame(spec, datasets, references)
    outcome, predictors = columns[0], columns[1:]
    design = sm.add_constant(frame[predictors].astype(float), has_constant="add")
    response = frame[outcome].astype(float)
    method = str(spec.get("methodFamily"))
    if method == "logistic_regression" and not set(response.unique()).issubset({0.0, 1.0}):
        raise AnalysisRuntimeError("analysis.runtime.logistic_outcome_invalid")
    if method == "poisson_regression" and (
        (response < 0).any() or not np.allclose(response, np.round(response))
    ):
        raise AnalysisRuntimeError("analysis.runtime.poisson_outcome_invalid")
    try:
        if method == "linear_regression":
            result = sm.OLS(response, design).fit()
            family = "gaussian"
            link = "identity"
        else:
            family_name = str(spec.get("glmFamily") or {
                "logistic_regression": "binomial",
                "poisson_regression": "poisson",
            }.get(method, "gaussian"))
            family_model = {
                "gaussian": sm.families.Gaussian(sm.families.links.Identity()),
                "binomial": sm.families.Binomial(sm.families.links.Logit()),
                "poisson": sm.families.Poisson(sm.families.links.Log()),
            }[family_name]
            link = {"gaussian": "identity", "binomial": "logit", "poisson": "log"}[family_name]
            result = sm.GLM(response, design, family=family_model).fit()
            family = family_name
    except (PerfectSeparationError, ValueError, np.linalg.LinAlgError) as error:
        raise AnalysisRuntimeError("analysis.runtime.singular_model") from error
    confidence = np.asarray(result.conf_int())
    coefficients = coefficient_rows(
        list(result.params.index),
        np.asarray(result.params),
        np.asarray(result.bse),
        np.asarray(result.tvalues),
        np.asarray(result.pvalues),
        confidence,
        spec,
    )
    if any(row["estimate"] is None or row["standardError"] is None for row in coefficients):
        raise AnalysisRuntimeError("analysis.runtime.singular_model")
    bic_value = getattr(result, "bic_llf", None)
    if bic_value is None:
        bic_value = getattr(result, "bic", None)
    diagnostics = {
        "family": family,
        "link": link,
        "aic": finite_or_none(getattr(result, "aic", None)),
        "bic": finite_or_none(bic_value),
        "rSquared": finite_or_none(getattr(result, "rsquared", None)),
        "conditionNumber": finite_or_none(getattr(result, "condition_number", None)),
    }
    return {
        "kind": method,
        "sourcePath": dataset["sourcePath"],
        "formula": f"{outcome} ~ {' + '.join(predictors)}",
        "includedRows": int(len(frame)),
        "excludedRows": missing_rows + outlier_rows,
        "exclusions": {"missing": missing_rows, "outlier": outlier_rows},
        "coefficients": coefficients,
        "effect": coefficients[1] if len(coefficients) > 1 else coefficients[0],
        "diagnostics": diagnostics,
    }


def mixed_model_analysis(spec: dict, datasets: list[dict[str, Any]]) -> dict[str, Any]:
    references = [
        spec["outcome"],
        *(spec.get("predictors") or []),
        *(spec.get("covariates") or []),
        spec["subjectColumn"],
    ]
    numeric_indices = list(range(len(references) - 1))
    dataset, frame, columns, missing_rows, outlier_rows = prepare_model_frame(
        spec,
        datasets,
        references,
        numeric_indices=numeric_indices,
        transform_indices=list(range(1, len(references) - 1)),
    )
    outcome, subject = columns[0], columns[-1]
    predictors = columns[1:-1]
    design = sm.add_constant(frame[predictors].astype(float), has_constant="add")
    try:
        result = sm.MixedLM(frame[outcome].astype(float), design, groups=frame[subject]).fit(
            reml=False,
            method="lbfgs",
            disp=False,
        )
    except (ValueError, np.linalg.LinAlgError) as error:
        raise AnalysisRuntimeError("analysis.runtime.singular_model") from error
    if not bool(result.converged) or int(frame[subject].nunique()) < 2:
        raise AnalysisRuntimeError("analysis.runtime.singular_model")
    fixed_names = list(result.fe_params.index)
    confidence = np.asarray(result.conf_int().loc[fixed_names])
    coefficients = coefficient_rows(
        fixed_names,
        np.asarray(result.fe_params),
        np.asarray(result.bse_fe),
        np.asarray(result.fe_params) / np.asarray(result.bse_fe),
        np.asarray(result.pvalues.loc[fixed_names]),
        confidence,
        spec,
    )
    return {
        "kind": "mixed_model",
        "sourcePath": dataset["sourcePath"],
        "formula": f"{outcome} ~ {' + '.join(predictors)} + (1 | {subject})",
        "includedRows": int(len(frame)),
        "excludedRows": missing_rows + outlier_rows,
        "exclusions": {"missing": missing_rows, "outlier": outlier_rows},
        "coefficients": coefficients,
        "effect": coefficients[1] if len(coefficients) > 1 else coefficients[0],
        "diagnostics": {
            "converged": bool(result.converged),
            "groupCount": int(frame[subject].nunique()),
            "scale": finite_or_none(result.scale),
            "aic": finite_or_none(result.aic),
        },
    }


def survival_analysis(spec: dict, datasets: list[dict[str, Any]]) -> dict[str, Any]:
    references = [spec["outcome"], *(spec.get("predictors") or []), *(spec.get("covariates") or []), spec["eventColumn"]]
    dataset, frame, columns, missing_rows, outlier_rows = prepare_model_frame(
        spec,
        datasets,
        references,
        numeric_indices=list(range(len(references))),
        transform_indices=list(range(1, len(references) - 1)),
    )
    duration, event = columns[0], columns[-1]
    predictors = columns[1:-1]
    status = frame[event].astype(int)
    if not set(status.unique()).issubset({0, 1}) or status.sum() < 2:
        raise AnalysisRuntimeError("analysis.runtime.survival_event_invalid")
    try:
        result = PHReg(frame[duration].astype(float), frame[predictors].astype(float), status=status).fit(disp=0)
    except (ValueError, np.linalg.LinAlgError) as error:
        raise AnalysisRuntimeError("analysis.runtime.singular_model") from error
    coefficients = coefficient_rows(
        predictors,
        np.asarray(result.params),
        np.asarray(result.bse),
        np.asarray(result.tvalues),
        np.asarray(result.pvalues),
        np.asarray(result.conf_int()),
        spec,
    )
    for row in coefficients:
        row["hazardRatio"] = finite_or_none(math.exp(float(row["estimate"]))) if row["estimate"] is not None else None
    return {
        "kind": "survival",
        "sourcePath": dataset["sourcePath"],
        "formula": f"Surv({duration}, {event}) ~ {' + '.join(predictors)}",
        "includedRows": int(len(frame)),
        "excludedRows": missing_rows + outlier_rows,
        "exclusions": {"missing": missing_rows, "outlier": outlier_rows},
        "coefficients": coefficients,
        "effect": coefficients[0],
        "diagnostics": {"eventCount": int(status.sum()), "censoredCount": int(len(status) - status.sum())},
    }


def time_series_analysis(spec: dict, datasets: list[dict[str, Any]]) -> dict[str, Any]:
    dataset, columns = resolved_columns([spec["outcome"], spec["timeColumn"]], datasets)
    outcome, time_column = columns
    frame = dataset["frame"][[outcome, time_column]].copy()
    frame[outcome] = pd.to_numeric(frame[outcome], errors="coerce")
    original_rows = len(frame)
    frame = frame.dropna().sort_values(time_column, kind="mergesort")
    if len(frame) < 12:
        raise AnalysisRuntimeError("analysis.runtime.time_series_too_short")
    try:
        result = ARIMA(frame[outcome].astype(float), order=(1, 0, 0), trend="ct").fit()
    except (ValueError, np.linalg.LinAlgError) as error:
        raise AnalysisRuntimeError("analysis.runtime.singular_model") from error
    names = list(result.param_names)
    coefficients = coefficient_rows(
        names,
        np.asarray(result.params),
        np.asarray(result.bse),
        np.asarray(result.tvalues),
        np.asarray(result.pvalues),
        np.asarray(result.conf_int()),
        spec,
    )
    return {
        "kind": "time_series",
        "sourcePath": dataset["sourcePath"],
        "formula": f"ARIMA(1,0,0): {outcome} ordered by {time_column}",
        "includedRows": int(len(frame)),
        "excludedRows": int(original_rows - len(frame)),
        "exclusions": {"missing": int(original_rows - len(frame)), "outlier": 0},
        "coefficients": coefficients,
        "effect": next((row for row in coefficients if row["term"].startswith("ar.")), coefficients[0]),
        "diagnostics": {
            "aic": finite_or_none(result.aic),
            "bic": finite_or_none(result.bic),
            "residualStd": finite_or_none(np.std(result.resid, ddof=1)),
        },
    }


def meta_analysis(spec: dict, datasets: list[dict[str, Any]]) -> dict[str, Any]:
    dataset, columns = resolved_columns([spec["effectColumn"], spec["standardErrorColumn"]], datasets)
    effect_column, se_column = columns
    frame = dataset["frame"][[effect_column, se_column]].apply(pd.to_numeric, errors="coerce")
    original_rows = len(frame)
    frame = frame.dropna()
    frame = frame.loc[frame[se_column] > 0]
    if len(frame) < 2:
        raise AnalysisRuntimeError("analysis.runtime.meta_studies_insufficient")
    effects = frame[effect_column].to_numpy(dtype=float)
    variances = np.square(frame[se_column].to_numpy(dtype=float))
    fixed_weights = 1 / variances
    fixed = float(np.sum(fixed_weights * effects) / np.sum(fixed_weights))
    q = float(np.sum(fixed_weights * np.square(effects - fixed)))
    degrees = len(effects) - 1
    c_value = float(np.sum(fixed_weights) - np.sum(np.square(fixed_weights)) / np.sum(fixed_weights))
    tau_squared = max(0.0, (q - degrees) / c_value) if c_value > 0 else 0.0
    random_weights = 1 / (variances + tau_squared)
    random = float(np.sum(random_weights * effects) / np.sum(random_weights))

    def pooled_row(label: str, estimate: float, weights: np.ndarray) -> dict[str, Any]:
        standard_error = math.sqrt(1 / float(np.sum(weights)))
        return {
            "term": label,
            "estimate": finite_or_none(estimate),
            "standardError": finite_or_none(standard_error),
            "statistic": finite_or_none(estimate / standard_error),
            "pValue": finite_or_none(2 * stats.norm.sf(abs(estimate / standard_error))),
            "confidenceInterval95": [
                finite_or_none(estimate - 1.96 * standard_error),
                finite_or_none(estimate + 1.96 * standard_error),
            ],
        }

    coefficients = [
        pooled_row("fixed_effect", fixed, fixed_weights),
        pooled_row("random_effect", random, random_weights),
    ]
    return {
        "kind": "meta_analysis",
        "sourcePath": dataset["sourcePath"],
        "formula": f"{effect_column} ~ 1; inverse-variance weights from {se_column}",
        "includedRows": int(len(frame)),
        "excludedRows": int(original_rows - len(frame)),
        "exclusions": {"missingOrInvalidStandardError": int(original_rows - len(frame))},
        "coefficients": coefficients,
        "effect": coefficients[1],
        "diagnostics": {
            "studyCount": int(len(frame)),
            "q": finite_or_none(q),
            "tauSquared": finite_or_none(tau_squared),
            "iSquared": finite_or_none(max(0.0, (q - degrees) / q) * 100) if q > 0 else 0,
        },
    }


def power_analysis(spec: dict) -> dict[str, Any]:
    power = spec.get("power") or {}
    effect_size = float(power.get("effectSize") or 0)
    target_power = float(power.get("targetPower") or 0)
    ratio = float(power.get("groupRatio") or 1)
    alternative = str(power.get("alternative") or "two-sided")
    try:
        group_one = float(TTestIndPower().solve_power(
            effect_size=effect_size,
            nobs1=None,
            alpha=float(spec.get("alpha") or 0.05),
            power=target_power,
            ratio=ratio,
            alternative=alternative,
        ))
    except (ValueError, TypeError) as error:
        raise AnalysisRuntimeError("analysis.runtime.power_invalid") from error
    group_one_ceiling = int(math.ceil(group_one))
    group_two_ceiling = int(math.ceil(group_one * ratio))
    coefficient = {
        "term": "required_sample_size",
        "estimate": group_one_ceiling + group_two_ceiling,
        "standardError": None,
        "statistic": None,
        "pValue": None,
        "confidenceInterval95": [None, None],
    }
    return {
        "kind": "power_analysis",
        "formula": "two-sample mean comparison power",
        "includedRows": 0,
        "excludedRows": 0,
        "exclusions": {},
        "coefficients": [coefficient],
        "effect": coefficient,
        "diagnostics": {
            "effectSize": finite_or_none(effect_size),
            "targetPower": finite_or_none(target_power),
            "groupRatio": finite_or_none(ratio),
            "groupOne": group_one_ceiling,
            "groupTwo": group_two_ceiling,
            "total": group_one_ceiling + group_two_ceiling,
            "alternative": alternative,
        },
    }


def run_advanced_analysis(
    spec: dict,
    datasets: list[dict[str, Any]],
) -> dict[str, Any]:
    method = str(spec.get("methodFamily") or "")
    if method in {"linear_regression", "logistic_regression", "poisson_regression", "glm"}:
        return regression_analysis(spec, datasets)
    if method == "mixed_model":
        return mixed_model_analysis(spec, datasets)
    if method == "survival":
        return survival_analysis(spec, datasets)
    if method == "time_series":
        return time_series_analysis(spec, datasets)
    if method == "meta_analysis":
        return meta_analysis(spec, datasets)
    if method == "power_analysis":
        return power_analysis(spec)
    raise AnalysisRuntimeError("analysis.runtime.method_unsupported")
