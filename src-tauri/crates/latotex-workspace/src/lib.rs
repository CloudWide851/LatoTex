use reqwest::Url;
use std::path::{Component, Path, PathBuf};

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

pub fn resolve_workspace_target_path(
    root: &Path,
    relative_path: Option<&str>,
) -> Result<PathBuf, String> {
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
    let relative = relative_path.unwrap_or_default().trim().replace('\\', "/");
    if relative.is_empty() {
        return Ok(canonical_root);
    }
    let relative_path = Path::new(&relative);
    if relative_path.is_absolute()
        || relative_path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("Path traversal detected".to_string());
    }
    let candidate = canonical_root.join(relative_path);
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
    use super::{
        normalize_export_pdf_file_name, resolve_workspace_target_path, validate_external_http_url,
    };
    use std::fs;
    use std::path::{Path, PathBuf};

    struct WorkspaceFixture {
        root: PathBuf,
        parent: PathBuf,
    }

    impl WorkspaceFixture {
        fn new(name: &str) -> Self {
            let unique = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock after epoch")
                .as_nanos();
            let parent = std::env::temp_dir().join(format!("latotex-workspace-{name}-{unique}"));
            let root = parent.join("project");
            fs::create_dir_all(&root).expect("create workspace fixture");
            Self { root, parent }
        }
    }

    impl Drop for WorkspaceFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.parent);
        }
    }

    fn create_file(path: &Path) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create file parent");
        }
        fs::write(path, b"test").expect("write fixture file");
    }

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

    #[test]
    fn workspace_target_rejects_parent_and_absolute_paths() {
        let fixture = WorkspaceFixture::new("path-boundary");
        let inside = fixture.root.join("paper.tex");
        let outside = fixture.parent.join("escape.tex");
        create_file(&inside);
        create_file(&outside);

        assert_eq!(
            resolve_workspace_target_path(&fixture.root, Some("paper.tex"))
                .expect("inside target resolves"),
            inside.canonicalize().expect("canonical inside target")
        );
        assert!(resolve_workspace_target_path(&fixture.root, Some("../escape.tex")).is_err());
        assert!(resolve_workspace_target_path(
            &fixture.root,
            Some(outside.to_string_lossy().as_ref()),
        )
        .is_err());
    }

    #[test]
    fn workspace_target_rechecks_symlink_escape_when_supported() {
        let fixture = WorkspaceFixture::new("symlink-boundary");
        let outside = fixture.parent.join("escape.tex");
        let link = fixture.root.join("linked.tex");
        create_file(&outside);

        #[cfg(unix)]
        let linked = std::os::unix::fs::symlink(&outside, &link).is_ok();
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_file(&outside, &link).is_ok();
        #[cfg(not(any(unix, windows)))]
        let linked = false;

        if linked {
            assert!(resolve_workspace_target_path(&fixture.root, Some("linked.tex")).is_err());
        }
    }
}
