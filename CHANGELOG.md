# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning.

## [Unreleased]

## [0.1.4] - 2026-08-04

### Added

- Added trusted, opt-in Codex CLI and Claude Code CLI runtimes to the scientific plugin marketplace, with canonical Windows executable detection, provider-specific version/authentication probes, Profile-level runtime selection, interactive project terminals, bounded JSON/JSONL streaming, cancellation, timeout, and pre-output fallback to the native Agent.
- Added a loopback-only LatoTex MCP broker for external Agents. Project/run/profile-scoped capability tokens expose bounded workspace reads, hybrid knowledge retrieval, academic search, citation audit, read-only submission checks, and approved deterministic data analysis while keeping WorkspaceFs, network, Python, citation, and submission policy in the backend.
- Added the Agent Profile control center and bounded multi-Agent task graphs, reproducible statistical analysis, multi-source academic evidence, configurable paper comparison synchronization, scientific MATLAB/R/Octave/Julia/Quarto/Jupyter/Zotero integrations, and a project-isolated knowledge workbench with hybrid RAG, citations, backlinks, topics, and optional local multilingual embeddings.
- Added cited network research across local Bib, OpenAlex, Crossref, arXiv, Semantic Scholar, Europe PMC, PubMed, DOAJ, DBLP, OpenAIRE, optional Unpaywall, DuckDuckGo, and Wikipedia, with source-specific ranking, persistent caches, partial-failure reporting, controlled full-text retrieval, and evidence provenance.

### Changed

- Simplified the Agent page to a compact Profile/configuration two-column workspace, moved refresh into the Profile toolbar, removed the title/helper chrome and health/recent-runs sidebar, and retained only Profile/workflow tabs at narrow widths.
- Reworked terminal startup and session handling around immediate project-root PowerShell, explicit research-environment activation, localized sequence names, a resizable session rail, persistent launch kinds/custom titles, and independent Codex/Claude terminals.
- Upgraded the former paper library into a lazy knowledge workbench while preserving the internal `library` page id, existing paper viewer sessions, local-first PDF/Bib behavior, and project isolation.
- Restricted tag releases to unsigned Windows x64 NSIS artifacts built for `x86_64-pc-windows-msvc`; GitHub Release notes are now extracted from this changelog section.

### Fixed

- Fixed terminal square icon alignment and restored a viewport-safe session context menu with rename, restart, close, and close-other actions that stop real PTYs before removing tabs.
- Fixed managed Python initialization isolation, bundled uv selection, single-flight preparation, verified readiness stamps, mirror fallback, and structured localized diagnostics.
- Fixed Telegram connectivity on Windows by resolving WinINET/PAC before inherited proxy environment variables, and moved Bot Tokens into verified secure storage.
- Fixed installed-app smoke isolation, packaged resource completeness, search-index readiness, knowledge retrieval performance, shared viewer behavior, accessible dialogs/selects, and permission-resumable Agent execution across the unreleased `v0.1.3..v0.1.4` commit range.

### Security

- Centralized WorkspaceFs containment, Windows reparse rejection, quotas, atomic writes, final-sink log redaction, exact share Origins, owner-token rotation, DPAPI fallback-key protection, remote-content SSRF controls, and trusted plugin/runtime validation.
- External CLI prompts use stdin, fixed arguments, bounded sanitized output, killable Windows process trees, short-lived/revocable MCP tokens, and no LatoTex access to provider credentials. No retry or fallback occurs after output begins.
- Hardened the standalone MCP compatibility script with canonical project roots, link/escape rejection, bounded UTF-8 reads/results, atomic writes, sanitized failures, and explicit opt-in for write or compile operations.

### Validation

- Release-quality local validation passed serially:
  - focused frontend tests (5 files / 11 tests), standalone MCP tests (3/3), focused MCP Rust tests (4/4), and Profile-bounded MCP tool tests (1/1)
  - `pnpm arch:check`, `pnpm typecheck`, `CI=true pnpm test:unit` (150 files / 455 tests), `pnpm build`, `pnpm perf:baseline`, `pnpm research:eval`, and `pnpm security:scan`
  - research retrieval exact recall `1.000`, Recall@20 `1.000`, PassageRecall@40 `1.000`, nDCG@20 `0.981`, and citation coverage `1.000`
  - `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` and `cargo test --manifest-path src-tauri/Cargo.toml --jobs 1` (308 passed; one intentionally ignored online model smoke)
  - `pnpm release:check:win-x64`, explicit `pnpm tauri build --target x86_64-pc-windows-msvc --bundles nsis`, independent Tauri smoke, and sandbox-outside NSIS install/bundled-uv/WebView/uninstall smoke
