use crate::commands::analysis::run_reference_check_queries;
use serde_json::json;
use std::collections::{BTreeSet, HashSet};
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use super::call_provider_with_retry;
use super::swarm_events::{
    EventMetadata, append_protocol_event, emit_response_event, emit_stage_event, emit_tool_event,
    run_envelope,
};

fn ensure_not_cancelled(cancel_flag: &Arc<AtomicBool>) -> Result<(), String> {
    if cancel_flag.load(Ordering::Relaxed) {
        return Err("agent.run.cancelled".to_string());
    }
    Ok(())
}

fn call_model_output(
    db_path: &Path,
    protocol_id: &str,
    base_url: &str,
    api_key: &str,
    model_name: &str,
    prompt: &str,
    context_refs: &[String],
    bypass_cache: bool,
) -> Result<String, String> {
    let full_prompt = if context_refs.is_empty() {
        prompt.to_string()
    } else {
        format!("{}\n\n[Context]\n{}", prompt, context_refs.join("\n"))
    };
    call_provider_with_retry(
        Some(db_path),
        protocol_id,
        base_url,
        api_key,
        model_name,
        &full_prompt,
        bypass_cache,
    )
}

fn normalize_query(candidate: &str) -> Option<String> {
    let trimmed = candidate
        .trim()
        .trim_matches(|ch: char| ch == '-' || ch == '*' || ch == '"' || ch == '\'');
    if trimmed.len() < 3 || trimmed.len() > 180 {
        return None;
    }
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        return None;
    }
    Some(trimmed.to_string())
}

fn extract_tool_search_queries(prompt: &str) -> Vec<String> {
    let mut values = BTreeSet::new();
    for line in prompt.lines() {
        let trimmed = line.trim();
        if let Some(stripped) = trimmed
            .strip_prefix("- ")
            .or_else(|| trimmed.strip_prefix("* "))
            .or_else(|| trimmed.strip_prefix("• "))
        {
            if let Some(value) = normalize_query(stripped) {
                values.insert(value);
            }
            continue;
        }
        for segment in trimmed.split(&[',', ';'][..]) {
            if let Some(value) = normalize_query(segment) {
                values.insert(value);
            }
        }
    }
    values.into_iter().take(10).collect()
}

fn extract_explicit_tool_search_queries(prompt: &str) -> Vec<String> {
    let marker = "[tool_search.queries.v1]";
    let Some(start) = prompt.find(marker) else {
        return Vec::new();
    };
    let tail = &prompt[start + marker.len()..];
    let mut result = Vec::new();
    let mut seen = HashSet::<String>::new();
    for line in tail.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if !result.is_empty() {
                break;
            }
            continue;
        }
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            break;
        }
        let stripped = trimmed
            .strip_prefix("- ")
            .or_else(|| trimmed.strip_prefix("* "))
            .or_else(|| trimmed.strip_prefix("• "))
            .unwrap_or(trimmed);
        let Some(value) = normalize_query(stripped) else {
            continue;
        };
        if seen.insert(value.clone()) {
            result.push(value);
        }
        if result.len() >= 10 {
            break;
        }
    }
    result
}

fn truncate_text(value: &str, max_chars: usize) -> String {
    let mut output = String::new();
    for ch in value.chars().take(max_chars) {
        output.push(ch);
    }
    output
}

