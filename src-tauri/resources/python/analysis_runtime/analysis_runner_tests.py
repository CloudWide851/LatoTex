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
    ) -> dict:
        staged_path = self.inputs_root / staged_name
        return {
            "outputLanguage": "English",
            "plan": {
                "intent": "deterministic fixture",
                "inputFiles": [source_path],
                "targetColumns": target_columns or [],
                "groupColumn": group_column,
                "paired": paired,
                "missingValueStrategy": missing_strategy,
                "alpha": 0.05,
            },
            "stagedFiles": [{
                "sourcePath": source_path,
                "stagedPath": f"inputs/{staged_name}",
                "sha256": sha256(staged_path),
                "sizeBytes": staged_path.stat().st_size,
            }],
        }

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


if __name__ == "__main__":
    unittest.main()
