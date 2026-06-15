use super::submission_pack_profiles::{collect_profile_warnings, PackProfile};
use crate::models::{SubmissionPackFile, SubmissionPackIssue, SubmissionPackSkippedFile};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Component, Path, PathBuf};

const MAX_DEPENDENCY_SCAN_BYTES: u64 = 2_000_000;
const TEXT_EXTENSIONS: &[&str] = &["tex", "bib", "sty", "cls", "bst"];
const FIGURE_EXTENSIONS: &[&str] = &["pdf", "png", "jpg", "jpeg"];
const IGNORED_DIRS: &[&str] = &[".git", ".latotex", "node_modules", "target", "dist"];

pub(super) fn normalize_relative_path(input: &str) -> Result<String, String> {
    let value = input
        .trim()
        .replace('\\', "/")
        .trim_matches('/')
        .to_string();
    if value.is_empty() || value.contains('\0') || Path::new(&value).is_absolute() {
        return Err("submissionPack.invalidPath".to_string());
    }
    let mut parts = Vec::<String>::new();
    for component in Path::new(&value).components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().to_string()),
            Component::CurDir => {}
            _ => return Err("submissionPack.pathOutsideProject".to_string()),
        }
    }
    if parts.is_empty() {
        Err("submissionPack.invalidPath".to_string())
    } else {
        Ok(parts.join("/"))
    }
}

pub(super) fn safe_join(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let normalized = normalize_relative_path(relative_path)?;
    let candidate = root.join(&normalized);
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
    let normalized_candidate = if candidate.exists() {
        candidate.canonicalize().map_err(|e| e.to_string())?
    } else {
        let mut existing_parent = candidate.as_path();
        while !existing_parent.exists() {
            existing_parent = existing_parent
                .parent()
                .ok_or_else(|| "submissionPack.invalidPath".to_string())?;
        }
        let canonical_existing = existing_parent.canonicalize().map_err(|e| e.to_string())?;
        let stripped = candidate
            .strip_prefix(existing_parent)
            .map_err(|e| e.to_string())?;
        canonical_existing.join(stripped)
    };
    if !normalized_candidate.starts_with(&canonical_root) {
        return Err("submissionPack.pathOutsideProject".to_string());
    }
    Ok(normalized_candidate)
}

fn to_project_relative(root: &Path, path: &Path) -> Result<String, String> {
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
    let canonical_path = path.canonicalize().map_err(|e| e.to_string())?;
    canonical_path
        .strip_prefix(canonical_root)
        .map_err(|_| "submissionPack.pathOutsideProject".to_string())
        .map(|value| value.to_string_lossy().replace('\\', "/"))
}

fn extension_of(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn is_text_source(path: &str) -> bool {
    TEXT_EXTENSIONS.contains(&extension_of(path).as_str())
}

fn is_allowed_source(path: &str) -> bool {
    let extension = extension_of(path);
    TEXT_EXTENSIONS.contains(&extension.as_str()) || FIGURE_EXTENSIONS.contains(&extension.as_str())
}

fn is_ignored_dir(name: &str) -> bool {
    IGNORED_DIRS
        .iter()
        .any(|item| item.eq_ignore_ascii_case(name))
}

pub(super) fn issue(
    id: &str,
    severity: &str,
    count: Option<u32>,
    detail: Option<String>,
) -> SubmissionPackIssue {
    SubmissionPackIssue {
        id: id.to_string(),
        severity: severity.to_string(),
        count,
        detail,
    }
}

fn read_text_if_small(path: &Path) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_DEPENDENCY_SCAN_BYTES {
        return None;
    }
    fs::read_to_string(path).ok()
}

fn collect_braced_values(source: &str, pattern: &str) -> Vec<String> {
    let mut values = Vec::new();
    let mut start = 0usize;
    while let Some(offset) = source[start..].find(pattern) {
        let command_end = start + offset + pattern.len();
        if source[command_end..]
            .chars()
            .next()
            .is_some_and(|ch| ch.is_ascii_alphabetic())
        {
            start = command_end;
            continue;
        }
        let pattern_start = command_end;
        let Some(open_offset) = source[pattern_start..].find('{') else {
            break;
        };
        let value_start = pattern_start + open_offset + 1;
        let Some(close_offset) = source[value_start..].find('}') else {
            break;
        };
        let raw = source[value_start..value_start + close_offset].trim();
        if !raw.is_empty() {
            values.push(raw.to_string());
        }
        start = value_start + close_offset + 1;
    }
    values
}

