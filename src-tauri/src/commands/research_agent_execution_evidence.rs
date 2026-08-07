use super::ResearchExecutionContext;
use crate::models::{EvidenceLocator, EvidencePacketUpsertInput};
use crate::storage;
use serde_json::Value;

pub(super) fn archive_search_evidence(
    context: &ResearchExecutionContext,
    run_id: &str,
    task_id: &str,
    result: &Value,
) -> Result<(), String> {
    let Some(items) = result.get("items").and_then(Value::as_array) else {
        return Ok(());
    };
    for evidence in items
        .iter()
        .filter_map(|item| item.get("academicResults").and_then(Value::as_array))
        .flatten()
    {
        let title = evidence
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim();
        let excerpt = evidence
            .get("abstractText")
            .and_then(Value::as_str)
            .or_else(|| evidence.get("snippet").and_then(Value::as_str))
            .unwrap_or_default()
            .trim();
        if title.is_empty() || excerpt.is_empty() {
            continue;
        }
        storage::upsert_evidence_packet(
            &context.db_path,
            &context.runtime_root,
            EvidencePacketUpsertInput {
                project_id: context.project_id.clone(),
                task_id: task_id.to_string(),
                run_id: Some(run_id.to_string()),
                stable_id: evidence
                    .get("stableId")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                source: evidence
                    .get("source")
                    .and_then(Value::as_str)
                    .unwrap_or("academic")
                    .to_string(),
                doi: evidence
                    .get("doi")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                source_version: evidence
                    .get("arxivId")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                title: title.to_string(),
                excerpt: excerpt.to_string(),
                locator: EvidenceLocator {
                    page: None,
                    section: Some("abstract".to_string()),
                    paragraph: None,
                },
                retraction_status: Some("unknown".to_string()),
                correction_status: Some("unknown".to_string()),
                source_url: evidence
                    .get("originalSourceUrl")
                    .and_then(Value::as_str)
                    .or_else(|| evidence.get("landingUrl").and_then(Value::as_str))
                    .unwrap_or_default()
                    .to_string(),
            },
        )?;
    }
    storage::refresh_research_run_evidence_count(&context.db_path, &context.project_id, run_id)?;
    Ok(())
}
