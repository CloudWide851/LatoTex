use crate::models::SkillValidationResult;
use crate::storage;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

const BUILT_IN_SKILLS: [&str; 4] = ["stitch", "frontend-design", "optimize", "polish"];
const SKILL_ALIASES: [(&str, &str); 1] = [("stitch", "stitch-design")];

pub(super) fn normalize_skill_id(raw: &str) -> Option<String> {
    let value = raw.trim();
    if value.is_empty() || value.len() > 80 {
        return None;
    }
    if !value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':'))
    {
        return None;
    }
    Some(value.to_string())
}

pub(super) fn enabled_skill_ids(db_path: &Path, runtime_root: &Path) -> Vec<String> {
    let settings = storage::load_settings(db_path, runtime_root).ok();
    let skills = settings
        .and_then(|settings| settings.ui_prefs)
        .and_then(|prefs| prefs.enabled_skills)
        .unwrap_or_default();
    skills
        .into_iter()
        .filter_map(|item| normalize_skill_id(&item))
        .filter(|item| validate_normalized_skill(db_path, runtime_root, item).ok)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

pub(super) fn build_enabled_skills_prompt(db_path: &Path, runtime_root: &Path) -> String {
    let skills = enabled_skill_ids(db_path, runtime_root);
    if skills.is_empty() {
        return String::new();
    }
    [
        "[Enabled Agent Skills]".to_string(),
        format!("skills={}", skills.join(",")),
        "Use these skill constraints when they are relevant to the request. Do not claim to execute unavailable skills.".to_string(),
    ]
    .join("\n")
}

pub(super) fn append_skill_context(prompt: &str, skill_context: &str) -> String {
    if skill_context.trim().is_empty() {
        prompt.to_string()
    } else {
        format!("{prompt}\n\n{skill_context}")
    }
}

fn skill_lookup_ids(skill_id: &str) -> Vec<String> {
    let mut ids = vec![skill_id.to_string()];
    for (alias, target) in SKILL_ALIASES {
        if alias == skill_id {
            ids.push(target.to_string());
        }
    }
    ids
}

fn skill_manifest_candidates(skill_id: &str) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(codex_home) = std::env::var("CODEX_HOME") {
        roots.push(PathBuf::from(codex_home).join("skills"));
    }
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        roots.push(PathBuf::from(&user_profile).join(".codex").join("skills"));
        roots.push(PathBuf::from(user_profile).join(".agents").join("skills"));
    }
    if let Ok(home) = std::env::var("HOME") {
        roots.push(PathBuf::from(&home).join(".codex").join("skills"));
        roots.push(PathBuf::from(home).join(".agents").join("skills"));
    }

    let mut candidates = Vec::new();
    for root in roots {
        for lookup_id in skill_lookup_ids(skill_id) {
            candidates.push(root.join(lookup_id).join("SKILL.md"));
        }
    }
    candidates
}

fn validate_skill_manifest(path: &Path) -> (bool, Vec<String>) {
    let Ok(content) = std::fs::read_to_string(path) else {
        return (false, vec!["skill.validation.unreadable_manifest".to_string()]);
    };
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return (false, vec!["skill.validation.empty_manifest".to_string()]);
    }
    let mut details = Vec::new();
    if !trimmed.starts_with("---") {
        details.push("skill.validation.frontmatter_missing".to_string());
    } else {
        let mut header_lines = trimmed.lines();
        let _ = header_lines.next();
        let mut header = String::new();
        for line in header_lines {
            if line.trim() == "---" {
                break;
            }
            header.push_str(line);
            header.push('\n');
        }
        if !header.lines().any(|line| line.trim_start().starts_with("name:")) {
            details.push("skill.validation.name_missing".to_string());
        }
        if !header.lines().any(|line| line.trim_start().starts_with("description:")) {
            details.push("skill.validation.description_missing".to_string());
        }
    }
    (details.is_empty(), details)
}

fn validate_normalized_skill(db_path: &Path, runtime_root: &Path, skill_id: &str) -> SkillValidationResult {
    let source = if BUILT_IN_SKILLS.iter().any(|item| item == &skill_id) {
        "builtIn"
    } else {
        let settings = storage::load_settings(db_path, runtime_root).ok();
        let configured = settings
            .and_then(|settings| settings.ui_prefs)
            .and_then(|prefs| prefs.enabled_skills)
            .unwrap_or_default()
            .into_iter()
            .filter_map(|item| normalize_skill_id(&item))
            .any(|item| item == skill_id);
        if configured { "configured" } else { "custom" }
    };
    for candidate in skill_manifest_candidates(skill_id) {
        if !candidate.is_file() {
            continue;
        }
        let (ok, details) = validate_skill_manifest(&candidate);
        return SkillValidationResult {
            ok,
            skill_id: skill_id.to_string(),
            message: if ok {
                format!("skill.validation.{source}")
            } else {
                "skill.validation.invalid_manifest".to_string()
            },
            source: source.to_string(),
            manifest_path: Some(candidate.to_string_lossy().to_string()),
            details,
        };
    }

    let built_in_without_manifest = source == "builtIn";
    SkillValidationResult {
        ok: built_in_without_manifest,
        skill_id: skill_id.to_string(),
        message: if built_in_without_manifest {
            "skill.validation.builtIn".to_string()
        } else {
            "skill.validation.manifest_missing".to_string()
        },
        source: source.to_string(),
        manifest_path: None,
        details: if built_in_without_manifest {
            vec!["skill.validation.app_builtin".to_string()]
        } else {
            vec!["skill.validation.manifest_missing".to_string()]
        },
    }
}

pub(super) fn validate_skill(
    db_path: &Path,
    runtime_root: &Path,
    raw_skill_id: &str,
) -> Result<SkillValidationResult, String> {
    let Some(skill_id) = normalize_skill_id(raw_skill_id) else {
        return Ok(SkillValidationResult {
            ok: false,
            skill_id: raw_skill_id.trim().to_string(),
            message: "skill.validation.invalid_id".to_string(),
            source: "custom".to_string(),
            manifest_path: None,
            details: vec!["skill.validation.invalid_id".to_string()],
        });
    };
    Ok(validate_normalized_skill(db_path, runtime_root, &skill_id))
}

#[cfg(test)]
mod tests {
    use super::validate_skill_manifest;
    use std::fs;
    use std::path::PathBuf;

    fn temp_manifest_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("latotex-skill-test-{name}-{}.md", std::process::id()))
    }

    #[test]
    fn skill_manifest_validation_requires_frontmatter_name_and_description() {
        let path = temp_manifest_path("valid");
        fs::write(
            &path,
            "---\nname: polish\ndescription: Polish UI\n---\n\n# Skill\n",
        )
        .unwrap();
        let (ok, details) = validate_skill_manifest(&path);
        let _ = fs::remove_file(&path);
        assert!(ok);
        assert!(details.is_empty());
    }

    #[test]
    fn skill_manifest_validation_reports_incomplete_frontmatter() {
        let path = temp_manifest_path("invalid");
        fs::write(&path, "---\nname: polish\n---\n\n# Skill\n").unwrap();
        let (ok, details) = validate_skill_manifest(&path);
        let _ = fs::remove_file(&path);
        assert!(!ok);
        assert!(details.contains(&"skill.validation.description_missing".to_string()));
    }
}