- Local trusted CLI probes made no model requests: Codex CLI `0.139.0` and Claude Code `2.1.179` were available and authenticated.
- Local Windows x64 artifacts:
  - `src-tauri/target/x86_64-pc-windows-msvc/release/latotex.exe`: 104,184,320 bytes, SHA-256 `0EB0FC58F9E2FF0854E0BB4302626DA57CF6DB03645D8B55F1B565E63EE95ADA`
  - `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/LatoTex_0.1.4_x64-setup.exe`: 255,367,183 bytes, SHA-256 `FF569FCC558DBA00BEFC3E53ACAD91E743C0D0E262DDB70AB7E431484FEDF9C9`

## [0.1.3] - 2026-06-14

### Added

- Added a Submission Evidence Bundle next to the Journal Readiness Kit output, writing localized `submission-evidence.md` and structured `submission-evidence.json` files beside the existing submission manifest/source package.
- Added a first-screen research status strip that shows the active manuscript, readiness score, blocker count, current next action, and direct routing to compile repair, blocker inspection, or evidence bundle creation.
- Added `time_to_project_search_ready_ms` frontend telemetry for the focused project search-index warmup, surfaced beside the existing editable-TeX metric and logged to runtime diagnostics.

### Changed

- Bumped desktop and package versions to `0.1.3` across npm, Tauri config, root/local Rust crate manifests, and Cargo lock package metadata.
- Kept the release differentiation centered on local-first manuscript readiness rather than generic Agent positioning: the submission kit now carries source packaging plus auditable evidence artifacts.

### Validation

- Release-quality local validation for the final 0.1.3 candidate passed:
  - focused Vitest coverage for evidence bundle generation, next-action routing, and i18n parity
  - `pnpm typecheck`
  - `pnpm arch:check`
  - `$env:CI='true'; pnpm test:unit` (103 files / 329 tests)
  - `pnpm build`
  - `pnpm perf:baseline`
  - `pnpm research:eval`
  - `pnpm security:scan`
  - `cargo test --manifest-path src-tauri/Cargo.toml` (155 tests)
  - `pnpm release:check:win-x64`
- Local Windows x64 NSIS validation artifact: `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/LatoTex_0.1.3_x64-setup.exe`, SHA-256 `ccc82aa10fde5f33c8e03cc0bcf1a54bc5ce1fd9d619a17e0e1fd2fb9cce4c51`.
- Main CI passed for commit `297ec4f`: https://github.com/CloudWide851/LatoTex/actions/runs/27504767567.
- Release workflow passed for tag `v0.1.3`: https://github.com/CloudWide851/LatoTex/actions/runs/27504772080.
- Published GitHub Release `v0.1.3` from GitHub Actions artifacts: https://github.com/CloudWide851/LatoTex/releases/tag/v0.1.3.
- GitHub Actions release asset digests:
  - Windows x64 installer: `LatoTex_0.1.3_x64-setup.exe`, SHA-256 `fd13e69fb58efdb6f848a35393b1c6bad481755332dff04478a597b946d77b83`
  - Linux deb: `LatoTex_0.1.3_amd64.deb`, SHA-256 `82ae87ee3fe851b02ef09ba1b2788e9e1806874ec82c71bd2edffa92c89ff1b1`
  - Linux AppImage: `LatoTex_0.1.3_amd64.AppImage`, SHA-256 `ca9c11adb242614bfb0a9aa6dbf41ca313e9bf83223df5ca468f387b616e9ba2`
  - macOS x64: `LatoTex_0.1.3_x64.dmg`, SHA-256 `9104be0de707952f70476f5340b8200e1e5a86070055aa97804ccdf4141906e8`
  - macOS arm64: `LatoTex_0.1.3_aarch64.dmg`, SHA-256 `66694978e05806ccf085cdebc3727aca6a6a564c5b39f1c599a76fac28110bd1`

