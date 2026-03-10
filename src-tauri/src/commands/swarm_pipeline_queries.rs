use super::super::swarm_events::{append_protocol_event, envelope};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

fn normalize_tool_query(value: &str) -> Option<String> {
    let trimmed = value
        .trim()
        .trim_matches(|ch: char| ch == '-' || ch == '*' || ch == '"' || ch == '\'');
    if trimmed.len() < 3 || trimmed.len() > 160 {
        return None;
    }
    if trimmed.starts_with('[') || trimmed.starts_with('{') {
        return None;
    }
    Some(trimmed.to_string())
}

pub(super) fn derive_tool_search_queries(prompt: &str) -> Vec<String> {
    let mut out = Vec::<String>::new();
    for line in prompt.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(value) = normalize_tool_query(
            trimmed
                .strip_prefix("- ")
                .or_else(|| trimmed.strip_prefix("* "))
                .unwrap_or(trimmed),
        ) {
            if !out.iter().any(|existing| existing == &value) {
                out.push(value);
            }
        }
        if out.len() >= 6 {
            break;
        }
    }
    if out.is_empty() {
        let fallback = prompt.lines().next().unwrap_or(prompt);
        if let Some(value) = normalize_tool_query(fallback) {
            out.push(value);
        }
    }
    out
}

pub(super) fn with_tool_search_queries(prompt: &str, queries: &[String]) -> String {
    let mut lines = Vec::new();
    lines.push(prompt.to_string());
    lines.push(String::new());
    lines.push("[tool_search.queries.v1]".to_string());
    if queries.is_empty() {
        lines.push("- latex coding best practices".to_string());
    } else {
        for query in queries.iter().take(6) {
            lines.push(format!("- {query}"));
        }
    }
    lines.join("\n")
}

pub(super) fn spawn_run_heartbeat(
    db_path: PathBuf,
    run_id: String,
    project_id: String,
    role: String,
    stop_flag: Arc<AtomicBool>,
) {
    thread::spawn(move || {
        while !stop_flag.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_secs(10));
            if stop_flag.load(Ordering::Relaxed) {
                return;
            }
            let _ = append_protocol_event(
                &db_path,
                &run_id,
                &project_id,
                &role,
                "agent.run.heartbeat",
                envelope(
                    &run_id,
                    "system",
                    "run",
                    "running",
                    "Run Heartbeat",
                    "",
                    &format!("{run_id}:run:heartbeat"),
                ),
            );
        }
    });
}
