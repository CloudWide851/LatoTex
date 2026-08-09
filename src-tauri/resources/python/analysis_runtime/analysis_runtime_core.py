import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


MAX_PROFILE_COLUMNS = 200


class AnalysisRuntimeError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def finite_or_none(value: Any) -> float | int | None:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(numeric):
        return None
    return int(numeric) if numeric.is_integer() else numeric


def package_versions() -> dict[str, str]:
    names = ["numpy", "pandas", "scipy", "statsmodels", "openpyxl"]
    versions: dict[str, str] = {}
    for name in names:
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            versions[name] = "missing"
    return versions


def resolve_staged_path(run_root: Path, relative_path: str) -> Path:
    normalized = str(relative_path or "").replace("\\", "/").strip()
    if not normalized or normalized.startswith("/") or ".." in Path(normalized).parts:
        raise AnalysisRuntimeError("analysis.runtime.invalid_staged_path")
    resolved_root = run_root.resolve(strict=True)
    candidate = (resolved_root / normalized).resolve(strict=True)
    if resolved_root not in candidate.parents or not candidate.is_file():
        raise AnalysisRuntimeError("analysis.runtime.invalid_staged_path")
    return candidate


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def load_dataframe(path: Path) -> pd.DataFrame:
    extension = path.suffix.lower()
    if extension == ".csv":
        frame = pd.read_csv(path, low_memory=False)
    elif extension == ".tsv":
        frame = pd.read_csv(path, sep="\t", low_memory=False)
    elif extension in {".xlsx", ".xlsm"}:
        frame = pd.read_excel(path, engine="openpyxl")
    elif extension == ".jsonl":
        frame = pd.read_json(path, lines=True)
    elif extension == ".json":
        try:
            frame = pd.read_json(path)
        except ValueError:
            payload = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(payload, list):
                frame = pd.DataFrame(payload)
            elif isinstance(payload, dict):
                frame = pd.json_normalize(payload)
            else:
                raise AnalysisRuntimeError("analysis.runtime.json_shape_unsupported")
    else:
        raise AnalysisRuntimeError("analysis.runtime.unsupported_type")
    frame.columns = [str(column) for column in frame.columns]
    return frame


def numeric_profile(series: pd.Series) -> dict[str, Any]:
    values = pd.to_numeric(series, errors="coerce").astype(float)
    valid = values.dropna()
    result: dict[str, Any] = {
        "count": int(valid.size),
        "missingCount": int(values.isna().sum()),
    }
    if valid.empty:
        return result
    quartiles = valid.quantile([0.25, 0.5, 0.75])
    q1 = float(quartiles.loc[0.25])
    q3 = float(quartiles.loc[0.75])
    iqr = q3 - q1
    outliers = valid[(valid < q1 - 1.5 * iqr) | (valid > q3 + 1.5 * iqr)]
    result.update({
        "mean": finite_or_none(valid.mean()),
        "std": finite_or_none(valid.std(ddof=1)),
        "min": finite_or_none(valid.min()),
        "q1": finite_or_none(q1),
        "median": finite_or_none(quartiles.loc[0.5]),
        "q3": finite_or_none(q3),
        "max": finite_or_none(valid.max()),
        "skewness": finite_or_none(valid.skew()),
        "kurtosis": finite_or_none(valid.kurtosis()),
        "iqrOutlierCount": int(outliers.size),
    })
    return result


def profile_dataframe(source_path: str, frame: pd.DataFrame) -> dict[str, Any]:
    row_count = int(len(frame.index))
    columns = list(frame.columns)[:MAX_PROFILE_COLUMNS]
    column_profiles = []
    for column in columns:
        series = frame[column]
        missing_count = int(series.isna().sum())
        profile: dict[str, Any] = {
            "name": column,
            "dtype": str(series.dtype),
            "missingCount": missing_count,
            "missingRate": finite_or_none(missing_count / row_count) if row_count else None,
            "uniqueCount": int(series.nunique(dropna=True)),
        }
        numeric = pd.to_numeric(series, errors="coerce")
        if numeric.notna().sum() > 0:
            profile["numeric"] = numeric_profile(series)
        else:
            top = series.dropna().astype(str).value_counts().head(8)
            profile["topValues"] = [
                {"value": str(value)[:160], "count": int(count)}
                for value, count in top.items()
            ]
        column_profiles.append(profile)
    return {
        "sourcePath": source_path,
        "rows": row_count,
        "columns": int(len(frame.columns)),
        "duplicateRows": int(frame.duplicated().sum()),
        "columnProfiles": column_profiles,
        "profiledColumnCount": len(column_profiles),
        "truncatedColumns": max(0, int(len(frame.columns)) - len(column_profiles)),
    }


def resolve_column(
    reference: str | None,
    datasets: list[dict[str, Any]],
) -> tuple[dict[str, Any], str] | None:
    normalized = str(reference or "").strip()
    if not normalized:
        return None
    exact_matches = []
    for dataset in datasets:
        prefix = f"{dataset['sourcePath']}:"
        if normalized.startswith(prefix) and normalized[len(prefix):] in dataset["frame"].columns:
            return dataset, normalized[len(prefix):]
        if normalized in dataset["frame"].columns:
            exact_matches.append((dataset, normalized))
    return exact_matches[0] if len(exact_matches) == 1 else None


def transform_numeric(frame: pd.DataFrame, columns: list[str], strategy: str) -> None:
    for column in columns:
        values = pd.to_numeric(frame[column], errors="coerce")
        if strategy == "log":
            if (values.dropna() <= 0).any():
                raise AnalysisRuntimeError("analysis.runtime.log_nonpositive")
            frame[column] = np.log(values)
        elif strategy == "standardize":
            deviation = float(values.std(ddof=1))
            if not math.isfinite(deviation) or deviation <= 0:
                raise AnalysisRuntimeError("analysis.runtime.constant_predictor")
            frame[column] = (values - float(values.mean())) / deviation
        else:
            frame[column] = values
