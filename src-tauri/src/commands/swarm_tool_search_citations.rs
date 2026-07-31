fn canonical_network_url(value: &str) -> Option<String> {
    let mut url = reqwest::Url::parse(value.trim()).ok()?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.host_str().is_none()
    {
        return None;
    }
    url.set_fragment(None);
    Some(url.to_string())
}

fn line_has_allowed_citation(line: &str, context: &ToolSearchContext) -> bool {
    context
        .local_evidence_ids
        .iter()
        .any(|evidence_id| line.contains(&format!("[{evidence_id}]")))
        || context.network_urls.iter().any(|url| line.contains(url))
}

fn line_is_nonfactual(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty()
        || trimmed.starts_with('#')
        || trimmed.starts_with("```")
        || trimmed.starts_with('|')
        || trimmed == "---"
    {
        return true;
    }
    let normalized = trimmed.to_lowercase();
    [
        "unconfirmed",
        "inference",
        "uncertainty",
        "not confirmed",
        "sin confirmar",
        "inferencia",
        "incertidumbre",
        "未确认",
        "推断",
        "不确定",
        "未確認",
        "推論",
        "不確実",
    ]
    .iter()
    .any(|marker| normalized.contains(marker))
}

fn unsupported_research_lines(output: &str, context: &ToolSearchContext) -> Vec<usize> {
    let mut fenced = false;
    output
        .lines()
        .enumerate()
        .filter_map(|(index, line)| {
            if line.trim_start().starts_with("```") {
                fenced = !fenced;
                return None;
            }
            (!fenced && !line_is_nonfactual(line) && !line_has_allowed_citation(line, context))
                .then_some(index)
        })
        .collect()
}

fn downgrade_unsupported_research_lines(output: &str, context: &ToolSearchContext) -> String {
    let unsupported = unsupported_research_lines(output, context)
        .into_iter()
        .collect::<HashSet<_>>();
    output
        .lines()
        .enumerate()
        .map(|(index, line)| {
            if unsupported.contains(&index) {
                format!("Unconfirmed: {line}")
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}
