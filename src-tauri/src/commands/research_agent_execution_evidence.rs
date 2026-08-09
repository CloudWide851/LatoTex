use super::ResearchExecutionContext;
use crate::models::{EvidenceLocator, EvidencePacketUpsertInput, ResearchQuerySnapshotRecordInput};
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
    for item in items {
        let Some(query) = item.get("query").and_then(Value::as_str) else {
            continue;
        };
        let sources = item
            .get("providerHealth")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|provider| {
                provider
                    .get("resultCount")
                    .and_then(Value::as_u64)
                    .unwrap_or_default()
                    > 0
            })
            .filter_map(|provider| provider.get("provider").and_then(Value::as_str))
            .map(str::to_string)
            .collect::<Vec<_>>();
        storage::record_research_query_snapshot(
            &context.db_path,
            &context.runtime_root,
            ResearchQuerySnapshotRecordInput {
                project_id: context.project_id.clone(),
                task_id: task_id.to_string(),
                stable_id: item
                    .get("querySnapshotId")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                query: query.to_string(),
                sources,
                result_count: item
                    .get("academicResults")
                    .and_then(Value::as_array)
                    .map(|results| results.len() as u32)
                    .unwrap_or_default(),
                stop_reason: item
                    .get("stopReason")
                    .and_then(Value::as_str)
                    .unwrap_or("no_results")
                    .to_string(),
            },
        )?;
    }
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
        if title.is_empty() {
            continue;
        }
        let anchors = evidence
            .get("fulltextAnchors")
            .and_then(Value::as_array)
            .filter(|anchors| !anchors.is_empty());
        let excerpts = anchors
            .map(|anchors| {
                anchors
                    .iter()
                    .take(16)
                    .filter_map(|anchor| {
                        let excerpt = anchor.get("excerpt")?.as_str()?.trim();
                        (!excerpt.is_empty()).then_some((
                            excerpt.to_string(),
                            EvidenceLocator {
                                page: anchor
                                    .get("page")
                                    .and_then(Value::as_u64)
                                    .map(|value| value as u32),
                                section: None,
                                paragraph: None,
                                document_hash: anchor
                                    .get("documentHash")
                                    .and_then(Value::as_str)
                                    .map(str::to_string),
                                paragraph_index: anchor
                                    .get("paragraphIndex")
                                    .and_then(Value::as_u64)
                                    .map(|value| value as u32),
                                text_hash: anchor
                                    .get("textHash")
                                    .and_then(Value::as_str)
                                    .map(str::to_string),
                            },
                        ))
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_else(|| {
                evidence
                    .get("abstractText")
                    .and_then(Value::as_str)
                    .or_else(|| evidence.get("snippet").and_then(Value::as_str))
                    .map(str::trim)
                    .filter(|excerpt| !excerpt.is_empty())
                    .map(|excerpt| {
                        vec![(
                            excerpt.to_string(),
                            EvidenceLocator {
                                page: None,
                                section: Some("abstract".to_string()),
                                paragraph: None,
                                document_hash: None,
                                paragraph_index: None,
                                text_hash: None,
                            },
                        )]
                    })
                    .unwrap_or_default()
            });
        for (excerpt_index, (excerpt, locator)) in excerpts.into_iter().enumerate() {
            let stable_id = evidence
                .get("stableId")
                .and_then(Value::as_str)
                .map(|value| {
                    if locator.document_hash.is_some() {
                        format!("{value}-anchor-{excerpt_index}")
                    } else {
                        value.to_string()
                    }
                });
            storage::upsert_evidence_packet(
                &context.db_path,
                &context.runtime_root,
                EvidencePacketUpsertInput {
                    project_id: context.project_id.clone(),
                    task_id: task_id.to_string(),
                    run_id: Some(run_id.to_string()),
                    stable_id,
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
                    excerpt,
                    locator,
                    retraction_status: evidence
                        .get("retractionStatus")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    correction_status: evidence
                        .get("correctionStatus")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    source_url: evidence
                        .get("originalSourceUrl")
                        .and_then(Value::as_str)
                        .or_else(|| evidence.get("landingUrl").and_then(Value::as_str))
                        .unwrap_or_default()
                        .to_string(),
                },
            )?;
        }
    }
    storage::refresh_research_run_evidence_count(&context.db_path, &context.project_id, run_id)?;
    Ok(())
}
