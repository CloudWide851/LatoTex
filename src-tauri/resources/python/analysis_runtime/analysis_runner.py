import argparse
import itertools
import json
import math
import os
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from scipy import stats
from statsmodels.stats.multitest import multipletests
from statsmodels.stats.oneway import anova_oneway

from analysis_advanced_models import run_advanced_analysis
from analysis_runtime_core import (
    AnalysisRuntimeError,
    file_sha256,
    finite_or_none,
    load_dataframe,
    package_versions,
    profile_dataframe,
    resolve_column,
    resolve_staged_path,
    transform_numeric,
)


SCHEMA_VERSION = "latotex.analysis.v2"
BOOTSTRAP_SEED = 20260729
BOOTSTRAP_ITERATIONS = 2_000
CONFIDENCE_LEVEL = 0.95
MAX_GROUPS = 12
MAX_BOOTSTRAP_ROWS = 5_000


def normality_p(values: np.ndarray) -> float | None:
    if values.size < 3:
        return None
    sample = values[:5_000]
    try:
        return finite_or_none(stats.shapiro(sample).pvalue)
    except ValueError:
        return None


def bootstrap_difference(
    left: np.ndarray,
    right: np.ndarray,
    statistic: str,
    paired: bool = False,
    seed: int = BOOTSTRAP_SEED,
) -> list[float | None]:
    rng = np.random.default_rng(seed)
    left = left[:MAX_BOOTSTRAP_ROWS]
    right = right[:MAX_BOOTSTRAP_ROWS]
    estimates: list[float] = []
    if paired:
        size = min(left.size, right.size)
        differences = left[:size] - right[:size]
        for _ in range(BOOTSTRAP_ITERATIONS):
            sample = rng.choice(differences, size=size, replace=True)
            estimates.append(float(np.mean(sample) if statistic == "mean" else np.median(sample)))
    else:
        for _ in range(BOOTSTRAP_ITERATIONS):
            left_sample = rng.choice(left, size=left.size, replace=True)
            right_sample = rng.choice(right, size=right.size, replace=True)
            left_value = np.mean(left_sample) if statistic == "mean" else np.median(left_sample)
            right_value = np.mean(right_sample) if statistic == "mean" else np.median(right_sample)
            estimates.append(float(left_value - right_value))
    low, high = np.quantile(estimates, [(1 - CONFIDENCE_LEVEL) / 2, 1 - (1 - CONFIDENCE_LEVEL) / 2])
    return [finite_or_none(low), finite_or_none(high)]


def hedges_g(left: np.ndarray, right: np.ndarray) -> float | None:
    n1, n2 = left.size, right.size
    if n1 < 2 or n2 < 2:
        return None
    pooled_variance = (
        ((n1 - 1) * np.var(left, ddof=1)) + ((n2 - 1) * np.var(right, ddof=1))
    ) / (n1 + n2 - 2)
    if pooled_variance <= 0:
        return None
    correction = 1 - (3 / (4 * (n1 + n2) - 9))
    return finite_or_none(correction * (np.mean(left) - np.mean(right)) / math.sqrt(pooled_variance))


def two_group_test(
    left: np.ndarray,
    right: np.ndarray,
    alpha: float,
    seed: int = BOOTSTRAP_SEED,
) -> dict[str, Any]:
    left_normality = normality_p(left)
    right_normality = normality_p(right)
    use_welch = (
        left.size >= 8
        and right.size >= 8
        and left_normality is not None
        and right_normality is not None
        and left_normality >= alpha
        and right_normality >= alpha
    )
    if use_welch:
        result = stats.ttest_ind(left, right, equal_var=False, nan_policy="omit")
        return {
            "test": "welch_t",
            "statistic": finite_or_none(result.statistic),
            "pValue": finite_or_none(result.pvalue),
            "effect": {"name": "hedges_g", "value": hedges_g(left, right)},
            "estimateDifference": finite_or_none(np.mean(left) - np.mean(right)),
            "confidenceInterval95": bootstrap_difference(left, right, "mean", seed=seed),
            "normalityPValues": [left_normality, right_normality],
        }
    result = stats.mannwhitneyu(left, right, alternative="two-sided")
    rank_biserial = (2 * float(result.statistic) / (left.size * right.size)) - 1
    return {
        "test": "mann_whitney_u",
        "statistic": finite_or_none(result.statistic),
        "pValue": finite_or_none(result.pvalue),
        "effect": {"name": "rank_biserial", "value": finite_or_none(rank_biserial)},
        "estimateDifference": finite_or_none(np.median(left) - np.median(right)),
        "confidenceInterval95": bootstrap_difference(left, right, "median", seed=seed),
        "normalityPValues": [left_normality, right_normality],
    }


