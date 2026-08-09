use super::ReferenceEvidence;
use serde_json::Value;

pub(super) fn publication_status_from_title(title: &str) -> (String, String) {
    let normalized = title.to_ascii_lowercase();
    let retraction = if normalized.contains("retracted")
        || normalized.contains("retraction")
        || normalized.contains("撤稿")
    {
        "retracted"
    } else {
        "unknown"
    };
    let correction =
        if normalized.contains("expression of concern") || normalized.contains("关注声明") {
            "expression_of_concern"
        } else if normalized.contains("correction")
            || normalized.contains("corrigendum")
            || normalized.contains("更正")
        {
            "corrected"
        } else {
            "unknown"
        };
    (retraction.to_string(), correction.to_string())
}

pub(super) fn apply_openalex_publication_status(entry: &Value, evidence: &mut ReferenceEvidence) {
    if entry
        .get("is_retracted")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        evidence.retraction_status = "retracted".to_string();
    }
}

pub(super) fn apply_crossref_publication_status(entry: &Value, evidence: &mut ReferenceEvidence) {
    let relation_types = entry
        .get("relation")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|relations| relations.values())
        .filter_map(Value::as_array)
        .flatten()
        .filter_map(|relation| relation.get("type").and_then(Value::as_str))
        .map(|value| value.to_ascii_lowercase())
        .collect::<Vec<_>>();
    if relation_types.iter().any(|value| value.contains("retract")) {
        evidence.retraction_status = "retracted".to_string();
    }
    if relation_types.iter().any(|value| value.contains("correct")) {
        evidence.correction_status = "corrected".to_string();
    }
}
