# LatoTex

LatoTex is a Tauri v2 desktop application for swarm-agent assisted LaTeX authoring and compilation.

## Tech Stack

- Desktop shell: Tauri v2 + Rust
- Frontend: React + TypeScript + Vite
- Editor: Monaco
- LaTeX compile path: BusyTeX (`texlyre-busytex`) on frontend
- Persistence: SQLite + file system
- Secret storage: system keyring
- Package manager: pnpm
- CI/CD: GitHub Actions release workflow (`v*.*.*`)

## Workbench Layout

- Top project bar: switch active project.
- Left rail: page switcher (`LaTeX`, `Data`, `Papers`, `Settings`).
- Explorer rail: VS Code-like project resources.
- Main panel: Monaco LaTeX editor + task-agent prompt.
- Right panel: PDF preview + diagnostics + swarm events.

## Agent Architecture

- Fixed roles: `plan`, `task`, `explore`, `web_search`, `review`.
- Ephemeral agents: short-lived task workers.
- Event-sourced communication: backend persists swarm events and supports replay via cursor-based subscription.
- Provider routing: OpenAI + Anthropic + Gemini profiles with per-agent model binding.

## Project Structure

```text
.
├─ src/                          # React workbench UI and BusyTeX compiler adapter
├─ src-tauri/                    # Rust commands, swarm event persistence, settings/keyring
├─ .github/workflows/            # Multi-platform release automation
├─ CHANGELOG.md
├─ AGENTS.md
└─ MEMORY.md
```

## Local Development

```bash
pnpm install --no-frozen-lockfile
pnpm tauri dev
```

## Quality Gates

```bash
pnpm typecheck
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build
```

## Release

Push semantic version tags to trigger cross-platform packaging.

```bash
git tag v0.1.0
git push origin v0.1.0
```
