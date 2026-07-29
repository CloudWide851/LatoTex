---
name: statistical-analysis
description: Design and review defensible statistical analyses. Use for dataset profiling, test selection, effect sizes, confidence intervals, missing-data handling, and interpretation.
---

# Statistical Analysis

## Analysis workflow

1. Confirm the analysis intent, unit of observation, target columns, grouping, pairing, missing-value policy, and significance level.
2. Inspect types, missingness, duplicates, distributions, and outliers before inference.
3. Choose tests from the declared study design and assumptions. If design information is incomplete, stop at descriptive statistics.
4. Report effect sizes and confidence intervals alongside p-values. Correct planned families of multiple comparisons.
5. Keep preprocessing, exclusions, random seed, software versions, and input hashes in the result.

## Interpretation rules

- Do not silently impute missing values; default inferential analysis to complete cases and report exclusions.
- Do not infer causality from observational associations.
- Do not describe a non-significant result as proof of no effect.
- Prefer robust or non-parametric alternatives when assumptions are not defensible.
- Separate computed results from scientific interpretation and list material limitations.
