use super::plugins::validate_manifest;
use super::plugins_builtin::built_in_catalog;
use super::plugins_validation_tests::{base_contribution, manifest_with_contribution};
use crate::models::{PluginCommandPaletteItem, PluginCommandRef};

#[test]
fn command_palette_item_accepts_safe_command_ref() {
    let mut contribution = base_contribution("commandPaletteItem");
    contribution.command_ref = Some(PluginCommandRef {
        id: "workspace.rescan".to_string(),
        title: Some("Rescan".to_string()),
    });
    contribution.command_palette_item = Some(PluginCommandPaletteItem {
        category: Some("workspace".to_string()),
        keywords: vec!["rescan".to_string()],
        command_ref: contribution.command_ref.clone(),
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(validation.ok, "{:?}", validation.issues);
}

#[test]
fn command_palette_item_rejects_mismatched_command_ref() {
    let mut contribution = base_contribution("commandPaletteItem");
    contribution.command_ref = Some(PluginCommandRef {
        id: "workspace.rescan".to_string(),
        title: Some("Rescan".to_string()),
    });
    contribution.command_palette_item = Some(PluginCommandPaletteItem {
        category: Some("workspace".to_string()),
        keywords: vec!["rescan".to_string()],
        command_ref: Some(PluginCommandRef {
            id: "docx.save".to_string(),
            title: Some("Save".to_string()),
        }),
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(!validation.ok);
    assert!(validation
        .issues
        .iter()
        .any(|issue| issue.code == "plugin.contribution.command_palette_item_invalid"));
}

#[test]
fn builtin_catalog_hides_bundled_tectonic_and_cloudflared_marketplace_cards() {
    let ids = built_in_catalog()
        .into_iter()
        .map(|entry| entry.manifest.id)
        .collect::<Vec<_>>();
    assert!(!ids.iter().any(|id| id == "latotex.runtime.tectonic"));
    assert!(!ids.iter().any(|id| id == "latotex.runtime.cloudflared"));
    assert!(ids.iter().any(|id| id == "latotex.drawio-runtime"));
}
