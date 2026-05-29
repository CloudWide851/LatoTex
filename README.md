<p align="center">
  <img src="src/assets/branding/logo.svg" alt="LatoTex" width="180" />
</p>

# LatoTex

LatoTex is a desktop-first LaTeX and paper-analysis workspace built with Tauri v2, React, TypeScript, and Rust.

## What Changed In This Runtime Pass

- LaTeX compilation now targets native TeX engines on desktop.
  - Engine selection prefers `tectonic`, then falls back to `latexmk`, `xelatex`, and `pdflatex` when available.
- Paper translation now uses a shared `uv`-managed project `.venv`.
  - The bundled Python runtime installs `pdf2zh` / PDFMathTranslate into the project-local virtual environment.
- Paper analysis and paper translation now share the same hidden-window Python bridge.
  - This removes the old Rust-side OCR/translation pipeline and avoids transient `cmd`/PowerShell windows on Windows.
- diagrams.net / draw.io remains bundled for the drawing workspace through local packaged assets.

## Tech Stack

- Desktop shell: Tauri v2 + Rust
- Frontend: React + TypeScript + Vite
- Editor: Monaco
- LaTeX compile path: native TeX toolchain (`tectonic` preferred)
- Paper translation/runtime: `uv` + project-local `.venv` + PDFMathTranslate (`pdf2zh`)
- Persistence: SQLite + file system
- Secret storage: system keyring
- Package manager: pnpm

## Workbench Layout

- Top project bar: switch active project.
- Left rail: page switcher (`LaTeX`, `Data`, `Papers`, `Settings`).
- Explorer rail: project resources and paper-library assets.
- Main panel: editor, analysis, draw workspace, and task-agent workflows.
- Right panel: preview, diagnostics, and run feedback.

## Local Development

```bash
CI=true pnpm install --no-frozen-lockfile
pnpm tauri dev
```

## Validation

```bash
pnpm typecheck
pnpm test:unit
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build --target x86_64-pc-windows-msvc --bundles nsis
```

## Licensing

LatoTex is distributed under `AGPL-3.0-only`.

Reason:
- The packaged paper-translation runtime now depends on PDFMathTranslate / `pdf2zh`, whose upstream project is licensed under AGPL v3.
- Bundled diagrams.net assets keep their upstream license and notice requirements; see `THIRD_PARTY_NOTICES.md`.
