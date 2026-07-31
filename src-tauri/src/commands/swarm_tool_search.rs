use crate::commands::analysis::{run_reference_check_queries_for_project, ReferenceCheckResponse};
use serde_json::json;
use std::collections::{BTreeSet, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use super::call_provider_with_retry;
use super::swarm_events::{
    append_protocol_event, emit_response_event, emit_stage_event, emit_tool_event, run_envelope,
    EventMetadata,
};

struct ToolSearchContext {
    queries: Vec<String>,
    compact_context: String,
    evidence_count: usize,
    local_evidence_ids: HashSet<String>,
    network_urls: HashSet<String>,
}

include!("swarm_tool_search_citations.rs");

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

fn build_local_knowledge_context(
    db_path: &Path,
    runtime_root: &Path,
    project_id: &str,
    queries: &[String],
) -> (Vec<String>, HashSet<String>) {
    let mut lines = Vec::new();
    let mut seen = HashSet::<String>::new();
    for query in queries.iter().take(6) {
        let result = crate::storage::search_knowledge(
            db_path,
            runtime_root,
            &crate::models::KnowledgeSearchInput {
                project_id: project_id.to_string(),
                project_ids: None,
                query: query.clone(),
                limit: Some(4),
                deep: Some(true),
                run_id: None,
                semantic: Some(true),
            },
        );
        let Ok(response) = result else {
            continue;
        };
        for hit in response.hits {
            if !seen.insert(hit.evidence_id.clone()) {
                continue;
            }
            lines.push(format!(
                "- [local_knowledge; evidence_id={}; anchor={}; source={}] {} — {}",
                hit.evidence_id,
                hit.anchor.value,
                hit.relative_path,
                truncate_text(&hit.title, 120),
                truncate_text(&hit.snippet, 360)
            ));
        }
    }
    (lines, seen)
}

fn build_tool_search_context(
    db_path: &Path,
    runtime_root: &Path,
    app_data_dir: Option<&Path>,
    project_id: &str,
    raw_prompt: &str,
    network_enabled: bool,
) -> ToolSearchContext {
    build_tool_search_context_with(
        db_path,
        runtime_root,
        app_data_dir,
        project_id,
        raw_prompt,
        network_enabled,
        run_reference_check_queries_for_project,
    )
}

fn build_tool_search_context_with<F>(
    db_path: &Path,
    runtime_root: &Path,
    app_data_dir: Option<&Path>,
    project_id: &str,
    raw_prompt: &str,
    network_enabled: bool,
    search: F,
) -> ToolSearchContext
where
    F: FnOnce(
        &Path,
        &Path,
        Option<&Path>,
        Option<&str>,
        Vec<String>,
        u32,
        Option<&str>,
        bool,
    ) -> Result<ReferenceCheckResponse, String>,
{
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
        return ToolSearchContext {
            queries: Vec::new(),
            compact_context: "tool_search produced no valid query terms.".to_string(),
            evidence_count: 0,
            local_evidence_ids: HashSet::new(),
            network_urls: HashSet::new(),
        };
    }
    let (knowledge_lines, local_evidence_ids) =
        build_local_knowledge_context(db_path, runtime_root, project_id, &queries);
    if !network_enabled {
        let mut lines = vec![
            format!("query_source={query_source}"),
            "web_search=disabled_by_settings; local knowledge retrieval remains enabled."
                .to_string(),
            "Evidence rules: every factual sentence must cite a local evidence_id. If no local evidence supports a claim, label it unconfirmed.".to_string(),
        ];
        lines.extend(knowledge_lines);
        return ToolSearchContext {
            queries,
            compact_context: lines.join("\n"),
            evidence_count: local_evidence_ids.len(),
            local_evidence_ids,
            network_urls: HashSet::new(),
        };
    }
    let result = search(
        db_path,
        runtime_root,
        app_data_dir,
        Some(project_id),
        queries.clone(),
        4,
        None,
        true,
    );
    match result {
        Ok(response) => {
            let mut lines = Vec::new();
            let mut evidence_count = local_evidence_ids.len();
            let mut network_urls = HashSet::new();
            lines.extend(knowledge_lines);
            for item in response.items.iter().take(6) {
                if !item.ok {
                    lines.push(format!("- {} => {}", item.query, item.message));
                    continue;
                }
                lines.push(format!("- {} => {}", item.query, item.message));
                for evidence in item.academic_results.iter().take(3) {
                    evidence_count += 1;
                    let title = truncate_text(&evidence.title, 120);
                    let url = truncate_text(&evidence.url, 180);
                    if let Some(canonical) = canonical_network_url(&evidence.url) {
                        network_urls.insert(canonical);
                    }
                    lines.push(format!(
                        "  - [academic; {}; providers={}] {} ({})",
                        evidence.evidence_level,
                        evidence.provenance.join(","),
                        title,
                        url
                    ));
                }
                for evidence in item.web_results.iter().take(2) {
                    evidence_count += 1;
                    if let Some(canonical) = canonical_network_url(&evidence.url) {
                        network_urls.insert(canonical);
                    }
                    lines.push(format!(
                        "  - [general_web; provider={}] {} ({})",
                        evidence.source,
                        truncate_text(&evidence.title, 120),
                        truncate_text(&evidence.url, 180)
                    ));
                }
                for failure in item.provider_errors.iter().take(3) {
                    lines.push(format!(
                        "  - provider_unavailable={} code={} retryable={}",
                        failure.provider, failure.code, failure.retryable
                    ));
                }
            }
            let mut with_meta = vec![
                format!("query_source={query_source}"),
                "Evidence rules: distinguish confirmed facts from metadata-only support, model inference, and unresolved uncertainty. Every factual sentence must cite a local evidence_id or a canonical HTTPS URL. Never infer paper conclusions from a title or metadata record; abstract evidence supports only claims stated in the abstract.".to_string(),
            ];
            with_meta.extend(lines);
            ToolSearchContext {
                queries,
                compact_context: with_meta.join("\n"),
                evidence_count,
                local_evidence_ids,
                network_urls,
            }
        }
        Err(error) => {
            let mut lines = vec![
                format!("query_source={query_source}"),
                "Network providers failed; local knowledge evidence remains usable.".to_string(),
            ];
            lines.extend(knowledge_lines);
            lines.push(format!("tool_search error: {}", truncate_text(&error, 220)));
            ToolSearchContext {
                queries,
                compact_context: lines.join("\n"),
                evidence_count: local_evidence_ids.len(),
                local_evidence_ids,
                network_urls: HashSet::new(),
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn run_stage_tool_search(
    db_path: &Path,
    runtime_root: &Path,
    app_data_dir: Option<&Path>,
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
    let settings = crate::storage::load_settings(db_path, runtime_root)?;
    let web_enabled = settings
        .ui_prefs
        .as_ref()
        .map(|prefs| {
            let legacy_enabled = prefs
                .agent_tool_prefs
                .as_ref()
                .and_then(|prefs| prefs.web_search_enabled)
                .unwrap_or(true);
            let permission_enabled = prefs
                .agent_permission_prefs
                .as_ref()
                .and_then(|prefs| prefs.web_search.as_deref())
                .map(|mode| mode != "deny")
                .unwrap_or(true);
            legacy_enabled && permission_enabled
        })
        .unwrap_or(true);
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
    let running_actions = json!([{"type":"search","tool":"web","status":"running"}]);
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
        EventMetadata {
            actions: Some(&running_actions),
            ..metadata
        },
    )?;
    let search_context = build_tool_search_context(
        db_path,
        runtime_root,
        app_data_dir,
        project_id,
        prompt,
        web_enabled,
    );
    ensure_not_cancelled(cancel_flag)?;
    let query_count = search_context.queries.len();
    let result_actions = json!([{
        "type": "search",
        "tool": if web_enabled { "web+knowledge" } else { "knowledge" },
        "status": "success",
        "queries": search_context.queries,
        "evidenceCount": search_context.evidence_count
    }]);
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
            query_count, search_context.evidence_count
        ),
        EventMetadata {
            actions: Some(&result_actions),
            ..metadata
        },
    )?;

    let estimated_saved = ((query_count.saturating_mul(850)) as i64
        - (search_context.compact_context.len() as i64 / 4))
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
        object.insert(
            "toolTokensSavedEstimate".to_string(),
            json!(estimated_saved),
        );
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
        "Separate confirmed facts, inference, and uncertainty. End every factual sentence with its local [evidence_id] or a Markdown link to the canonical HTTPS source URL. If no evidence supports a factual claim, label it unconfirmed instead of presenting it as fact.",
        "",
        "[tool_search.compact.v1]",
        search_context.compact_context.as_str(),
        "",
        "[user_request]",
        prompt,
    ]
    .join("\n");

    let draft = call_model_output(
        db_path,
        protocol_id,
        base_url,
        api_key,
        model_name,
        &final_prompt,
        context_refs,
        bypass_cache,
    )?;
    let unsupported = unsupported_research_lines(&draft, &search_context);
    let output = if unsupported.is_empty() {
        draft
    } else {
        let repair_prompt = [
            "Repair the draft exactly once. The listed line numbers contain factual text without an allowed citation.",
            "Use only local evidence IDs and canonical HTTPS URLs from the compact evidence. Do not invent citations.",
            "If evidence is unavailable, explicitly label the line Unconfirmed, Inference, or Uncertainty.",
            &format!(
                "Unsupported line numbers: {}",
                unsupported
                    .iter()
                    .map(|index| (index + 1).to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            "",
            "[compact_evidence]",
            search_context.compact_context.as_str(),
            "",
            "[draft]",
            draft.as_str(),
        ]
        .join("\n");
        let repaired = call_model_output(
            db_path,
            protocol_id,
            base_url,
            api_key,
            model_name,
            &repair_prompt,
            context_refs,
            true,
        )
        .unwrap_or(draft);
        downgrade_unsupported_research_lines(&repaired, &search_context)
    };
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

#[cfg(test)]
include!("swarm_tool_search_tests.rs");
