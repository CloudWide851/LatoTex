use crate::models::{
    PluginAgentContextPack, PluginContribution, PluginFileOpenHandler, PluginFileTemplate,
    PluginLanguageSupport, PluginPreviewProvider, PluginResourceBadge, PluginRuntimeAssetDetector,
    PluginSettingsQuickAction, PluginSettingsSchema, PluginSnippetProvider, PluginValidationIssue,
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
    if contribution.kind == "settingsSchema" {
        validate_settings_schema(contribution.settings_schema.as_ref(), issues);
    }
    if contribution.kind == "fileTemplate" {
        validate_file_template(contribution.file_template.as_ref(), issues);
    }
    if contribution.kind == "snippetProvider" {
        validate_snippet_provider(contribution.snippet_provider.as_ref(), issues);
    }
    if contribution.kind == "agentContextPack" {
        validate_agent_context_pack(contribution.agent_context_pack.as_ref(), issues);
    }
    if contribution.kind == "languageSupport" {
        validate_language_support(contribution.language_support.as_ref(), issues);
    }
}

fn valid_extension_list(extensions: &[String]) -> bool {
    extensions.len() <= 16
        && extensions.iter().all(|item| {
            let trimmed = item.trim().trim_start_matches('.');
            trimmed.len() <= 32
                && !trimmed.is_empty()
                && trimmed
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
        })
}

fn valid_filename_list(filenames: &[String]) -> bool {
    filenames.len() <= 32
        && filenames.iter().all(|item| {
            let trimmed = item.trim();
            !trimmed.is_empty()
                && trimmed.len() <= 32
                && !trimmed.contains('/')
                && !trimmed.contains('\\')
                && !trimmed.contains("..")
                && trimmed
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
        })
}

fn valid_file_matchers(extensions: &[String], filenames: &[String]) -> bool {
    (!extensions.is_empty() || !filenames.is_empty())
        && valid_extension_list(extensions)
        && valid_filename_list(filenames)
}

fn valid_file_matchers_with_patterns(
    extensions: &[String],
    filenames: &[String],
    patterns: &[String],
) -> bool {
    (!extensions.is_empty() || !filenames.is_empty() || !patterns.is_empty())
        && valid_extension_list(extensions)
        && valid_filename_list(filenames)
        && patterns.len() <= 32
        && patterns.iter().all(|pattern| valid_safe_pattern(pattern))
}

fn valid_safe_key(value: &str, max_len: usize) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty()
        && trimmed.len() <= max_len
        && trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
}

fn valid_filename(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty()
        && trimmed.len() <= 96
        && !trimmed.contains('/')
        && !trimmed.contains('\\')
        && !trimmed.contains("..")
        && trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ' '))
}

fn valid_safe_pattern(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty()
        && trimmed.len() <= 128
        && !trimmed.starts_with('/')
        && !trimmed.starts_with('\\')
        && !trimmed.contains(':')
        && !trimmed.contains("..")
        && trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '/' | '*' | '?'))
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
    if !valid_file_matchers_with_patterns(
        &handler.extensions,
        &handler.filenames,
        &handler.patterns,
    ) || !allowed_targets.contains(handler.open_with.as_str())
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
    if !valid_file_matchers_with_patterns(
        &provider.extensions,
        &provider.filenames,
        &provider.patterns,
    ) || !allowed_modes.contains(provider.preview_mode.as_str())
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
    if !valid_file_matchers(&badge.extensions, &badge.filenames)
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

