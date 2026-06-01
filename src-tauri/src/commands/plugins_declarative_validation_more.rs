use crate::models::{
    PluginCommandPaletteItem, PluginContribution, PluginPanel, PluginProblemMatcher,
    PluginResourceClassifier, PluginSidebarView, PluginTreeDecoration, PluginValidationIssue,
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
    if contribution.kind == "sidebarView" {
        validate_sidebar_view(contribution.sidebar_view.as_ref(), issues);
    }
    if contribution.kind == "treeDecoration" {
        validate_tree_decoration(contribution.tree_decoration.as_ref(), issues);
    }
    if contribution.kind == "commandPaletteItem" {
        validate_command_palette_item(contribution, contribution.command_palette_item.as_ref(), issues);
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

fn validate_static_markdown_surface(
    location: &str,
    title: &str,
    markdown: &str,
    allowed_locations: HashSet<&str>,
    code: &str,
    message: &str,
    issues: &mut Vec<PluginValidationIssue>,
) {
    let markdown_lower = markdown.to_ascii_lowercase();
    if !allowed_locations.contains(location)
        || title.trim().is_empty()
        || title.len() > 96
        || markdown.trim().is_empty()
        || markdown.len() > 16 * 1024
        || markdown_lower.contains("<script")
        || markdown_lower.contains("javascript:")
        || markdown.contains('\0')
    {
        issues.push(issue(code, message));
    }
}

fn validate_sidebar_view(view: Option<&PluginSidebarView>, issues: &mut Vec<PluginValidationIssue>) {
    let Some(view) = view else {
        issues.push(issue(
            "plugin.contribution.sidebar_view_missing",
            "Sidebar view contributions must declare sidebarView.",
        ));
        return;
    };
    let allowed_locations = HashSet::from(["workspace.sidebar", "settings.sidebar", "plugins.sidebar"]);
    let allowed_icons = HashSet::from(["file", "code", "book", "image", "table", "settings", "tool"]);
    let icon_ok = view
        .icon
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(|item| allowed_icons.contains(item))
        .unwrap_or(true);
    validate_static_markdown_surface(
        view.location.as_str(),
        view.title.as_str(),
        view.markdown.as_str(),
        allowed_locations,
        "plugin.contribution.sidebar_view_invalid",
        "Sidebar views must target an allowlisted sidebar and provide bounded static markdown only.",
        issues,
    );
    if !icon_ok {
        issues.push(issue(
            "plugin.contribution.sidebar_view_invalid",
            "Sidebar views must use an allowlisted icon.",
        ));
    }
}

fn validate_tree_decoration(
    decoration: Option<&PluginTreeDecoration>,
    issues: &mut Vec<PluginValidationIssue>,
) {
    let Some(decoration) = decoration else {
        issues.push(issue(
            "plugin.contribution.tree_decoration_missing",
            "Tree decoration contributions must declare treeDecoration.",
        ));
        return;
    };
    let allowed_icons = HashSet::from(["file", "code", "book", "image", "table", "settings", "tool"]);
    let allowed_colors = HashSet::from(["neutral", "blue", "green", "amber", "rose", "purple"]);
    let icon_ok = decoration
        .icon
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(|item| allowed_icons.contains(item))
        .unwrap_or(true);
    let color_ok = decoration
        .color
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(|item| allowed_colors.contains(item))
        .unwrap_or(true);
    let badge_ok = decoration
        .badge
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(|item| item.len() <= 12 && !item.contains('<') && !item.contains('\0'))
        .unwrap_or(true);
    if !valid_file_matchers(
        &decoration.extensions,
        &decoration.filenames,
        &decoration.patterns,
    ) || !icon_ok
        || !color_ok
        || !badge_ok
    {
        issues.push(issue(
            "plugin.contribution.tree_decoration_invalid",
            "Tree decorations must use safe file matchers and bounded allowlisted visual metadata.",
        ));
    }
}

fn validate_command_palette_item(
    contribution: &PluginContribution,
    item: Option<&PluginCommandPaletteItem>,
    issues: &mut Vec<PluginValidationIssue>,
) {
    let Some(item) = item else {
        issues.push(issue(
            "plugin.contribution.command_palette_item_missing",
            "Command palette contributions must declare commandPaletteItem.",
        ));
        return;
    };
    let category_ok = item
        .category
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| valid_safe_key(value, 48))
        .unwrap_or(true);
    let keywords_ok = item
        .keywords
        .iter()
        .all(|value| valid_safe_key(value, 32))
        && item.keywords.len() <= 16;
    let command_ref_ok = item
        .command_ref
        .as_ref()
        .zip(contribution.command_ref.as_ref())
        .map(|(item_ref, contribution_ref)| item_ref.id == contribution_ref.id)
        .unwrap_or(false);
    if !command_ref_ok || !category_ok || !keywords_ok {
        issues.push(issue(
            "plugin.contribution.command_palette_item_invalid",
            "Command palette items must mirror the contribution command reference and use bounded category and keywords.",
        ));
    }
}
