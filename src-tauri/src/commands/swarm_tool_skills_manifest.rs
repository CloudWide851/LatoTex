use super::{BuiltInSkill, BUILT_IN_SKILLS, MANIFEST_LIMIT_BYTES};
use ring::digest::{digest, SHA256};
use std::fs;
use std::path::{Path, PathBuf};

pub(super) struct ManifestDocument {
    pub(super) path: PathBuf,
    pub(super) name: String,
    pub(super) description: String,
    pub(super) content: String,
    pub(super) source: &'static str,
}

fn bundled_skill_roots() -> Vec<PathBuf> {
    let mut roots = vec![PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("core")
        .join("skills")];
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            roots.push(exe_dir.join("resources").join("core").join("skills"));
        }
    }
    roots
}

fn custom_skill_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(codex_home) = std::env::var("CODEX_HOME") {
        roots.push(PathBuf::from(codex_home).join("skills"));
    }
    for variable in ["USERPROFILE", "HOME"] {
        if let Ok(home) = std::env::var(variable) {
            roots.push(PathBuf::from(&home).join(".codex").join("skills"));
            roots.push(PathBuf::from(home).join(".agents").join("skills"));
        }
    }
    roots.sort();
    roots.dedup();
    roots
}

fn sha256_hex(bytes: &[u8]) -> String {
    digest(&SHA256, bytes)
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn has_reparse_or_symlink(path: &Path) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return true;
    };
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return true;
        }
    }
    false
}

fn path_chain_is_plain(root: &Path, path: &Path) -> bool {
    if has_reparse_or_symlink(root) {
        return false;
    }
    let Ok(relative) = path.strip_prefix(root) else {
        return false;
    };
    let mut cursor = root.to_path_buf();
    for component in relative.components() {
        cursor.push(component.as_os_str());
        if has_reparse_or_symlink(&cursor) {
            return false;
        }
    }
    true
}

pub(super) fn frontmatter_value(content: &str, key: &str) -> Option<String> {
    let mut lines = content.lines();
    if lines.next()?.trim() != "---" {
        return None;
    }
    for line in lines {
        if line.trim() == "---" {
            break;
        }
        let Some((candidate, value)) = line.split_once(':') else {
            continue;
        };
        if candidate.trim() == key {
            return Some(value.trim().trim_matches(['"', '\'']).to_string());
        }
    }
    None
}

pub(super) fn restricted_frontmatter_key(content: &str) -> bool {
    let restricted = [
        "allowed-tools",
        "tools",
        "permissions",
        "approval",
        "system",
        "system-prompt",
        "harness",
        "write-scope",
    ];
    let mut lines = content.lines();
    if lines.next().map(str::trim) != Some("---") {
        return false;
    }
    lines.take_while(|line| line.trim() != "---").any(|line| {
        line.split_once(':')
            .map(|(key, _)| restricted.contains(&key.trim()))
            .unwrap_or(false)
    })
}

fn load_manifest_from_root(
    root: &Path,
    skill_id: &str,
    source: &'static str,
    expected_sha256: Option<&str>,
) -> Result<ManifestDocument, Vec<String>> {
    let path = root.join(skill_id).join("SKILL.md");
    if !path.is_file() {
        return Err(vec!["skill.validation.manifest_missing".to_string()]);
    }
    let metadata = fs::metadata(&path)
        .map_err(|_| vec!["skill.validation.unreadable_manifest".to_string()])?;
    if metadata.len() > MANIFEST_LIMIT_BYTES {
        return Err(vec!["skill.validation.manifest_too_large".to_string()]);
    }
    let canonical_root = fs::canonicalize(root)
        .map_err(|_| vec!["skill.validation.root_unavailable".to_string()])?;
    let canonical_path = fs::canonicalize(&path)
        .map_err(|_| vec!["skill.validation.unreadable_manifest".to_string()])?;
    if !canonical_path.starts_with(&canonical_root) || !path_chain_is_plain(root, &path) {
        return Err(vec!["skill.validation.path_escape".to_string()]);
    }
    let bytes = fs::read(&canonical_path)
        .map_err(|_| vec!["skill.validation.unreadable_manifest".to_string()])?;
    if expected_sha256.is_some_and(|expected| sha256_hex(&bytes) != expected) {
        return Err(vec!["skill.validation.signature_mismatch".to_string()]);
    }
    let content =
        String::from_utf8(bytes).map_err(|_| vec!["skill.validation.invalid_utf8".to_string()])?;
    if restricted_frontmatter_key(&content) {
        return Err(vec!["skill.validation.restricted_frontmatter".to_string()]);
    }
    let name = frontmatter_value(&content, "name")
        .filter(|value| !value.is_empty())
        .ok_or_else(|| vec!["skill.validation.name_missing".to_string()])?;
    if name != skill_id {
        return Err(vec!["skill.validation.name_mismatch".to_string()]);
    }
    let description = frontmatter_value(&content, "description")
        .filter(|value| !value.is_empty())
        .ok_or_else(|| vec!["skill.validation.description_missing".to_string()])?;
    Ok(ManifestDocument {
        path: canonical_path,
        name,
        description,
        content,
        source,
    })
}

pub(super) fn resolve_manifest(
    skill_id: &str,
) -> Result<ManifestDocument, (Option<PathBuf>, Vec<String>)> {
    let built_in: Option<&BuiltInSkill> = BUILT_IN_SKILLS.iter().find(|skill| skill.id == skill_id);
    let roots = if built_in.is_some() {
        bundled_skill_roots()
    } else {
        custom_skill_roots()
    };
    let mut last_path = None;
    let mut last_details = vec!["skill.validation.manifest_missing".to_string()];
    for root in roots {
        let path = root.join(skill_id).join("SKILL.md");
        if path.exists() {
            last_path = Some(path);
        }
        match load_manifest_from_root(
            &root,
            skill_id,
            if built_in.is_some() {
                "builtIn"
            } else {
                "custom"
            },
            built_in.map(|skill| skill.sha256),
        ) {
            Ok(document) => return Ok(document),
            Err(details) if last_path.is_some() => last_details = details,
            Err(_) => {}
        }
    }
    Err((last_path, last_details))
}
