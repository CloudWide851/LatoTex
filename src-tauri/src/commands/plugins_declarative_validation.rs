use crate::models::{
    PluginContribution, PluginFileOpenHandler, PluginPreviewProvider, PluginResourceBadge,
    PluginRuntimeAssetDetector, PluginSettingsQuickAction, PluginValidationIssue,
};
use std::collections::HashSet;

use super::plugins_policy::{RUNTIME_ASSET_KINDS, SAFE_COMMAND_REFS};

fn issue(code: &str, message: &str) -> PluginValidationIssue {
    PluginValidationIssue {
        code: code.to_string(),
        severity: "error".to_string(),
        message: message.to_string(),
    }
}

pub(crate) fn validate_safe_contribution_details(
    contribution: &PluginContribution,
    issues: &mut Vec<PluginValidationIssue>,
) {
    if contribution.kind == "fileOpenHandler" {
        validate_file_open_handler(contribution.file_open_handler.as_ref(), issues);
    }
    if contribution.kind == "previewProvider" {
        validate_preview_provider(contribution.preview_provider.as_ref(), issues);
    }
    if contribution.kind == "resourceBadge" {
        validate_resource_badge(contribution.resource_badge.as_ref(), issues);
    }
    if contribution.kind == "settingsQuickAction" {
        validate_settings_quick_action(contribution.settings_quick_action.as_ref(), issues);
    }
    if contribution.kind == "runtimeAssetDetector" {
        validate_runtime_asset_detector(contribution.runtime_asset_detector.as_ref(), issues);
    }
}

fn valid_extension_list(extensions: &[String]) -> bool {
    !extensions.is_empty()
        && extensions.len() <= 16
        && extensions.iter().all(|item| {
            let trimmed = item.trim().trim_start_matches('.');
            !trimmed.is_empty()
                && trimmed.len() <= 32
                && trimmed
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
        })
}

fn validate_file_open_handler(
    handler: Option<&PluginFileOpenHandler>,
    issues: &mut Vec<PluginValidationIssue>,
) {
    let Some(handler) = handler else {
        issues.push(issue(
            "plugin.contribution.file_open_handler_missing",
            "File open handler contributions must declare fileOpenHandler.",
        ));
        return;
    };
    let allowed_targets = HashSet::from([
        "text", "monaco", "docx", "markdown", "html", "image", "pdf", "binary",
    ]);
    if !valid_extension_list(&handler.extensions)
        || !allowed_targets.contains(handler.open_with.as_str())
    {
        issues.push(issue(
            "plugin.contribution.file_open_handler_invalid",
            "File open handlers must declare safe extensions and a built-in open target.",
        ));
    }
}

fn validate_preview_provider(
    provider: Option<&PluginPreviewProvider>,
    issues: &mut Vec<PluginValidationIssue>,
) {
    let Some(provider) = provider else {
        issues.push(issue(
            "plugin.contribution.preview_provider_missing",
            "Preview provider contributions must declare previewProvider.",
        ));
        return;
    };
    let allowed_modes = HashSet::from([
        "text", "code", "markdown", "html", "image", "pdf", "csv", "excel",
    ]);
    if !valid_extension_list(&provider.extensions)
        || !allowed_modes.contains(provider.preview_mode.as_str())
    {
        issues.push(issue(
            "plugin.contribution.preview_provider_invalid",
            "Preview providers must bind extensions to a built-in preview mode.",
        ));
    }
}

fn validate_resource_badge(
    badge: Option<&PluginResourceBadge>,
    issues: &mut Vec<PluginValidationIssue>,
) {
    let Some(badge) = badge else {
        issues.push(issue(
            "plugin.contribution.resource_badge_missing",
            "Resource badge contributions must declare resourceBadge.",
        ));
        return;
    };
    let allowed_colors = HashSet::from(["neutral", "blue", "green", "amber", "rose", "purple"]);
    let color_ok = badge
        .color
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(|item| allowed_colors.contains(item))
        .unwrap_or(true);
    if !valid_extension_list(&badge.extensions)
        || badge.label.trim().is_empty()
        || badge.label.len() > 24
        || !color_ok
    {
        issues.push(issue(
            "plugin.contribution.resource_badge_invalid",
            "Resource badges must use safe extensions, a short label, and an allowlisted color.",
        ));
    }
}

fn validate_settings_quick_action(
    action: Option<&PluginSettingsQuickAction>,
    issues: &mut Vec<PluginValidationIssue>,
) {
    let Some(action) = action else {
        issues.push(issue(
            "plugin.contribution.settings_quick_action_missing",
            "Settings quick actions must declare settingsQuickAction.",
        ));
        return;
    };
    let allowed_sections = HashSet::from([
        "plugins",
        "agentPermissions",
        "appearance",
        "runtime",
        "channels",
        "editor",
        "toolchains",
    ]);
    let command_id = action
        .command_ref
        .as_ref()
        .map(|command| command.id.trim())
        .unwrap_or_default();
    if !allowed_sections.contains(action.section.as_str())
        || !SAFE_COMMAND_REFS.contains(&command_id)
    {
        issues.push(issue(
            "plugin.contribution.settings_quick_action_invalid",
            "Settings quick actions must target a known settings section and safe command reference.",
        ));
    }
}

fn validate_runtime_asset_detector(
    detector: Option<&PluginRuntimeAssetDetector>,
    issues: &mut Vec<PluginValidationIssue>,
) {
    let Some(detector) = detector else {
        issues.push(issue(
            "plugin.contribution.runtime_asset_detector_missing",
            "Runtime asset detector contributions must declare runtimeAssetDetector.",
        ));
        return;
    };
    let filenames_ok = !detector.filenames.is_empty()
        && detector.filenames.len() <= 8
        && detector.filenames.iter().all(|item| {
            let trimmed = item.trim();
            !trimmed.is_empty()
                && trimmed.len() <= 64
                && !trimmed.contains('/')
                && !trimmed.contains('\\')
                && trimmed
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
        });
    if !RUNTIME_ASSET_KINDS.contains(&detector.kind.as_str()) || !filenames_ok {
        issues.push(issue(
            "plugin.contribution.runtime_asset_detector_invalid",
            "Runtime asset detectors must target supported assets by filename only.",
        ));
    }
}