fn build_tool_search_context(raw_prompt: &str) -> (Vec<String>, String, usize) {
    let explicit_queries = extract_explicit_tool_search_queries(raw_prompt);
    let query_source = if explicit_queries.is_empty() {
        "heuristic"
    } else {
        "explicit"
    };
    let queries = if explicit_queries.is_empty() {
        extract_tool_search_queries(raw_prompt)
    } else {
        explicit_queries
    };
    if queries.is_empty() {
        return (
            Vec::new(),
            "tool_search produced no valid query terms.".to_string(),
            0,
        );
    }
    let result = run_reference_check_queries(queries.clone(), 4);
    match result {
        Ok(response) => {
            let mut lines = Vec::new();
            let mut evidence_count = 0_usize;
            for item in response.items.iter().take(6) {
                if !item.ok {
                    lines.push(format!("- {} => {}", item.query, item.message));
                    continue;
                }
                lines.push(format!("- {} => {}", item.query, item.message));
                for evidence in item.results.iter().take(3) {
                    evidence_count += 1;
                    let title = truncate_text(&evidence.title, 120);
                    let url = truncate_text(&evidence.url, 180);
                    lines.push(format!("  - {} ({})", title, url));
                }
            }
            let mut with_meta = vec![format!("query_source={query_source}")];
            with_meta.extend(lines);
            (queries, with_meta.join("\n"), evidence_count)
        }
        Err(error) => (
            queries,
            format!("tool_search error: {}", truncate_text(&error, 220)),
            0,
        ),
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn run_stage_tool_search(
    db_path: &Path,
    run_id: &str,
    project_id: &str,
    event_scope: &str,
    stage: &str,
    source: &str,
    title: &str,
    prompt: &str,
    context_refs: &[String],
    cancel_flag: &Arc<AtomicBool>,
    protocol_id: &str,
    base_url: &str,
    api_key: &str,
    model_name: &str,
    bypass_cache: bool,
    metadata: EventMetadata<'_>,
) -> Result<String, String> {
    ensure_not_cancelled(cancel_flag)?;
    emit_stage_event(
        db_path,
        run_id,
        project_id,
        event_scope,
        source,
        stage,
        "running",
        title,
        "",
        metadata,
    )?;
    emit_tool_event(
        db_path,
        run_id,
        project_id,
        event_scope,
        source,
        stage,
        "tool_search",
        "running",
        "",
        metadata,
    )?;
    let (queries, compact_context, evidence_count) = build_tool_search_context(prompt);
    ensure_not_cancelled(cancel_flag)?;
    emit_tool_event(
        db_path,
        run_id,
        project_id,
        event_scope,
        source,
        stage,
        "tool_search",
        "success",
        &format!(
            "queries={}, evidence={}, token_mode=compact",
            queries.len(),
            evidence_count
        ),
        metadata,
    )?;

    let estimated_saved = ((queries.len().saturating_mul(850)) as i64
        - (compact_context.len() as i64 / 4))
        .max(0);
    let mut stats_payload = run_envelope(
        run_id,
        "success",
        "Tool Search Stats",
        "",
        &format!("{run_id}:{stage}:{source}:{event_scope}:tool:tool_search:stats"),
        metadata,
    );
    if let Some(object) = stats_payload.as_object_mut() {
        object.insert("toolName".to_string(), json!("tool_search"));
        object.insert("toolTokensSavedEstimate".to_string(), json!(estimated_saved));
        object.insert("toolRound".to_string(), json!(1));
    }
    append_protocol_event(
        db_path,
        run_id,
        project_id,
        event_scope,
        "mcp.tool.search.stats",
        stats_payload,
    )?;

    let final_prompt = [
        "You are using internal programmatic tools in a provider-agnostic runtime.",
        "Tool protocol: ison-tool-call.v1",
        "A tool named `tool_search` has already been executed by the runtime.",
        "Do not ask to call tools again. Produce the final answer from compact evidence below.",
        "",
        "[tool_search.compact.v1]",
        compact_context.as_str(),
        "",
        "[user_request]",
        prompt,
    ]
    .join("\n");

    let output = call_model_output(
        db_path,
        protocol_id,
        base_url,
        api_key,
        model_name,
        &final_prompt,
        context_refs,
        bypass_cache,
    )?;
    ensure_not_cancelled(cancel_flag)?;
    emit_response_event(
        db_path,
        run_id,
        project_id,
        event_scope,
        source,
        stage,
        &output,
        metadata,
    )?;
    emit_stage_event(
        db_path,
        run_id,
        project_id,
        event_scope,
        source,
        stage,
        "success",
        title,
        "",
        metadata,
    )?;
    Ok(output)
}
