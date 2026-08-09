import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import pandas as pd

from analysis_runner import AnalysisRuntimeError, build_profile


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class AnalysisRunnerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="latotex-analysis-test-")
        self.run_root = Path(self.temporary.name)
        self.inputs_root = self.run_root / "inputs"
        self.inputs_root.mkdir(parents=True)
        self.input_path = self.run_root / "input.json"
        self.input_path.write_text("{}", encoding="utf-8")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def payload(
        self,
        source_path: str,
        staged_name: str,
        *,
        target_columns: list[str] | None = None,
        group_column: str | None = None,
        paired: bool | None = None,
        missing_strategy: str = "complete_case",
        spec: dict | None = None,
    ) -> dict:
        staged_path = self.inputs_root / staged_name
        payload = {
            "outputLanguage": "English",
            "plan": {
                "intent": "deterministic fixture",
                "inputFiles": [source_path],
                "targetColumns": target_columns or [],
                "groupColumn": group_column,
                "paired": paired,
                "missingValueStrategy": missing_strategy,
                "alpha": 0.05,
                "spec": spec,
            },
            "stagedFiles": [{
                "sourcePath": source_path,
                "stagedPath": f"inputs/{staged_name}",
                "sha256": sha256(staged_path),
                "sizeBytes": staged_path.stat().st_size,
            }],
        }
        return payload

    def analysis_spec(self, method_family: str, **overrides: object) -> dict:
        spec = {
            "methodFamily": method_family,
            "outcome": None,
            "predictors": [],
            "covariates": [],
            "groupColumn": None,
            "subjectColumn": None,
            "timeColumn": None,
            "eventColumn": None,
            "effectColumn": None,
            "standardErrorColumn": None,
            "glmFamily": None,
            "glmLink": None,
            "missingValueStrategy": "complete_case",
            "transformationStrategy": "none",
            "outlierStrategy": "report_only",
            "multipleComparisonStrategy": "none",
            "alpha": 0.05,
            "power": None,
            "randomSeed": 20260729,
            "rationale": "Deterministic approved fixture",
            "approvalConfirmed": True,
        }
        spec.update(overrides)
        return spec

    def test_two_group_fixture_is_deterministic_and_reports_provenance(self) -> None:
        staged_name = "groups.csv"
        pd.DataFrame({
            "group": ["A"] * 12 + ["B"] * 12,
            "outcome": list(range(10, 22)) + list(range(20, 32)),
        }).to_csv(self.inputs_root / staged_name, index=False)
        payload = self.payload(
            "data/groups.csv",
            staged_name,
            target_columns=["data/groups.csv:outcome"],
            group_column="data/groups.csv:group",
            paired=False,
        )

        first = build_profile(payload, self.input_path)
        second = build_profile(payload, self.input_path)

        self.assertEqual(first["analysis"], second["analysis"])
        self.assertEqual(first["analysis"]["kind"], "group_comparison")
        self.assertEqual(first["analysis"]["result"]["test"], "welch_t")
        self.assertEqual(first["reproducibility"]["bootstrapSeed"], 20260729)
        self.assertEqual(first["reproducibility"]["bootstrapIterations"], 2_000)
        self.assertEqual(
            first["reproducibility"]["inputFiles"][0]["sha256"],
            sha256(self.inputs_root / staged_name),
        )
        self.assertIsNotNone(first["analysis"]["result"]["effect"]["value"])
        self.assertEqual(len(first["analysis"]["result"]["confidenceInterval95"]), 2)

    def test_small_non_normal_groups_use_mann_whitney_and_count_missing_rows(self) -> None:
        staged_name = "missing.csv"
        pd.DataFrame({
            "group": ["A", "A", "A", "B", "B", "B", "B"],
            "outcome": [1, 1, None, 2, 2, 100, None],
        }).to_csv(self.inputs_root / staged_name, index=False)
        result = build_profile(
            self.payload(
                "missing.csv",
                staged_name,
                target_columns=["missing.csv:outcome"],
                group_column="missing.csv:group",
            ),
            self.input_path,
        )

        self.assertEqual(result["analysis"]["result"]["test"], "mann_whitney_u")
        self.assertEqual(result["analysis"]["excludedRows"], 2)
        self.assertEqual(result["sampleExclusions"][0]["count"], 2)
        self.assertFalse(result["assumptions"]["automaticImputation"])

    def test_approved_seed_controls_bootstrap_and_provenance(self) -> None:
        staged_name = "seeded-groups.csv"
        pd.DataFrame({
            "group": ["A"] * 10 + ["B"] * 10,
            "outcome": [1, 2, 2, 4, 5, 7, 8, 9, 11, 13, 3, 5, 6, 8, 9, 10, 12, 14, 15, 18],
        }).to_csv(self.inputs_root / staged_name, index=False)
        source = "seeded-groups.csv"
        spec = self.analysis_spec(
            "group_comparison",
            outcome=f"{source}:outcome",
            groupColumn=f"{source}:group",
            multipleComparisonStrategy="benjamini_hochberg",
            randomSeed=101,
        )
        first = build_profile(self.payload(
            source,
            staged_name,
            target_columns=[f"{source}:outcome"],
            group_column=f"{source}:group",
            spec=spec,
        ), self.input_path)
        spec["randomSeed"] = 202
        second = build_profile(self.payload(
            source,
            staged_name,
            target_columns=[f"{source}:outcome"],
            group_column=f"{source}:group",
            spec=spec,
        ), self.input_path)

        self.assertEqual(first["reproducibility"]["bootstrapSeed"], 101)
        self.assertEqual(second["reproducibility"]["bootstrapSeed"], 202)
        self.assertNotEqual(
            first["analysis"]["result"]["confidenceInterval95"],
            second["analysis"]["result"]["confidenceInterval95"],
        )

    def test_relationship_reports_pearson_spearman_ci_and_bh(self) -> None:
        staged_name = "relationship.jsonl"
        rows = [
            {"x": value, "y": value * 2 + (value % 3), "z": 50 - value}
            for value in range(1, 31)
        ]
        (self.inputs_root / staged_name).write_text(
            "\n".join(json.dumps(row) for row in rows),
            encoding="utf-8",
        )
        result = build_profile(
            self.payload(
                "relationship.jsonl",
                staged_name,
                target_columns=[
                    "relationship.jsonl:x",
                    "relationship.jsonl:y",
                    "relationship.jsonl:z",
                ],
            ),
            self.input_path,
        )

        tests = result["analysis"]["tests"]
        self.assertEqual(result["analysis"]["kind"], "relationship")
        self.assertEqual({item["method"] for item in tests}, {"pearson", "spearman"})
        self.assertTrue(all("adjustedPValue" in item for item in tests))
        self.assertTrue(all(len(item["confidenceInterval95"]) == 2 for item in tests))

    def test_incomplete_design_degrades_to_descriptive_only(self) -> None:
        staged_name = "descriptive.xlsx"
        pd.DataFrame({"value": [1, 2, 3], "label": ["a", "b", "c"]}).to_excel(
            self.inputs_root / staged_name,
            index=False,
        )
        result = build_profile(
            self.payload("descriptive.xlsx", staged_name),
            self.input_path,
        )

        self.assertEqual(result["analysis"]["kind"], "descriptive_only")
        self.assertIn("analysis.design.descriptive_only", result["limitations"])
        self.assertEqual(result["files"][0]["rows"], 3)

    def test_hash_mismatch_is_rejected_before_parsing(self) -> None:
        staged_name = "tampered.csv"
        (self.inputs_root / staged_name).write_text("value\n1\n", encoding="utf-8")
        payload = self.payload("tampered.csv", staged_name)
        payload["stagedFiles"][0]["sha256"] = "0" * 64

        with self.assertRaisesRegex(
            AnalysisRuntimeError,
            "analysis.runtime.input_hash_mismatch",
        ):
            build_profile(payload, self.input_path)

    def test_regression_and_glm_families_are_deterministic(self) -> None:
        staged_name = "regression.csv"
        rows = []
        for index in range(1, 61):
            x_value = (index - 30) / 10
            rows.append({
                "x": x_value,
                "linear": 2 + 1.4 * x_value + ((index % 5) - 2) * 0.08,
                "binary": 1 if (index * 7) % 10 < 5 + x_value else 0,
                "count": max(0, int(round(3 + 0.4 * x_value + (index % 4)))),
            })
        pd.DataFrame(rows).to_csv(self.inputs_root / staged_name, index=False)
        cases = [
            ("linear_regression", "linear", "gaussian", "identity"),
            ("glm", "linear", "gaussian", "identity"),
            ("logistic_regression", "binary", "binomial", "logit"),
            ("poisson_regression", "count", "poisson", "log"),
        ]
        for method, outcome, family, link in cases:
            with self.subTest(method=method):
                source = "data/regression.csv"
                spec = self.analysis_spec(
                    method,
                    outcome=f"{source}:{outcome}",
                    predictors=[f"{source}:x"],
                    glmFamily=family,
                    glmLink=link,
                )
                payload = self.payload(source, staged_name, spec=spec)
                first = build_profile(payload, self.input_path)
                second = build_profile(payload, self.input_path)
                self.assertEqual(first["analysis"], second["analysis"])
                self.assertEqual(first["analysis"]["kind"], method)
                self.assertEqual(first["analysis"]["diagnostics"]["family"], family)
                self.assertTrue(first["analysis"]["coefficients"])

    def test_mixed_model_reports_groups_and_reproducibility(self) -> None:
        staged_name = "mixed.csv"
        rows = []
        for subject in range(10):
            for visit in range(5):
                rows.append({
                    "subject": f"S{subject:02d}",
                    "x": visit,
                    "y": 5 + subject * 0.35 + visit * 0.8 + ((subject + visit) % 3) * 0.05,
                })
        pd.DataFrame(rows).to_csv(self.inputs_root / staged_name, index=False)
        source = "mixed.csv"
        spec = self.analysis_spec(
            "mixed_model",
            outcome=f"{source}:y",
            predictors=[f"{source}:x"],
            subjectColumn=f"{source}:subject",
        )
        result = build_profile(self.payload(source, staged_name, spec=spec), self.input_path)
        self.assertEqual(result["analysis"]["kind"], "mixed_model")
        self.assertEqual(result["analysis"]["diagnostics"]["groupCount"], 10)
        self.assertTrue(result["analysis"]["diagnostics"]["converged"])

    def test_survival_model_reports_events_and_hazard_ratio(self) -> None:
        staged_name = "survival.csv"
        rows = [
            {"duration": 4 + index * 0.7 + (index % 3), "event": index % 4 != 0, "x": (index % 7) - 3}
            for index in range(1, 41)
        ]
        pd.DataFrame(rows).to_csv(self.inputs_root / staged_name, index=False)
        source = "survival.csv"
        spec = self.analysis_spec(
            "survival",
            outcome=f"{source}:duration",
            predictors=[f"{source}:x"],
            eventColumn=f"{source}:event",
        )
        result = build_profile(self.payload(source, staged_name, spec=spec), self.input_path)
        self.assertEqual(result["analysis"]["kind"], "survival")
        self.assertGreater(result["analysis"]["diagnostics"]["eventCount"], 1)
        self.assertIsNotNone(result["analysis"]["coefficients"][0]["hazardRatio"])

    def test_time_series_reports_ordered_arima_diagnostics(self) -> None:
        staged_name = "series.csv"
        pd.DataFrame({
            "time": list(range(30)),
            "value": [10 + index * 0.3 + ((index % 6) - 3) * 0.2 for index in range(30)],
        }).to_csv(self.inputs_root / staged_name, index=False)
        source = "series.csv"
        spec = self.analysis_spec(
            "time_series",
            outcome=f"{source}:value",
            timeColumn=f"{source}:time",
        )
        result = build_profile(self.payload(source, staged_name, spec=spec), self.input_path)
        self.assertEqual(result["analysis"]["kind"], "time_series")
        self.assertIsNotNone(result["analysis"]["diagnostics"]["aic"])
        self.assertIn("ARIMA(1,0,0)", result["analysis"]["formula"])

    def test_meta_analysis_reports_heterogeneity_and_p_value(self) -> None:
        staged_name = "meta.csv"
        pd.DataFrame({
            "effect": [0.18, 0.24, 0.31, 0.15, 0.28, 0.22],
            "se": [0.08, 0.07, 0.09, 0.06, 0.08, 0.07],
        }).to_csv(self.inputs_root / staged_name, index=False)
        source = "meta.csv"
        spec = self.analysis_spec(
            "meta_analysis",
            effectColumn=f"{source}:effect",
            standardErrorColumn=f"{source}:se",
        )
        result = build_profile(self.payload(source, staged_name, spec=spec), self.input_path)
        self.assertEqual(result["analysis"]["kind"], "meta_analysis")
        self.assertIsNotNone(result["analysis"]["effect"]["pValue"])
        self.assertGreaterEqual(result["analysis"]["diagnostics"]["iSquared"], 0)

    def test_power_analysis_requires_no_input_file(self) -> None:
        spec = self.analysis_spec(
            "power_analysis",
            power={
                "effectSize": 0.5,
                "targetPower": 0.8,
                "groupRatio": 1,
                "alternative": "two-sided",
            },
        )
        payload = {
            "outputLanguage": "English",
            "plan": {
                "intent": "Estimate sample size",
                "inputFiles": [],
                "targetColumns": [],
                "missingValueStrategy": "complete_case",
                "alpha": 0.05,
                "spec": spec,
            },
            "stagedFiles": [],
        }
        result = build_profile(payload, self.input_path)
        self.assertEqual(result["analysis"]["kind"], "power_analysis")
        self.assertEqual(result["fileCount"], 0)
        self.assertGreater(result["analysis"]["diagnostics"]["total"], 0)

    def test_approved_transformation_rejects_a_singular_predictor(self) -> None:
        staged_name = "singular.csv"
        pd.DataFrame({"x": [1] * 12, "y": list(range(12))}).to_csv(
            self.inputs_root / staged_name,
            index=False,
        )
        source = "singular.csv"
        spec = self.analysis_spec(
            "linear_regression",
            outcome=f"{source}:y",
            predictors=[f"{source}:x"],
            glmFamily="gaussian",
            glmLink="identity",
            transformationStrategy="standardize",
        )
        with self.assertRaisesRegex(
            AnalysisRuntimeError,
            "analysis.runtime.constant_predictor",
        ):
            build_profile(self.payload(source, staged_name, spec=spec), self.input_path)


if __name__ == "__main__":
    unittest.main()
