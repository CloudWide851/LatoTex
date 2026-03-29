use reqwest::Url;
use std::path::{Path, PathBuf};

pub fn normalize_export_pdf_file_name(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "document.pdf".to_string();
    }
    if trimmed.to_lowercase().ends_with(".pdf") {
        return trimmed.to_string();
    }
    format!("{trimmed}.pdf")
}

pub fn ensure_within_workspace_root(root: &Path, candidate: &Path) -> Result<(), String> {
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
    let parent = candidate
        .parent()
        .ok_or_else(|| "Cannot resolve save directory".to_string())?;
    let canonical_parent = parent.canonicalize().map_err(|e| e.to_string())?;
    if !canonical_parent.starts_with(&canonical_root) {
        return Err("Export path must stay inside project workspace".to_string());
    }
    Ok(())
}

pub fn resolve_workspace_target_path(root: &Path, relative_path: Option<&str>) -> Result<PathBuf, String> {
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
    let relative = relative_path
        .unwrap_or_default()
        .trim()
        .replace('\\', "/");
    if relative.is_empty() {
        return Ok(canonical_root);
    }
    let candidate = canonical_root.join(relative);
    if !candidate.exists() {
        return Err("Path does not exist".to_string());
    }
    let canonical_target = candidate.canonicalize().map_err(|e| e.to_string())?;
    if !canonical_target.starts_with(&canonical_root) {
        return Err("Path traversal detected".to_string());
    }
    Ok(canonical_target)
}

pub fn validate_external_http_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("URL cannot be empty".to_string());
    }
    let parsed = Url::parse(trimmed).map_err(|_| "Invalid URL".to_string())?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err("Only http/https links are supported".to_string());
    }
    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::{normalize_export_pdf_file_name, validate_external_http_url};

    #[test]
    fn normalizes_pdf_export_file_names() {
        assert_eq!(normalize_export_pdf_file_name(""), "document.pdf");
        assert_eq!(normalize_export_pdf_file_name("paper"), "paper.pdf");
        assert_eq!(normalize_export_pdf_file_name("paper.pdf"), "paper.pdf");
    }

    #[test]
    fn rejects_non_http_links() {
        assert!(validate_external_http_url("file:///tmp/test").is_err());
        assert!(validate_external_http_url("https://example.com").is_ok());
    }
}