## [0.1.2] - 2026-06-13

### Added

- Added a dependency-free virtualized list primitive and applied it to long Git diff, Agent trace, and research quality detail surfaces.
- Added a Research Gate local audit strip that summarizes citation evidence, blocker counts, warning counts, and inspectable Agent trace coverage.
- Added hard performance budgets for total built assets and key chunks, including Monaco, deferred Monaco languages, PDF worker, ExcelJS, app shell, and entry bundle outputs.

### Changed

- Deferred non-core Monaco basic-language contributions into a separate language chunk while keeping LaTeX, BibTeX, CSV, ignore, and editorconfig registration synchronous.
- Split Monaco language assets into a dedicated `vendor-monaco-languages` manual chunk so the core editor chunk remains bounded.
- Bumped desktop and package versions to `0.1.2` across npm, Tauri, local Rust crates, Cargo lock metadata, and Tauri config.

### Fixed

- Reduced render pressure in large Git diffs, long Agent operation traces, and dense research quality lists by virtualizing rows while preserving compact scroll behavior.
- Kept research workflow differentiation visible through local manuscript audit evidence instead of presenting the feature as a generic Agent-only capability.
- Tightened release performance regression detection so oversized chunks or missing expected chunks fail before packaging.

### Security

- Re-ran the repository security scan during release validation after the earlier public secret-shaped fixture cleanup to ensure no provider-shaped tokens were reintroduced.

### Validation

- Release-quality local validation for the final 0.1.2 candidate passed:
  - focused Vitest coverage for virtualization, Git diff, Agent traces, Research Gate, Monaco language loading, and i18n parity
  - `pnpm typecheck`
  - `pnpm arch:check`
  - `pnpm build`
  - `pnpm perf:baseline`
  - `$env:CI='true'; pnpm test:unit` (100 files / 318 tests)
  - `pnpm research:eval`
  - `pnpm security:scan`
  - `cargo test --manifest-path src-tauri/Cargo.toml` (153 tests)
  - `pnpm release:check:win-x64`
- Local Windows x64 NSIS validation artifact: `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/LatoTex_0.1.2_x64-setup.exe`, SHA-256 `ff0df44d62ff2d8f2d7162d5225f11f22e0e917531f07b69fe4da1470da32d9e`.
- Published GitHub Release `v0.1.2` from GitHub Actions artifacts: https://github.com/CloudWide851/LatoTex/releases/tag/v0.1.2.
- GitHub Actions Windows x64 release asset digest: `LatoTex_0.1.2_x64-setup.exe` SHA-256 `2b9acb6112eb69ea5d2e87cba5354f6caa3460d34ac98e90f6f11cb948b32663`.

## [0.1.1] - 2026-06-06

### Added

- Added the production desktop workspace foundation: multi-page LaTeX workbench, Monaco editing, project explorer, Git workspace, settings, paper library, analysis workspace, local resource serving, and desktop window/runtime controls.
- Added Agent workflows with structured run envelopes, async event polling, editor-first proposal review/apply, chat history hydration, tool/MCP/skill gating, harness profiles, team execution metadata, and multi-agent discussion support on the active runtime path.
- Added paper-library workflows for Bib/PDF import, local-first citation resolution, remote PDF caching, translation/compare flows, continuous PDF reading, annotation textboxes, scroll sync, magnifier interaction, and robust cache migration across move/copy/rename/delete.
- Added collaboration and share-page functionality, including desktop sharing controls, public review shell, comments, mobile/desktop share layouts, remote tunnel support, and bounded share HTTP security controls.
- Added safe plugin marketplace infrastructure with declarative contribution contracts, plugin details dialog, localized validation warnings, safe file/preview/language hooks, local/bundled/managed toolchain status, and Windows x64 portable toolchain registration.
- Added DOCX workspace support for common-format editing, resource/image insertion, sanitized HTML round-trip, compact formatting popovers, optional autosave, and package-preserving save behavior.
- Added embedded terminal support with persisted shell selection, PTY resizing, project-scoped restore metadata, venv activation, color-capable prompt setup, and in-app suggestions.
- Added Markdown/HTML preview hardening and explicit fenced-code execution paths for supported local/managed toolchains.
- Added Windows x64 release gates, unsigned installer packaging, release security scanning, smoke tests, architecture checks, source-size checks, and multi-platform CI/release workflows for Windows, Linux, macOS x64, and macOS arm64.

