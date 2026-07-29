---
name: research-reproducibility
description: Make research workflows traceable and repeatable. Use for analysis provenance, environment capture, deterministic execution, artifact checks, and reproducibility review.
---

# Research Reproducibility

## Reproducibility workflow

1. Record each input's project-relative path and SHA-256 hash.
2. Record software and dependency versions, parameters, filters, exclusions, and missing-data decisions.
3. Use fixed seeds for stochastic procedures and identify every stochastic step.
4. Keep generated tables, figures, logs, and reports linked to the exact inputs and plan.
5. Verify that another run with the same staged inputs and environment produces equivalent structured results.

## Output contract

- Include a compact provenance block with timestamps, versions, hashes, parameters, and seed.
- Distinguish source data from controlled staged copies and derived artifacts.
- Report validation failures and environment drift explicitly.
- Never claim reproducibility when inputs, versions, or key parameters are unavailable.
- Prefer machine-readable structured results plus a human-readable interpretation.
