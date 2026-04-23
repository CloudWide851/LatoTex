use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::process::Command;
use tauri::State;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSystemFontProbeInput {
    #[serde(default)]
    pub font_families: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSystemFontProbeResult {
    pub requested_fonts: Vec<String>,
    pub matched_fonts: Vec<String>,
    pub missing_fonts: Vec<String>,
    pub installed_fonts: Vec<String>,
    pub installed_count: u32,
    pub source: String,
    pub diagnostic_code: Option<String>,
}

fn normalize_font_name(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        .replace('"', "")
        .replace('\'', "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn parse_registry_font_names(raw: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen = BTreeSet::<String>::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("HKEY_") {
            continue;
        }
        let mut parts = trimmed.splitn(2, "REG_");
        let left = parts.next().unwrap_or("").trim();
        if left.is_empty() {
            continue;
        }
        let family = left
            .split('(')
            .next()
            .map(str::trim)
            .unwrap_or("")
            .to_string();
        if family.is_empty() {
            continue;
        }
        let key = normalize_font_name(&family);
        if key.is_empty() || !seen.insert(key) {
            continue;
        }
        out.push(family);
    }
    out
}

#[cfg(target_os = "windows")]
fn query_fonts_from_registry() -> Result<Vec<String>, String> {
    let roots = [
        r"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts",
        r"HKCU\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts",
    ];
    let mut merged: Vec<String> = Vec::new();
    let mut seen = BTreeSet::<String>::new();
    for root in roots {
        let output = Command::new("reg")
            .args(["query", root])
            .output()
            .map_err(|e| format!("font probe command failed: {e}"))?;
        if !output.status.success() {
            continue;
        }
        let text = String::from_utf8_lossy(&output.stdout).to_string();
        for family in parse_registry_font_names(&text) {
            let key = normalize_font_name(&family);
            if key.is_empty() || !seen.insert(key) {
                continue;
            }
            merged.push(family);
        }
    }
    if merged.is_empty() {
        return Err("font probe returned empty result from registry".to_string());
    }
    Ok(merged)
}

#[cfg(not(target_os = "windows"))]
fn query_fonts_from_registry() -> Result<Vec<String>, String> {
    Err("runtime_system_font_probe is only supported on Windows".to_string())
}

#[tauri::command]
pub fn runtime_system_font_probe(
    state: State<'_, AppState>,
    input: RuntimeSystemFontProbeInput,
) -> Result<RuntimeSystemFontProbeResult, String> {
    let requested_fonts: Vec<String> = input
        .font_families
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect();

    let installed_fonts = query_fonts_from_registry();
    let (all_installed, diagnostic_code) = match installed_fonts {
        Ok(items) => (items, None),
        Err(error) => {
            state.log(
                "WARN",
                &format!("runtime_system_font_probe failed: {error}"),
            );
            (Vec::new(), Some("font_probe.failed".to_string()))
        }
    };

    let installed_map = all_installed
        .iter()
        .map(|item| (normalize_font_name(item), item.clone()))
        .collect::<std::collections::BTreeMap<_, _>>();

    let mut matched_fonts: Vec<String> = Vec::new();
    let mut missing_fonts: Vec<String> = Vec::new();
    for requested in &requested_fonts {
        let key = normalize_font_name(requested);
        if key.is_empty() {
            continue;
        }
        if let Some(found) = installed_map.get(&key) {
            matched_fonts.push(found.clone());
        } else {
            missing_fonts.push(requested.clone());
        }
    }

    Ok(RuntimeSystemFontProbeResult {
        requested_fonts,
        matched_fonts,
        missing_fonts,
        installed_fonts: all_installed.clone(),
        installed_count: all_installed.len() as u32,
        source: "windows.registry".to_string(),
        diagnostic_code,
    })
}

#[cfg(test)]
mod tests {
    use super::parse_registry_font_names;

    #[test]
    fn parses_registry_query_output() {
        let raw = r#"
HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts
    Arial (TrueType)    REG_SZ    arial.ttf
    Times New Roman (TrueType)    REG_SZ    times.ttf
    Arial (TrueType)    REG_SZ    arialbd.ttf
"#;

        let parsed = parse_registry_font_names(raw);
        assert!(parsed.contains(&"Arial".to_string()));
        assert!(parsed.contains(&"Times New Roman".to_string()));
        assert_eq!(parsed.len(), 2);
    }
}