### Changed

- Reworked startup into a non-blocking bootstrap path so health/settings/projects load first and DrawIO, Tectonic, PDF, library, search, runtime, and remote metadata preparation happen page-locally or in the background.
- Moved heavy/runtime assets into managed plugin/runtime-resource flows and hardened DrawIO, Tectonic, uv, cloudflared, share-page, and PDF resources for packaged desktop builds.
- Refactored large frontend/backend modules into domain-owned components, API modules, storage helpers, plugin validators, share HTTP helpers, runtime helpers, and viewer shells to reduce regression risk.
- Rebuilt global search on a project-local SQLite index with incremental background sync and streaming result updates.
- Standardized UI state around theme tokens, responsive topbar behavior, panel resize recovery, titlebar dragging, icon-only controls, stable overlays, app-owned dialogs, and i18n-backed user-visible text.
- Upgraded the frontend build/runtime stack for current Vite, Node, pnpm, Monaco, PDF, Markdown, DOCX, terminal, and Tauri desktop requirements.

### Fixed

- Fixed many workspace reliability issues around file selection, directory clicks, tab deduplication, preview routing, TeX compile gating, PDF preview/export, DrawIO export naming, local resource paths, and Windows path normalization.
- Fixed credential/settings persistence races with deterministic keyring/fallback readback checks, stable diagnostic codes, and i18n-mapped backend errors.
- Fixed Git operations and history UX, including staging semantics, diff stats, rename/move behavior, branch/history refresh scope, runtime action logging, and commit/apply snapshot refreshes.
- Fixed paper-library regressions in scroll restoration, compare sync, remote cache reuse, Bib-first loading, drag/drop moves, textbox editing/formatting/resizing, annotation persistence, and local/remote PDF retry behavior.
- Fixed Agent run stability across provider streaming, cancellation, recovery, event polling, apply flow, tool-output accumulation, chat rendering, and callsite-specific context assembly.
- Fixed DOCX caret, image, resource insertion, jsdom tests, package save, autosave gating, and layout fit issues.
- Fixed Telegram/DingTalk channel diagnostics, token-only Telegram verification, optional Bot API base URLs, redacted error reporting, and localized risk/permission copy.
- Fixed CI failures for Windows, Linux, macOS x64, and macOS arm64 by making release security scanning multi-platform aware, making Windows-path fixtures host-independent, removing hardcoded Windows separators from Rust tests, and serializing Cargo/package validation.

### Security

- Removed Windows signing flow assumptions and kept release packaging unsigned-only unless explicitly reintroduced.
- Hardened local resource and share HTTP serving with origin allowlists, CSP/security headers, range handling, bounded upload/JSON/comment sizes, safe static routes, and workspace-root path checks.
- Hardened plugin and toolchain interfaces so plugin contributions remain declarative and allowlisted, with no arbitrary shell, JavaScript, process, network, or unsafe path execution.
- Hardened downloads and runtime/toolchain installs with HTTPS, mirror ordering, bounded retries, temp writes, SHA-256 verification, traversal-safe extraction, staging validation, and atomic replacement.

### Validation

- Release-quality local validation for the final 0.1.1 candidate passed:
  - `pnpm typecheck`
  - `$env:CI='true'; pnpm test:unit` (92 files / 295 tests)
  - `pnpm arch:check`
  - `pnpm build`
  - `pnpm security:scan`
  - `cargo test --manifest-path src-tauri/Cargo.toml` (150 tests)
  - `pnpm tauri build --target x86_64-pc-windows-msvc --bundles nsis`

## [0.1.0] - 2026-02-14

### Added

- Initialized project infrastructure with Tauri v2 + React + TypeScript + pnpm.
- Added frontend/backend separation with `src/` and `src-tauri/`.
- Added a baseline Tauri `health_check` command and frontend integration.
- Added GitHub Actions release workflow for Windows, Linux, and macOS builds.
- Added standard repository files and ignore rules for local agent artifacts.