def paired_test(
    left: np.ndarray,
    right: np.ndarray,
    alpha: float,
    seed: int = BOOTSTRAP_SEED,
) -> dict[str, Any]:
    size = min(left.size, right.size)
    left = left[:size]
    right = right[:size]
    differences = left - right
    normality = normality_p(differences)
    if size >= 8 and normality is not None and normality >= alpha:
        result = stats.ttest_rel(left, right)
        standard_deviation = float(np.std(differences, ddof=1)) if size > 1 else 0.0
        effect = finite_or_none(float(np.mean(differences)) / standard_deviation) if standard_deviation > 0 else None
        test_name = "paired_t"
        statistic = result.statistic
        p_value = result.pvalue
        effect_name = "cohens_dz"
        statistic_name = "mean"
    else:
        result = stats.wilcoxon(left, right)
        effect = finite_or_none(1 - (2 * float(result.statistic) / (size * (size + 1) / 2)))
        test_name = "wilcoxon_signed_rank"
        statistic = result.statistic
        p_value = result.pvalue
        effect_name = "matched_rank_biserial"
        statistic_name = "median"
    return {
        "test": test_name,
        "statistic": finite_or_none(statistic),
        "pValue": finite_or_none(p_value),
        "effect": {"name": effect_name, "value": effect},
        "estimateDifference": finite_or_none(np.mean(differences) if statistic_name == "mean" else np.median(differences)),
        "confidenceInterval95": bootstrap_difference(
            left,
            right,
            statistic_name,
            paired=True,
            seed=seed,
        ),
        "normalityPValues": [normality],
    }


def multi_group_test(groups: list[np.ndarray], alpha: float) -> dict[str, Any]:
    normality = [normality_p(group) for group in groups]
    use_welch = all(
        group.size >= 8 and p_value is not None and p_value >= alpha
        for group, p_value in zip(groups, normality)
    )
    if use_welch:
        result = anova_oneway(groups, use_var="unequal")
        all_values = np.concatenate(groups)
        grand_mean = float(np.mean(all_values))
        between = sum(group.size * (float(np.mean(group)) - grand_mean) ** 2 for group in groups)
        total = float(np.sum((all_values - grand_mean) ** 2))
        effect = finite_or_none(between / total) if total > 0 else None
        return {
            "test": "welch_anova",
            "statistic": finite_or_none(result.statistic),
            "pValue": finite_or_none(result.pvalue),
            "effect": {"name": "eta_squared", "value": effect},
            "normalityPValues": normality,
        }
    result = stats.kruskal(*groups)
    total_size = sum(group.size for group in groups)
    epsilon_squared = (
        (float(result.statistic) - len(groups) + 1) / (total_size - len(groups))
        if total_size > len(groups)
        else None
    )
    return {
        "test": "kruskal_wallis",
        "statistic": finite_or_none(result.statistic),
        "pValue": finite_or_none(result.pvalue),
        "effect": {"name": "epsilon_squared", "value": finite_or_none(epsilon_squared)},
        "normalityPValues": normality,
    }


def benjamini_hochberg(entries: list[dict[str, Any]], alpha: float) -> list[dict[str, Any]]:
    if not entries:
        return []
    p_values = [float(entry["pValue"]) for entry in entries]
    rejected, adjusted, _, _ = multipletests(p_values, alpha=alpha, method="fdr_bh")
    return [
        {
            **entry,
            "adjustedPValue": finite_or_none(adjusted[index]),
            "rejectAtAlpha": bool(rejected[index]),
        }
        for index, entry in enumerate(entries)
    ]


def exclude_iqr_rows(frame: pd.DataFrame, columns: list[str]) -> tuple[pd.DataFrame, int]:
    if frame.empty or not columns:
        return frame, 0
    keep = pd.Series(True, index=frame.index)
    for column in columns:
        q1, q3 = frame[column].quantile([0.25, 0.75])
        iqr = float(q3 - q1)
        if math.isfinite(iqr) and iqr > 0:
            keep &= (frame[column] >= q1 - 1.5 * iqr) & (frame[column] <= q3 + 1.5 * iqr)
    return frame.loc[keep], int((~keep).sum())