fn dependency_candidates(base: &Path, value: &str, default_extensions: &[&str]) -> Vec<PathBuf> {
    let clean = value
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .replace('\\', "/");
    if clean.is_empty() || clean.contains('\0') || Path::new(&clean).is_absolute() {
        return Vec::new();
    }
    let direct = base.join(&clean);
    if Path::new(&clean).extension().is_some() {
        vec![direct]
    } else {
        default_extensions
            .iter()
            .map(|extension| base.join(format!("{clean}.{extension}")))
            .collect()
    }
}

fn normalize_candidate(root: &Path, candidate: &Path) -> Result<PathBuf, String> {
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
    let normalized = if candidate.exists() {
        candidate.canonicalize().map_err(|e| e.to_string())?
    } else {
        let mut existing_parent = candidate;
        while !existing_parent.exists() {
            existing_parent = existing_parent
                .parent()
                .ok_or_else(|| "submissionPack.invalidPath".to_string())?;
        }
        let canonical_existing = existing_parent.canonicalize().map_err(|e| e.to_string())?;
        let stripped = candidate
            .strip_prefix(existing_parent)
            .map_err(|e| e.to_string())?;
        canonical_existing.join(stripped)
    };
    if normalized.starts_with(canonical_root) {
        Ok(normalized)
    } else {
        Err("submissionPack.pathOutsideProject".to_string())
    }
}

fn add_existing_dependency(
    root: &Path,
    pending: &mut Vec<String>,
    included: &mut BTreeSet<String>,
    blockers: &mut Vec<SubmissionPackIssue>,
    base: &Path,
    value: &str,
    extensions: &[&str],
) {
    let candidates = dependency_candidates(base, value, extensions);
    if candidates.is_empty() {
        blockers.push(issue(
            "submissionPack.pathOutsideProject",
            "error",
            None,
            Some(value.to_string()),
        ));
        return;
    }
    let mut outside = false;
    for candidate in candidates {
        let normalized = match normalize_candidate(root, &candidate) {
            Ok(value) => value,
            Err(_) => {
                outside = true;
                continue;
            }
        };
        if normalized.exists() && normalized.is_file() {
            match to_project_relative(root, &normalized) {
                Ok(relative) if is_allowed_source(&relative) => {
                    if included.insert(relative.clone()) && is_text_source(&relative) {
                        pending.push(relative);
                    }
                    return;
                }
                Ok(relative) => {
                    blockers.push(issue(
                        "submissionPack.disallowedDependency",
                        "error",
                        None,
                        Some(relative),
                    ));
                    return;
                }
                Err(_) => outside = true,
            }
        }
    }
    blockers.push(issue(
        if outside {
            "submissionPack.pathOutsideProject"
        } else {
            "submissionPack.missingDependency"
        },
        "error",
        None,
        Some(value.to_string()),
    ));
}

fn add_if_exists(root: &Path, included: &mut BTreeSet<String>, path: &Path) -> Result<(), String> {
    if path.exists() && path.is_file() {
        let relative = to_project_relative(root, path)?;
        if is_allowed_source(&relative) {
            included.insert(relative);
        }
    }
    Ok(())
}

