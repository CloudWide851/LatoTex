use crate::storage;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use super::swarm_events::{emit_stage_event, emit_tool_event, EventMetadata};

const MAX_FILES: usize = 10;
const MAX_FILE_CHARS: usize = 1_200;
const MAX_DEPTH: usize = 5;

fn ensure_not_cancelled(cancel_flag: &Arc<AtomicBool>) -> Result<(), String> {
    if cancel_flag.load(Ordering::Relaxed) {
        return Err("agent.run.cancelled".to_string());
    }
    Ok(())
}

fn supported(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase()),
        Some(ext)
            if matches!(
                ext.as_str(),
                "tex" | "bib" | "sty" | "cls" | "md" | "txt" | "json" | "yaml" | "yml" | "csv" | "py" | "rs" | "ts" | "tsx"
            )
    )
}

fn prompt_terms(prompt: &str) -> Vec<String> {
    let mut out = Vec::<String>::new();
    for raw in prompt.split(|ch: char| !ch.is_alphanumeric() && ch != '_' && ch != '-') {
        let item = raw.trim().to_lowercase();
        if item.len() >= 4 && !out.iter().any(|value| value == &item) {
            out.push(item);
        }
        if out.len() >= 16 {
            break;
        }
    }
    out
}

fn collect_files(root: &Path, current: &Path, depth: usize, out: &mut Vec<PathBuf>) -> Result<(), String> {
    if depth > MAX_DEPTH || out.len() >= MAX_FILES * 4 {
        return Ok(());
    }
    let mut entries = fs::read_dir(current)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    entries.sort_by_key(|entry| entry.path());
    for entry in entries {
        if out.len() >= MAX_FILES * 4 {
            break;
        }
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if matches!(name, ".git" | "node_modules" | "target" | "dist") {
            continue;
        }
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        if metadata.is_dir() {
            collect_files(root, &path, depth + 1, out)?;
        } else if path.starts_with(root) && supported(&path) {
            out.push(path);
        }
    }
    Ok(())
}

fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .ok()
        .map(|value| value.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|| path.to_string_lossy().replace('\\', "/"))
}

fn truncate(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn build_context(db_path: &Path, project_id: &str, prompt: &str) -> Result<String, String> {
    let root = storage::load_project_root(db_path, project_id)?;
    let terms = prompt_terms(prompt);
    let mut files = Vec::<PathBuf>::new();
    collect_files(&root, &root, 0, &mut files)?;
    let mut scored = files
        .into_iter()
        .filter_map(|path| {
            let content = fs::read_to_string(&path).ok()?;
            let haystack = format!("{} {}", relative(&root, &path), content).to_lowercase();
            let score = terms.iter().filter(|term| haystack.contains(term.as_str())).count();
            if score == 0 && !relative(&root, &path).ends_with(".bib") {
                return None;
            }
            Some((score, path, content))
        })
        .collect::<Vec<_>>();
    scored.sort_by(|left, right| right.0.cmp(&left.0).then_with(|| left.1.cmp(&right.1)));
    let blocks = scored
        .into_iter()
        .take(MAX_FILES)
        .map(|(_, path, content)| {
            format!(
                "File: {}\n{}",
                relative(&root, &path),
                truncate(content.trim(), MAX_FILE_CHARS)
            )
        })
        .collect::<Vec<_>>();
    if blocks.is_empty() {
        Ok("workspace_search found no matching supported files.".to_string())
    } else {
        Ok(blocks.join("\n\n---\n\n"))
    }
}

pub(super) fn run_stage_workspace_search(
    db_path: &Path,
    runtime_root: &Path,
    run_id: &str,
    project_id: &str,
    event_scope: &str,
    stage: &str,
    source: &str,
    title: &str,
    prompt: &str,
    cancel_flag: &Arc<AtomicBool>,
    metadata: EventMetadata<'_>,
) -> Result<String, String> {
    ensure_not_cancelled(cancel_flag)?;
    let settings = storage::load_settings(db_path, runtime_root).ok();
    let enabled = settings
        .and_then(|settings| settings.ui_prefs)
        .and_then(|prefs| prefs.agent_tool_prefs)
        .and_then(|prefs| prefs.workspace_read_enabled)
        .unwrap_or(true);
    if !enabled {
        return Ok("[workspace_search.compact.v1]\nworkspace_read=disabled_by_settings".to_string());
    }
    emit_stage_event(db_path, run_id, project_id, event_scope, source, stage, "running", title, "", metadata)?;
    emit_tool_event(db_path, run_id, project_id, event_scope, source, stage, "workspace_search", "running", "", metadata)?;
    let context = build_context(db_path, project_id, prompt)?;
    ensure_not_cancelled(cancel_flag)?;
    emit_tool_event(db_path, run_id, project_id, event_scope, source, stage, "workspace_search", "success", "workspace context collected", metadata)?;
    emit_stage_event(db_path, run_id, project_id, event_scope, source, stage, "success", title, "", metadata)?;
    Ok(format!("[workspace_search.compact.v1]\n{context}"))
}