def group_analysis(
    plan: dict,
    datasets: list[dict[str, Any]],
    limitations: list[str],
    spec: dict | None = None,
) -> dict[str, Any] | None:
    target = resolve_column((plan.get("targetColumns") or [None])[0], datasets)
    grouping = resolve_column(plan.get("groupColumn"), datasets)
    if not target or not grouping or target[0] is not grouping[0]:
        limitations.append("analysis.design.group_and_target_required")
        return None
    dataset, target_column = target
    _, group_column = grouping
    selected = dataset["frame"][[target_column, group_column]].copy()
    transform_numeric(
        selected,
        [target_column],
        str((spec or {}).get("transformationStrategy") or "none"),
    )
    original_rows = int(len(selected))
    selected = selected.dropna()
    missing_rows = original_rows - int(len(selected))
    outlier_rows = 0
    if (spec or {}).get("outlierStrategy") == "exclude_iqr":
        selected, outlier_rows = exclude_iqr_rows(selected, [target_column])
    group_values = list(selected[group_column].astype(str).value_counts().index[:MAX_GROUPS])
    groups = [
        selected.loc[selected[group_column].astype(str) == value, target_column].to_numpy(dtype=float)
        for value in group_values
    ]
    groups = [group for group in groups if group.size >= 2]
    if len(groups) < 2:
        limitations.append("analysis.design.insufficient_groups")
        return None
    alpha = float(plan.get("alpha") or 0.05)
    random_seed = int((spec or {}).get("randomSeed") or BOOTSTRAP_SEED)
    if bool(plan.get("paired")) and len(groups) == 2:
        result = paired_test(groups[0], groups[1], alpha, random_seed)
    elif len(groups) == 2:
        result = two_group_test(groups[0], groups[1], alpha, random_seed)
    else:
        result = multi_group_test(groups, alpha)
    pairwise = []
    if len(groups) > 2:
        for left_index, right_index in itertools.combinations(range(len(groups)), 2):
            pair = two_group_test(groups[left_index], groups[right_index], alpha, random_seed)
            pairwise.append({
                "leftGroup": group_values[left_index],
                "rightGroup": group_values[right_index],
                "test": pair["test"],
                "pValue": pair["pValue"],
                "effect": pair["effect"],
            })
    return {
        "kind": "group_comparison",
        "sourcePath": dataset["sourcePath"],
        "targetColumn": target_column,
        "groupColumn": group_column,
        "formula": f"{target_column} ~ {group_column}",
        "includedRows": int(len(selected)),
        "groups": [
            {"label": group_values[index], "sampleSize": int(group.size)}
            for index, group in enumerate(groups)
        ],
        "excludedRows": missing_rows + outlier_rows,
        "exclusions": {"missing": missing_rows, "outlier": outlier_rows},
        "result": result,
        "pairwiseComparisons": benjamini_hochberg(pairwise, alpha),
    }


def bootstrap_correlation(
    left: np.ndarray,
    right: np.ndarray,
    method: str,
    seed: int = BOOTSTRAP_SEED,
) -> list[float | None]:
    rng = np.random.default_rng(seed)
    size = min(left.size, MAX_BOOTSTRAP_ROWS)
    left = left[:size]
    right = right[:size]
    estimates = []
    for _ in range(BOOTSTRAP_ITERATIONS):
        indices = rng.integers(0, size, size=size)
        sampled_left = left[indices]
        sampled_right = right[indices]
        if np.std(sampled_left) == 0 or np.std(sampled_right) == 0:
            continue
        value = (
            stats.pearsonr(sampled_left, sampled_right).statistic
            if method == "pearson"
            else stats.spearmanr(sampled_left, sampled_right).statistic
        )
        if math.isfinite(float(value)):
            estimates.append(float(value))
    if not estimates:
        return [None, None]
    low, high = np.quantile(estimates, [(1 - CONFIDENCE_LEVEL) / 2, 1 - (1 - CONFIDENCE_LEVEL) / 2])
    return [finite_or_none(low), finite_or_none(high)]