pub(super) fn collect_pack_files(
    root: &Path,
    main_path: &str,
    profile: PackProfile,
) -> (
    Vec<SubmissionPackFile>,
    Vec<SubmissionPackSkippedFile>,
    Vec<SubmissionPackIssue>,
    Vec<SubmissionPackIssue>,
) {
    let mut blockers = Vec::new();
    let mut warnings = Vec::new();
    let mut skipped = Vec::new();
    let mut included = BTreeSet::<String>::new();
    let mut pending = Vec::<String>::new();
    let normalized_main = match normalize_relative_path(main_path) {
        Ok(value) => value,
        Err(error) => {
            blockers.push(issue(&error, "error", None, Some(main_path.to_string())));
            String::new()
        }
    };
    if !normalized_main.is_empty() {
        if extension_of(&normalized_main) != "tex" {
            blockers.push(issue(
                "submissionPack.mainNotTex",
                "error",
                None,
                Some(normalized_main.clone()),
            ));
        }
        let main_target = match safe_join(root, &normalized_main) {
            Ok(value) => value,
            Err(error) => {
                blockers.push(issue(&error, "error", None, Some(normalized_main.clone())));
                root.join(&normalized_main)
            }
        };
        if !main_target.exists() || !main_target.is_file() {
            blockers.push(issue(
                "submissionPack.mainFileMissing",
                "error",
                None,
                Some(normalized_main.clone()),
            ));
        } else if included.insert(normalized_main.clone()) {
            pending.push(normalized_main);
        }
    }

    let mut tex_sources = BTreeMap::<String, String>::new();
    while let Some(relative) = pending.pop() {
        let target = root.join(&relative);
        let Some(source) = read_text_if_small(&target) else {
            continue;
        };
        tex_sources.insert(relative.clone(), source.clone());
        let base = target.parent().unwrap_or(root);
        for value in collect_braced_values(&source, "\\input") {
            add_existing_dependency(
                root,
                &mut pending,
                &mut included,
                &mut blockers,
                base,
                &value,
                &["tex"],
            );
        }
        for value in collect_braced_values(&source, "\\include") {
            add_existing_dependency(
                root,
                &mut pending,
                &mut included,
                &mut blockers,
                base,
                &value,
                &["tex"],
            );
        }
        for value in collect_braced_values(&source, "\\bibliography") {
            for item in value
                .split(',')
                .map(str::trim)
                .filter(|item| !item.is_empty())
            {
                add_existing_dependency(
                    root,
                    &mut pending,
                    &mut included,
                    &mut blockers,
                    base,
                    item,
                    &["bib"],
                );
            }
        }
        for value in collect_braced_values(&source, "\\addbibresource") {
            add_existing_dependency(
                root,
                &mut pending,
                &mut included,
                &mut blockers,
                base,
                &value,
                &["bib"],
            );
        }
        for value in collect_braced_values(&source, "\\includegraphics") {
            add_existing_dependency(
                root,
                &mut pending,
                &mut included,
                &mut blockers,
                base,
                &value,
                FIGURE_EXTENSIONS,
            );
        }
        for value in collect_braced_values(&source, "\\bibliographystyle") {
            let candidates = dependency_candidates(base, &value, &["bst"]);
            for candidate in candidates {
                let _ = add_if_exists(root, &mut included, &candidate);
            }
        }
        for value in collect_braced_values(&source, "\\usepackage") {
            for item in value
                .split(',')
                .map(str::trim)
                .filter(|item| item.contains('/'))
            {
                add_existing_dependency(
                    root,
                    &mut pending,
                    &mut included,
                    &mut blockers,
                    base,
                    item,
                    &["sty"],
                );
            }
        }
        for value in collect_braced_values(&source, "\\documentclass") {
            if value.contains('/') {
                add_existing_dependency(
                    root,
                    &mut pending,
                    &mut included,
                    &mut blockers,
                    base,
                    &value,
                    &["cls"],
                );
            }
        }
    }

    collect_project_allowlist_files(root, &mut included, &mut skipped);
    warnings.extend(collect_profile_warnings(profile, &tex_sources));
    if included.is_empty() {
        blockers.push(issue("submissionPack.noAllowedFiles", "error", None, None));
    }

    let files = included
        .into_iter()
        .filter_map(|relative| {
            let size_bytes = fs::metadata(root.join(&relative)).ok()?.len();
            Some(SubmissionPackFile {
                path: relative,
                size_bytes,
            })
        })
        .collect::<Vec<_>>();
    (files, skipped, blockers, warnings)
}

fn collect_project_allowlist_files(
    root: &Path,
    included: &mut BTreeSet<String>,
    skipped: &mut Vec<SubmissionPackSkippedFile>,
) {
    let mut pending = vec![root.to_path_buf()];
    while let Some(current) = pending.pop() {
        let Ok(entries) = fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path.is_dir() {
                if !is_ignored_dir(&name) {
                    pending.push(path);
                }
                continue;
            }
            let Ok(relative) = to_project_relative(root, &path) else {
                continue;
            };
            if is_allowed_source(&relative) {
                included.insert(relative);
            } else {
                skipped.push(SubmissionPackSkippedFile {
                    path: relative,
                    reason: "unsupportedExtension".to_string(),
                });
            }
        }
    }
    skipped.sort_by(|a, b| a.path.cmp(&b.path));
}
