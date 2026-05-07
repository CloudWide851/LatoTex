use crate::models::SkillValidationResult;
use crate::storage;
use std::collections::BTreeSet;
use std::path::Path;

const BUILT_IN_SKILLS: [&str; 4] = ["stitch", "frontend-design", "optimize", "polish"];

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
        });
    };
    let source = if BUILT_IN_SKILLS.iter().any(|item| item == &skill_id) {
        "builtIn"
    } else if enabled_skill_ids(db_path, runtime_root)
        .iter()
        .any(|item| item == &skill_id)
    {
        "configured"
    } else {
        "custom"
    };
    Ok(SkillValidationResult {
        ok: true,
        skill_id,
        message: format!("skill.validation.{source}"),
        source: source.to_string(),
    })
}