def relationship_analysis(
    plan: dict,
    datasets: list[dict[str, Any]],
    limitations: list[str],
    spec: dict | None = None,
) -> dict[str, Any] | None:
    resolved = [resolve_column(reference, datasets) for reference in plan.get("targetColumns") or []]
    resolved = [item for item in resolved if item is not None]
    if len(resolved) < 2 or any(item[0] is not resolved[0][0] for item in resolved):
        limitations.append("analysis.design.two_same_file_targets_required")
        return None
    dataset = resolved[0][0]
    columns = [item[1] for item in resolved]
    frame = dataset["frame"][columns].copy()
    transform_numeric(
        frame,
        columns,
        str((spec or {}).get("transformationStrategy") or "none"),
    )
    original_rows = int(len(frame))
    frame = frame.dropna()
    missing_rows = original_rows - int(len(frame))
    outlier_rows = 0
    if (spec or {}).get("outlierStrategy") == "exclude_iqr":
        frame, outlier_rows = exclude_iqr_rows(frame, columns)
    if len(frame) < 3:
        limitations.append("analysis.design.insufficient_complete_rows")
        return None
    tests = []
    random_seed = int((spec or {}).get("randomSeed") or BOOTSTRAP_SEED)
    for left_column, right_column in itertools.combinations(columns, 2):
        left = frame[left_column].to_numpy(dtype=float)
        right = frame[right_column].to_numpy(dtype=float)
        if np.std(left) == 0 or np.std(right) == 0:
            limitations.append("analysis.design.constant_relationship_column")
            continue
        pearson = stats.pearsonr(left, right)
        spearman = stats.spearmanr(left, right)
        tests.extend([
            {
                "columns": [left_column, right_column],
                "method": "pearson",
                "coefficient": finite_or_none(pearson.statistic),
                "pValue": finite_or_none(pearson.pvalue),
                "confidenceInterval95": bootstrap_correlation(left, right, "pearson", random_seed),
            },
            {
                "columns": [left_column, right_column],
                "method": "spearman",
                "coefficient": finite_or_none(spearman.statistic),
                "pValue": finite_or_none(spearman.pvalue),
                "confidenceInterval95": bootstrap_correlation(left, right, "spearman", random_seed),
            },
        ])
    return {
        "kind": "relationship",
        "sourcePath": dataset["sourcePath"],
        "columns": columns,
        "formula": "correlation(" + ", ".join(columns) + ")",
        "completeRows": int(len(frame)),
        "includedRows": int(len(frame)),
        "excludedRows": missing_rows + outlier_rows,
        "exclusions": {"missing": missing_rows, "outlier": outlier_rows},
        "tests": benjamini_hochberg(tests, float(plan.get("alpha") or 0.05)),
    }


