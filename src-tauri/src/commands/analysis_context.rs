use crate::state::AppState;
use crate::storage;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::Path;
use tauri::State;

const MAX_CONTEXT_FILES: usize = 8;
const MAX_CONTEXT_INPUTS: usize = 64;
const MAX_PDF_FILES: usize = 2;
const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_PDF_BYTES: u64 = 64 * 1024 * 1024;
const MAX_TEXT_CHARS: usize = 4_000;
const MAX_PDF_CHARS: usize = 8_000;
const MAX_TOTAL_CHARS: usize = 14_000;

const TEXT_EXTENSIONS: &[&str] = &[
    "tex", "bib", "cls", "sty", "bst", "bbx", "cbx", "lbx", "tikz", "pgf", "md", "markdown", "txt",
    "yaml", "yml", "toml", "ini", "cfg", "conf",
];
const ALLOWED_DOTFILES: &[&str] = &[".editorconfig", ".gitignore", ".gitattributes"];
const CREDENTIAL_EXTENSIONS: &[&str] = &["pem", "key", "p12", "pfx", "cer", "crt"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisContextLoadInput {
    pub project_id: String,
    pub paths: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisContextItem {
    pub path: String,
    pub kind: String,
    pub content: String,
    pub original_chars: usize,
    pub truncated: bool,
    pub page_count: Option<u32>,
    pub ocr_page_count: Option<u32>,
    pub extraction_engine: Option<String>,
    pub extraction_mode: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisContextIssue {
    pub path: String,
    pub code: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisContextLoadResponse {
    pub items: Vec<AnalysisContextItem>,
    pub issues: Vec<AnalysisContextIssue>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ContextKind {
    Text,
    Pdf,
}

fn issue(path: &str, code: &str) -> AnalysisContextIssue {
    AnalysisContextIssue {
        path: path.to_string(),
        code: code.to_string(),
    }
}

fn normalize_path(path: &str) -> Result<String, String> {
    let normalized = storage::normalize_workspace_path(path)?;
    Ok(normalized.to_string_lossy().replace('\\', "/"))
}

fn is_credential_name(file_name: &str, extension: &str) -> bool {
    let lower = file_name.to_ascii_lowercase();
    lower == ".env"
        || lower.starts_with(".env.")
        || lower == "credentials.json"
        || lower == "id_rsa"
        || lower == "id_ed25519"
        || lower.starts_with("secret.")
        || lower.starts_with("secrets.")
        || CREDENTIAL_EXTENSIONS.contains(&extension)
}

fn classify_path(path: &str) -> Result<ContextKind, &'static str> {
    let file_name = Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let lower_name = file_name.to_ascii_lowercase();
    let extension = Path::new(&lower_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if is_credential_name(&lower_name, extension) {
        return Err("analysis.context.credential_denied");
    }
    if lower_name.starts_with('.') {
        return ALLOWED_DOTFILES
            .contains(&lower_name.as_str())
            .then_some(ContextKind::Text)
            .ok_or("analysis.context.dotfile_denied");
    }
    if extension == "pdf" {
        return Ok(ContextKind::Pdf);
    }
    if TEXT_EXTENSIONS.contains(&extension) {
        return Ok(ContextKind::Text);
    }
    Err("analysis.context.unsupported_type")
}

fn ensure_no_reparse(root: &Path, normalized: &str) -> Result<(), String> {
    let relative = storage::normalize_workspace_path(normalized)?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        current.push(component.as_os_str());
        if storage::workspace_path_is_link_or_reparse(&current)? {
            return Err("analysis.context.reparse_denied".to_string());
        }
    }
    Ok(())
}

fn truncate_chars(content: &str, limit: usize) -> (String, usize, bool) {
    let original_chars = content.chars().count();
    if original_chars <= limit {
        return (content.to_string(), original_chars, false);
    }
    (content.chars().take(limit).collect(), original_chars, true)
}

fn read_text_context(
    path: &Path,
    char_limit: usize,
) -> Result<(String, usize, bool), &'static str> {
    let bytes = storage::read_file_with_limit(path, MAX_TEXT_BYTES).map_err(|code| {
        match code.as_str() {
            "workspace.file_read.too_large" => "analysis.context.too_large",
            "workspace.file_read.not_file" => "analysis.context.not_file",
            _ => "analysis.context.read_failed",
        }
    })?;
    if bytes.contains(&0) {
        return Err("analysis.context.binary_denied");
    }
    let content = String::from_utf8(bytes).map_err(|_| "analysis.context.invalid_utf8")?;
    Ok(truncate_chars(&content, char_limit))
}

fn validate_pdf_file(path: &Path) -> Result<(), &'static str> {
    let metadata = fs::metadata(path).map_err(|_| "analysis.context.read_failed")?;
    if !metadata.is_file() {
        return Err("analysis.context.not_file");
    }
    if metadata.len() > MAX_PDF_BYTES {
        return Err("analysis.context.too_large");
    }
    let mut file = fs::File::open(path).map_err(|_| "analysis.context.read_failed")?;
    let mut header = [0_u8; 5];
    file.read_exact(&mut header)
        .map_err(|_| "analysis.context.invalid_pdf")?;
    if &header != b"%PDF-" {
        return Err("analysis.context.invalid_pdf");
    }
    Ok(())
}

fn normalize_unique_paths(
    paths: &[String],
) -> Result<(Vec<String>, Vec<AnalysisContextIssue>), AnalysisContextLoadResponse> {
    if paths.len() > MAX_CONTEXT_INPUTS {
        return Err(AnalysisContextLoadResponse {
            items: Vec::new(),
            issues: vec![issue("", "analysis.context.too_many_files")],
        });
    }
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    let mut issues = Vec::new();
    for path in paths {
        match normalize_path(path) {
            Ok(value) => {
                let identity = if cfg!(windows) {
                    value.to_ascii_lowercase()
                } else {
                    value.clone()
                };
                if seen.insert(identity) {
                    normalized.push(value);
                }
            }
            Err(_) => issues.push(issue(path, "analysis.context.path_invalid")),
        }
    }
    if normalized.len() > MAX_CONTEXT_FILES {
        return Err(AnalysisContextLoadResponse {
            items: Vec::new(),
            issues: vec![issue("", "analysis.context.too_many_files")],
        });
    }
    Ok((normalized, issues))
}

fn load_contexts_with<F>(
    project_root: &Path,
    paths: &[String],
    mut load_pdf: F,
) -> AnalysisContextLoadResponse
where
    F: FnMut(&Path) -> Result<storage::WorkspacePdfContextExtract, String>,
{
    let (normalized, mut issues) = match normalize_unique_paths(paths) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let classified = normalized
        .iter()
        .map(|path| (path.clone(), classify_path(path)))
        .collect::<Vec<_>>();
    let pdf_count = classified
        .iter()
        .filter(|(_, kind)| matches!(kind, Ok(ContextKind::Pdf)))
        .count();
    if pdf_count > MAX_PDF_FILES {
        return AnalysisContextLoadResponse {
            items: Vec::new(),
            issues: vec![issue("", "analysis.context.too_many_pdfs")],
        };
    }

    let mut items = Vec::new();
    let mut remaining_chars = MAX_TOTAL_CHARS;
    for (index, (relative_path, classified_kind)) in classified.into_iter().enumerate() {
        let kind = match classified_kind {
            Ok(value) => value,
            Err(code) => {
                issues.push(issue(&relative_path, code));
                continue;
            }
        };
        if let Err(code) = ensure_no_reparse(project_root, &relative_path) {
            issues.push(issue(&relative_path, &code));
            continue;
        }
        let path = match storage::safe_join(project_root, &relative_path) {
            Ok(value) => value,
            Err(_) => {
                issues.push(issue(&relative_path, "analysis.context.path_invalid"));
                continue;
            }
        };
        let remaining_items = normalized.len().saturating_sub(index + 1);
        let reservable = remaining_chars.saturating_sub(remaining_items);
        let item_limit = match kind {
            ContextKind::Text => MAX_TEXT_CHARS,
            ContextKind::Pdf => MAX_PDF_CHARS,
        }
        .min(reservable.max(1));
        let loaded = match kind {
            ContextKind::Text => {
                read_text_context(&path, item_limit).map(|(content, original, truncated)| {
                    AnalysisContextItem {
                        path: relative_path.clone(),
                        kind: "text".to_string(),
                        content,
                        original_chars: original,
                        truncated,
                        page_count: None,
                        ocr_page_count: None,
                        extraction_engine: None,
                        extraction_mode: None,
                    }
                })
            }
            ContextKind::Pdf => validate_pdf_file(&path).and_then(|_| {
                load_pdf(&path)
                    .map_err(|_| "analysis.context.pdf_extract_failed")
                    .map(|pdf| {
                        let (content, original_chars, truncated) =
                            truncate_chars(&pdf.content, item_limit);
                        AnalysisContextItem {
                            path: relative_path.clone(),
                            kind: "pdf".to_string(),
                            content,
                            original_chars,
                            truncated,
                            page_count: Some(pdf.page_count),
                            ocr_page_count: Some(pdf.ocr_page_count),
                            extraction_engine: pdf.extraction_engine,
                            extraction_mode: pdf.extraction_mode,
                        }
                    })
            }),
        };
        match loaded {
            Ok(item) => {
                remaining_chars = remaining_chars.saturating_sub(item.content.chars().count());
                items.push(item);
            }
            Err(code) => issues.push(issue(&relative_path, code)),
        }
    }
    AnalysisContextLoadResponse { items, issues }
}

fn load_analysis_context_blocking(
    db_path: &Path,
    runtime_root: &Path,
    app_data_dir: &Path,
    input: AnalysisContextLoadInput,
) -> Result<AnalysisContextLoadResponse, String> {
    let project_root = storage::load_project_root(db_path, &input.project_id)?;
    Ok(load_contexts_with(&project_root, &input.paths, |source| {
        storage::extract_workspace_pdf_context(
            db_path,
            runtime_root,
            app_data_dir,
            &input.project_id,
            &project_root,
            source,
        )
    }))
}

#[tauri::command]
pub async fn analysis_context_load(
    state: State<'_, AppState>,
    input: AnalysisContextLoadInput,
) -> Result<AnalysisContextLoadResponse, String> {
    let db_path = state.db_path.clone();
    let runtime_root = state.runtime_root.clone();
    let app_data_dir = state.app_data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        load_analysis_context_blocking(&db_path, &runtime_root, &app_data_dir, input)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn fixture() -> std::path::PathBuf {
        let root =
            std::env::temp_dir().join(format!("latotex-analysis-context-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn no_pdf(_: &Path) -> Result<storage::WorkspacePdfContextExtract, String> {
        Err("unexpected pdf extraction".to_string())
    }

    #[test]
    fn loads_allowed_text_and_dotfiles_with_bounded_content() {
        let root = fixture();
        fs::write(root.join("paper.tex"), "a".repeat(5_000)).unwrap();
        fs::write(root.join(".gitignore"), "target\n").unwrap();
        let response = load_contexts_with(
            &root,
            &["paper.tex".to_string(), ".gitignore".to_string()],
            no_pdf,
        );
        assert!(response.issues.is_empty());
        assert_eq!(response.items.len(), 2);
        assert_eq!(response.items[0].content.chars().count(), MAX_TEXT_CHARS);
        assert!(response.items[0].truncated);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_escape_credentials_unknown_dotfiles_binary_and_invalid_pdf() {
        let root = fixture();
        fs::write(root.join(".env"), "TOKEN=secret").unwrap();
        fs::write(root.join(".unknown"), "value").unwrap();
        fs::write(root.join("notes.txt"), b"text\0binary").unwrap();
        fs::write(root.join("fake.pdf"), b"not a pdf").unwrap();
        let response = load_contexts_with(
            &root,
            &[
                "../escape.tex".to_string(),
                ".env".to_string(),
                ".unknown".to_string(),
                "notes.txt".to_string(),
                "fake.pdf".to_string(),
            ],
            no_pdf,
        );
        let codes = response
            .issues
            .iter()
            .map(|item| item.code.as_str())
            .collect::<HashSet<_>>();
        assert!(codes.contains("analysis.context.path_invalid"));
        assert!(codes.contains("analysis.context.credential_denied"));
        assert!(codes.contains("analysis.context.dotfile_denied"));
        assert!(codes.contains("analysis.context.binary_denied"));
        assert!(codes.contains("analysis.context.invalid_pdf"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn enforces_file_and_pdf_counts_before_materialization() {
        let root = fixture();
        let too_many = (0..9)
            .map(|index| format!("{index}.txt"))
            .collect::<Vec<_>>();
        let response = load_contexts_with(&root, &too_many, no_pdf);
        assert_eq!(response.issues[0].code, "analysis.context.too_many_files");

        for index in 0..3 {
            fs::write(root.join(format!("{index}.pdf")), b"%PDF-").unwrap();
        }
        let response = load_contexts_with(
            &root,
            &["0.pdf".into(), "1.pdf".into(), "2.pdf".into()],
            no_pdf,
        );
        assert_eq!(response.issues[0].code, "analysis.context.too_many_pdfs");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn counts_normalized_unique_paths_and_bounds_raw_input_amplification() {
        let root = fixture();
        fs::write(root.join("notes.txt"), "notes").unwrap();
        let response = load_contexts_with(
            &root,
            &[
                " notes.txt ".into(),
                ".\\notes.txt".into(),
                "notes.txt".into(),
                " ".into(),
            ],
            no_pdf,
        );
        assert_eq!(response.items.len(), 1);
        assert_eq!(response.items[0].path, "notes.txt");
        assert_eq!(response.issues.len(), 1);
        assert_eq!(response.issues[0].code, "analysis.context.path_invalid");

        let duplicate_inputs = (0..(MAX_CONTEXT_FILES + 1))
            .map(|index| {
                if index % 2 == 0 {
                    "notes.txt".to_string()
                } else {
                    ".\\notes.txt".to_string()
                }
            })
            .collect::<Vec<_>>();
        let response = load_contexts_with(&root, &duplicate_inputs, no_pdf);
        assert!(response.issues.is_empty());
        assert_eq!(response.items.len(), 1);

        let amplified = vec!["notes.txt".to_string(); MAX_CONTEXT_INPUTS + 1];
        let response = load_contexts_with(&root, &amplified, no_pdf);
        assert_eq!(response.issues[0].code, "analysis.context.too_many_files");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_invalid_utf8_oversized_text_and_directories() {
        let root = fixture();
        fs::write(root.join("invalid.txt"), [0xff, 0xfe, 0xfd]).unwrap();
        fs::write(
            root.join("large.txt"),
            vec![b'a'; MAX_TEXT_BYTES as usize + 1],
        )
        .unwrap();
        fs::create_dir_all(root.join("folder.txt")).unwrap();
        let response = load_contexts_with(
            &root,
            &[
                "invalid.txt".into(),
                "large.txt".into(),
                "folder.txt".into(),
            ],
            no_pdf,
        );
        let codes = response
            .issues
            .iter()
            .map(|item| item.code.as_str())
            .collect::<HashSet<_>>();
        assert!(codes.contains("analysis.context.invalid_utf8"));
        assert!(codes.contains("analysis.context.too_large"));
        assert!(codes.contains("analysis.context.not_file"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn shares_total_character_budget_without_emptying_later_files() {
        let root = fixture();
        let paths = (0..4)
            .map(|index| {
                let path = format!("{index}.txt");
                fs::write(root.join(&path), "x".repeat(5_000)).unwrap();
                path
            })
            .collect::<Vec<_>>();
        let response = load_contexts_with(&root, &paths, no_pdf);
        assert!(response.issues.is_empty());
        assert_eq!(response.items.len(), 4);
        assert_eq!(
            response
                .items
                .iter()
                .map(|item| item.content.chars().count())
                .sum::<usize>(),
            MAX_TOTAL_CHARS,
        );
        assert!(response.items.iter().all(|item| !item.content.is_empty()));
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn rejects_reparse_ancestors_when_junction_creation_is_available() {
        let root = fixture();
        let outside = fixture();
        fs::write(outside.join("paper.tex"), "outside").unwrap();
        let junction = root.join("linked");
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&junction)
            .arg(&outside)
            .status()
            .unwrap();
        if status.success() {
            let response = load_contexts_with(&root, &["linked/paper.tex".into()], no_pdf);
            assert_eq!(response.issues[0].code, "analysis.context.reparse_denied");
            fs::remove_dir(&junction).unwrap();
        }
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }
}
