pub fn compact_body_preview(body: &str) -> String {
    body.replace('\n', " ")
        .replace('\r', " ")
        .chars()
        .take(260)
        .collect::<String>()
}

pub fn parse_sse_json_body(trimmed: &str) -> Option<serde_json::Value> {
    let mut last_json: Option<serde_json::Value> = None;
    for line in trimmed.lines() {
        let text = line.trim();
        if !text.starts_with("data:") {
            continue;
        }
        let payload = text.trim_start_matches("data:").trim();
        if payload.is_empty() || payload == "[DONE]" {
            continue;
        }
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(payload) {
            last_json = Some(parsed);
        }
    }
    last_json
}

pub fn parse_line_delimited_json(trimmed: &str) -> Option<serde_json::Value> {
    for line in trimmed.lines().rev() {
        let text = line.trim();
        if text.is_empty() {
            continue;
        }
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(text) {
            return Some(parsed);
        }
    }
    None
}