def build_profile(payload: dict, input_path: Path) -> dict:
    plan = payload.get("plan") or {}
    staged_files = payload.get("stagedFiles") or []
    spec = plan.get("spec") if isinstance(plan.get("spec"), dict) else None
    method_family = str((spec or {}).get("methodFamily") or "")
    if not staged_files and method_family != "power_analysis":
        raise AnalysisRuntimeError("analysis.runtime.inputs_missing")
    datasets = []
    provenance_inputs = []
    profiles = []
    kind_histogram: dict[str, int] = {}
    for item in staged_files:
        path = resolve_staged_path(input_path.parent, str(item.get("stagedPath") or ""))
        expected_sha256 = str(item.get("sha256") or "").lower()
        actual_sha256 = file_sha256(path)
        if expected_sha256 != actual_sha256:
            raise AnalysisRuntimeError("analysis.runtime.input_hash_mismatch")
        frame = load_dataframe(path)
        source_path = str(item.get("sourcePath") or "")
        extension = path.suffix.lower().lstrip(".")
        kind_histogram[extension] = kind_histogram.get(extension, 0) + 1
        datasets.append({"sourcePath": source_path, "frame": frame})
        profiles.append(profile_dataframe(source_path, frame))
        provenance_inputs.append({
            "sourcePath": source_path,
            "sha256": actual_sha256,
            "sizeBytes": int(item.get("sizeBytes") or path.stat().st_size),
            "rows": int(len(frame)),
            "columns": int(len(frame.columns)),
        })

    limitations: list[str] = []
    missing_strategy = str(plan.get("missingValueStrategy") or "complete_case")
    if spec and method_family != "descriptive" and not bool(spec.get("approvalConfirmed")):
        raise AnalysisRuntimeError("analysis.runtime.approval_required")
    if missing_strategy == "report_only" and method_family not in {"descriptive", "power_analysis"}:
        limitations.append("analysis.missing.report_only_no_inference")
        inference = None
    elif method_family == "descriptive":
        limitations.append("analysis.design.descriptive_only")
        inference = None
    elif method_family == "group_comparison":
        spec_plan = {
            **plan,
            "targetColumns": [spec.get("outcome")],
            "groupColumn": spec.get("groupColumn"),
        }
        inference = group_analysis(spec_plan, datasets, limitations, spec)
    elif method_family == "relationship":
        spec_plan = {
            **plan,
            "targetColumns": [
                spec.get("outcome"),
                *(spec.get("predictors") or []),
                *(spec.get("covariates") or []),
            ],
        }
        inference = relationship_analysis(spec_plan, datasets, limitations, spec)
    elif spec:
        inference = run_advanced_analysis(spec, datasets)
    elif plan.get("groupColumn") and plan.get("targetColumns"):
        inference = group_analysis(plan, datasets, limitations)
    elif len(plan.get("targetColumns") or []) >= 2:
        inference = relationship_analysis(plan, datasets, limitations)
    else:
        limitations.append("analysis.design.descriptive_only")
        inference = None

    exclusions = []
    if inference:
        for reason, count in (inference.get("exclusions") or {}).items():
            if int(count or 0) > 0:
                exclusions.append({"reason": str(reason), "count": int(count)})
        if not exclusions and int(inference.get("excludedRows") or 0) > 0:
            exclusions.append({
                "reason": "missing_values_complete_case",
                "count": int(inference["excludedRows"]),
            })
    normalized_spec = {
        **spec,
        "approvalConfirmed": bool(spec.get("approvalConfirmed")),
    } if spec else None
    if inference and method_family not in {"", "descriptive", "power_analysis"}:
        limitations.append("analysis.limitations.model_conditional")
    return {
        "schemaVersion": SCHEMA_VERSION,
        "runtimeSource": "uv",
        "status": "completed",
        "outputLanguage": str(payload.get("outputLanguage") or "English"),
        "fileCount": len(datasets),
        "kindHistogram": kind_histogram,
        "rowsTotal": sum(item["rows"] for item in profiles),
        "columnsTotal": sum(item["columns"] for item in profiles),
        "plan": {
            "intent": str(plan.get("intent") or ""),
            "inputFiles": list(plan.get("inputFiles") or []),
            "targetColumns": list(plan.get("targetColumns") or []),
            "groupColumn": plan.get("groupColumn"),
            "paired": plan.get("paired"),
            "missingValueStrategy": missing_strategy,
            "alpha": finite_or_none(plan.get("alpha") or 0.05),
            "spec": normalized_spec,
        },
        "files": profiles,
        "analysis": inference or {"kind": "descriptive_only"},
        "sampleExclusions": exclusions,
        "assumptions": {
            "normalityThreshold": finite_or_none(plan.get("alpha") or 0.05),
            "completeCaseForInference": missing_strategy == "complete_case",
            "automaticImputation": False,
            "transformationStrategy": (spec or {}).get("transformationStrategy", "none"),
            "outlierStrategy": (spec or {}).get("outlierStrategy", "report_only"),
            "multipleComparisonStrategy": (spec or {}).get("multipleComparisonStrategy", "none"),
        },
        "methodology": {
            "methodFamily": method_family or (inference or {}).get("kind", "descriptive"),
            "formula": (inference or {}).get("formula"),
            "rationale": str((spec or {}).get("rationale") or plan.get("intent") or ""),
        },
        "limitations": limitations,
        "reproducibility": {
            "inputFiles": provenance_inputs,
            "pythonVersion": sys.version.split()[0],
            "packageVersions": package_versions(),
            "bootstrapSeed": int((spec or {}).get("randomSeed") or BOOTSTRAP_SEED),
            "bootstrapIterations": BOOTSTRAP_ITERATIONS,
            "confidenceLevel": CONFIDENCE_LEVEL,
            "alpha": finite_or_none(plan.get("alpha") or 0.05),
            "steps": [
                {"order": 1, "action": "verify_input_hashes"},
                {"order": 2, "action": "apply_approved_data_strategies"},
                {"order": 3, "action": "fit_approved_method"},
                {"order": 4, "action": "review_diagnostics_and_provenance"},
            ],
        },
        "recommendations": [
            "Treat inferential results as conditional on the explicit analysis plan.",
            "Review missing-value exclusions, assumptions, effect sizes, and confidence intervals.",
            "Do not infer causal conclusions from observational associations.",
        ],
    }


def atomic_write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    encoded = json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False).encode("utf-8")
    with temporary.open("wb") as stream:
        stream.write(encoded)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    input_path = Path(args.input).resolve(strict=True)
    output_path = Path(args.output)
    payload = json.loads(input_path.read_text(encoding="utf-8"))
    try:
        profile = build_profile(payload, input_path)
        atomic_write_json(output_path, profile)
        print(json.dumps({"status": "ok", "fileCount": profile["fileCount"]}, ensure_ascii=False))
        return 0
    except AnalysisRuntimeError as error:
        atomic_write_json(output_path, {
            "schemaVersion": SCHEMA_VERSION,
            "status": "failed",
            "error": {"code": error.code},
        })
        print(json.dumps({"status": "failed", "code": error.code}), file=sys.stderr)
        return 1
    except Exception:
        atomic_write_json(output_path, {
            "schemaVersion": SCHEMA_VERSION,
            "status": "failed",
            "error": {"code": "analysis.runtime.unexpected"},
        })
        print(json.dumps({"status": "failed", "code": "analysis.runtime.unexpected"}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
