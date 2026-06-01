use crate::models::{
    PluginContribution, PluginPanel, PluginProblemMatcher, PluginResourceClassifier,
    PluginValidationIssue,
};
use std::collections::HashSet;

fn issue(code: &str, message: &str) -> PluginValidationIssue {
    PluginValidationIssue {
        code: code.to_string(),
        severity: "error".to_string(),
        message: message.to_string(),
    }
}

pub(crate) fn validate_more_safe_contribution_details(
    contribution: &PluginContribution,
    issues: &mut Vec<PluginValidationIssue>,
) {
    if contribution.kind == "resourceClassifier" {
        validate_resource_classifier(contribution.resource_classifier.as_ref(), issues);
    }
    if contribution.kind == "problemMatcher" {
        validate_problem_matcher(contribution.problem_matcher.as_ref(), issues);
    }
    if contribution.kind == "pluginPanel" {
        validate_plugin_panel(contribution.plugin_panel.as_ref(), issues);
    }
}

fn valid_extension_list(extensions: &[String]) -> bool {
    extensions.len() <= 16
        && extensions.iter().all(|item| {
            let trimmed = item.trim().trim_start_matches('.');
            !trimmed.is_empty()
                && trimmed.len() <= 32
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
                && trimmed.len() <= 64
                && !trimmed.contains('/')
                && !trimmed.contains('\\')
                && !trimmed.contains("..")
                && trimmed
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
        })
}

fn valid_relative_pattern(value: &str) -> bool {
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

fn valid_safe_key(value: &str, max_len: usize) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty()
        && trimmed.len() <= max_len
        && trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
}

fn valid_file_matchers(extensions: &[String], filenames: &[String], patterns: &[String]) -> bool {
    (!extensions.is_empty() || !filenames.is_empty() || !patterns.is_empty())
        && valid_extension_list(extensions)
        && valid_filename_list(filenames)
        && patterns.len() <= 32
        && patterns.iter().all(|pattern| valid_relative_pattern(pattern))
}

fn validate_resource_classifier(
    classifier: Option<&PluginResourceClassifier>,
    issues: &mut Vec<PluginValidationIssue>,
) {
    let Some(classifier) = classifier else {
        issues.push(issue(
            "plugin.contribution.resource_classifier_missing",
            "Resource classifier contributions must declare resourceClassifier.",
        ));
        return;
    };
    let allowed_categories =
        HashSet::from(["source", "document", "data", "image", "config", "runtime"]);
    let allowed_icons = HashSet::from(["file", "code", "book", "image", "table", "settings", "tool"]);
    let allowed_colors = HashSet::from(["neutral", "blue", "green", "amber", "rose", "purple"]);
    let icon_ok = classifier
        .icon
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(|item| allowed_icons.contains(item))
        .unwrap_or(true);
    let color_ok = classifier
        .color
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(|item| allowed_colors.contains(item))
        .unwrap_or(true);
    if !valid_file_matchers(
        &classifier.extensions,
        &classifier.filenames,
        &classifier.patterns,
    ) || !allowed_categories.contains(classifier.category.as_str())
        || !icon_ok
        || !color_ok
    {
        issues.push(issue(
            "plugin.contribution.resource_classifier_invalid",
            "Resource classifiers must use safe file matchers and allowlisted category, icon, and color values.",
        ));
    }
}

fn validate_problem_matcher(
    matcher: Option<&PluginProblemMatcher>,
    issues: &mut Vec<PluginValidationIssue>,
) {
    let Some(matcher) = matcher else {
        issues.push(issue(
            "plugin.contribution.problem_matcher_missing",
            "Problem matcher contributions must declare problemMatcher.",
        ));
        return;
    };
    let allowed_severity = HashSet::from(["info", "warning", "error"]);
    let severity_ok = matcher
        .severity
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(|item| allowed_severity.contains(item))
        .unwrap_or(true);
    let groups_ok = [matcher.file_group, matcher.line_group, matcher.column_group, matcher.message_group]
        .iter()
        .flatten()
        .all(|group| (1..=12).contains(group));
    if !valid_safe_key(&matcher.owner, 64)
        || matcher.pattern.trim().is_empty()
        || matcher.pattern.len() > 512
        || matcher.pattern.contains('\0')
        || !groups_ok
        || !severity_ok
    {
        issues.push(issue(
            "plugin.contribution.problem_matcher_invalid",
            "Problem matchers must declare a bounded regex pattern, safe owner, diagnostic groups, and allowlisted severity.",
        ));
    }
}

fn validate_plugin_panel(panel: Option<&PluginPanel>, issues: &mut Vec<PluginValidationIssue>) {
    let Some(panel) = panel else {
        issues.push(issue(
            "plugin.contribution.plugin_panel_missing",
            "Plugin panel contributions must declare pluginPanel.",
        ));
        return;
    };
    let allowed_locations = HashSet::from(["plugins.details", "settings.plugins", "workspace.empty"]);
    let markdown_lower = panel.markdown.to_ascii_lowercase();
    if !allowed_locations.contains(panel.location.as_str())
        || panel.title.trim().is_empty()
        || panel.title.len() > 96
        || panel.markdown.trim().is_empty()
        || panel.markdown.len() > 16 * 1024
        || markdown_lower.contains("<script")
        || markdown_lower.contains("javascript:")
        || panel.markdown.contains('\0')
    {
        issues.push(issue(
            "plugin.contribution.plugin_panel_invalid",
            "Plugin panels must target an allowlisted surface and provide bounded static markdown only.",
        ));
    }
}