fn validate_settings_schema(
    schema: Option<&PluginSettingsSchema>,
    issues: &mut Vec<PluginValidationIssue>,
) {
    let Some(schema) = schema else {
        issues.push(issue(
            "plugin.contribution.settings_schema_missing",
            "Settings schema contributions must declare settingsSchema.",
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
    let allowed_field_kinds = HashSet::from(["string", "boolean", "number", "select", "url"]);
    let fields_ok = !schema.fields.is_empty()
        && schema.fields.len() <= 16
        && schema.fields.iter().all(|field| {
            let options_ok = field.options.len() <= 32
                && field
                    .options
                    .iter()
                    .all(|option| !option.trim().is_empty() && option.len() <= 96);
            valid_safe_key(&field.key, 64)
                && allowed_field_kinds.contains(field.field_kind.as_str())
                && !field.label.trim().is_empty()
                && field.label.len() <= 96
                && options_ok
        });
    if !allowed_sections.contains(schema.section.as_str()) || !fields_ok {
        issues.push(issue(
            "plugin.contribution.settings_schema_invalid",
            "Settings schemas must target an allowlisted section and declare bounded safe fields.",
        ));
    }
}

fn validate_file_template(
    template: Option<&PluginFileTemplate>,
    issues: &mut Vec<PluginValidationIssue>,
) {
    let Some(template) = template else {
        issues.push(issue(
            "plugin.contribution.file_template_missing",
            "File template contributions must declare fileTemplate.",
        ));
        return;
    };
    let allowed_template_kinds = HashSet::from(["empty", "latex", "markdown", "docx", "text"]);
    if template.extensions.is_empty()
        || !valid_extension_list(&template.extensions)
        || !valid_filename(&template.default_name)
        || !allowed_template_kinds.contains(template.template_kind.as_str())
        || template.content.len() > 64 * 1024
        || template.content.contains('\0')
    {
        issues.push(issue(
            "plugin.contribution.file_template_invalid",
            "File templates must use safe filenames, known template kinds, and bounded text content.",
        ));
    }
}

fn validate_snippet_provider(
    provider: Option<&PluginSnippetProvider>,
    issues: &mut Vec<PluginValidationIssue>,
) {
    let Some(provider) = provider else {
        issues.push(issue(
            "plugin.contribution.snippet_provider_missing",
            "Snippet provider contributions must declare snippetProvider.",
        ));
        return;
    };
    let allowed_languages = HashSet::from([
        "latex",
        "bibtex",
        "markdown",
        "typescript",
        "javascript",
        "python",
        "rust",
        "go",
        "zig",
        "c",
        "cpp",
        "json",
        "toml",
        "yaml",
        "html",
        "css",
    ]);
    let languages_ok = !provider.languages.is_empty()
        && provider.languages.len() <= 16
        && provider
            .languages
            .iter()
            .all(|language| allowed_languages.contains(language.as_str()));
    let snippets_ok = !provider.snippets.is_empty()
        && provider.snippets.len() <= 64
        && provider.snippets.iter().all(|snippet| {
            !snippet.label.trim().is_empty()
                && snippet.label.len() <= 96
                && valid_safe_key(&snippet.prefix, 64)
                && !snippet.body.trim().is_empty()
                && snippet.body.len() <= 4096
                && !snippet.body.contains('\0')
        });
    if !languages_ok || !snippets_ok {
        issues.push(issue(
            "plugin.contribution.snippet_provider_invalid",
            "Snippet providers must target known languages and bounded safe snippets.",
        ));
    }
}

fn validate_agent_context_pack(
    pack: Option<&PluginAgentContextPack>,
    issues: &mut Vec<PluginValidationIssue>,
) {
    let Some(pack) = pack else {
        issues.push(issue(
            "plugin.contribution.agent_context_pack_missing",
            "Agent context pack contributions must declare agentContextPack.",
        ));
        return;
    };
    let allowed_scopes = HashSet::from([
        "workspaceSummary",
        "selectedFile",
        "openTabs",
        "gitStatus",
        "librarySelection",
    ]);
    let scopes_ok = !pack.scopes.is_empty()
        && pack.scopes.len() <= 8
        && pack
            .scopes
            .iter()
            .all(|scope| allowed_scopes.contains(scope.as_str()));
    let include_ok = !pack.include_patterns.is_empty()
        && pack.include_patterns.len() <= 32
        && pack
            .include_patterns
            .iter()
            .all(|pattern| valid_safe_pattern(pattern));
    let exclude_ok = pack.exclude_patterns.len() <= 32
        && pack
            .exclude_patterns
            .iter()
            .all(|pattern| valid_safe_pattern(pattern));
    let limits_ok = pack.max_files.unwrap_or(1) <= 100 && pack.max_bytes.unwrap_or(1) <= 512 * 1024;
    if !scopes_ok || !include_ok || !exclude_ok || !limits_ok {
        issues.push(issue(
            "plugin.contribution.agent_context_pack_invalid",
            "Agent context packs must use allowlisted scopes, safe relative patterns, and bounded limits.",
        ));
    }
}

fn validate_language_support(
    support: Option<&PluginLanguageSupport>,
    issues: &mut Vec<PluginValidationIssue>,
) {
    let Some(support) = support else {
        issues.push(issue(
            "plugin.contribution.language_support_missing",
            "Language support contributions must declare languageSupport.",
        ));
        return;
    };
    let allowed_languages = HashSet::from([
        "plaintext",
        "latex",
        "bibtex",
        "markdown",
        "typescript",
        "javascript",
        "python",
        "rust",
        "go",
        "zig",
        "c",
        "cpp",
        "json",
        "toml",
        "yaml",
        "html",
        "css",
        "ini",
        "ignore",
        "editorconfig",
        "shell",
        "powershell",
    ]);
    let allowed_preview_modes = HashSet::from([
        "text", "code", "markdown", "html", "image", "pdf", "csv", "excel",
    ]);
    let editor_language = support
        .editor_language
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .unwrap_or(support.language.trim());
    let preview_mode_ok = support
        .preview_mode
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(|item| allowed_preview_modes.contains(item))
        .unwrap_or(true);
    if !allowed_languages.contains(support.language.trim())
        || !allowed_languages.contains(editor_language)
        || !valid_file_matchers_with_patterns(
            &support.extensions,
            &support.filenames,
            &support.patterns,
        )
        || !preview_mode_ok
    {
        issues.push(issue(
            "plugin.contribution.language_support_invalid",
            "Language support must bind safe file matchers to built-in editor and preview modes.",
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
