use super::plugins::validate_manifest;
use super::plugins_builtin::built_in_catalog;
use crate::models::{
    PluginAgentContextPack, PluginCommandRef, PluginContribution, PluginFileOpenHandler,
    PluginCommandPaletteItem, PluginFileTemplate, PluginLanguageSupport, PluginManifest,
    PluginPanel, PluginPreviewProvider, PluginProblemMatcher, PluginResourceClassifier,
    PluginRuntimeAssetDetector, PluginSidebarView, PluginTreeDecoration,
    PluginSettingsSchema, PluginSettingsSchemaField, PluginSnippet, PluginSnippetProvider,
    PluginToolchainInstaller, PluginToolchainProbe,
};

fn manifest_with_contribution(contribution: PluginContribution) -> PluginManifest {
    PluginManifest {
        schema: "latotex.plugin.v1".to_string(),
        id: "publisher.safe-plugin".to_string(),
        name: "Safe Plugin".to_string(),
        display_name: None,
        publisher: "Publisher".to_string(),
        version: "1.0.0".to_string(),
        description: "Safe plugin".to_string(),
        categories: vec!["Editor".to_string()],
        icon: None,
        download_url: None,
        sha256: None,
        homepage: None,
        repository: Some("https://example.com/repo".to_string()),
        license: Some("MIT".to_string()),
        keywords: Vec::new(),
        engines: None,
        activation_events: Vec::new(),
        capabilities: None,
        permissions: Vec::new(),
        contributions: vec![contribution],
        localized: None,
    }
}

fn base_contribution(kind: &str) -> PluginContribution {
    PluginContribution {
        kind: kind.to_string(),
        id: "publisher.safe-plugin.action".to_string(),
        title: "Action".to_string(),
        description: None,
        command_ref: None,
        location: None,
        group: None,
        when: None,
        mcp_server: None,
        command: None,
        skill_id: None,
        toolchain_installer: None,
        toolchain_probe: None,
        runtime_asset: None,
        file_open_handler: None,
        preview_provider: None,
        resource_badge: None,
        resource_classifier: None,
        problem_matcher: None,
        plugin_panel: None,
        settings_quick_action: None,
        runtime_asset_detector: None,
        settings_schema: None,
        file_template: None,
        snippet_provider: None,
        agent_context_pack: None,
        language_support: None,
        sidebar_view: None,
        tree_decoration: None,
        command_palette_item: None,
        localized: None,
    }
}

#[test]
fn declarative_plugin_command_requires_safe_command_ref() {
    let mut contribution = base_contribution("toolbarButton");
    contribution.location = Some("docx.ribbon.file".to_string());
    contribution.command_ref = Some(PluginCommandRef {
        id: "shell.exec".to_string(),
        title: None,
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(!validation.ok);
    assert!(validation
        .issues
        .iter()
        .any(|issue| issue.code == "plugin.contribution.command_ref_unsafe"));
}

#[test]
fn markdown_plugin_command_accepts_allowlisted_runner() {
    let mut contribution = base_contribution("markdownCommand");
    contribution.command_ref = Some(PluginCommandRef {
        id: "markdown.runFence".to_string(),
        title: Some("Run code block".to_string()),
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(validation.ok, "{:?}", validation.issues);
}

#[test]
fn toolchain_installer_requires_https_and_hash() {
    let mut contribution = base_contribution("toolchainInstaller");
    contribution.toolchain_installer = Some(PluginToolchainInstaller {
        id: "cpp".to_string(),
        kind: "cpp".to_string(),
        platform: "windows-x64".to_string(),
        download_url: "http://example.com/compiler.zip".to_string(),
        download_url_cn: None,
        sha256: "missing".to_string(),
        archive_format: "zip".to_string(),
        executable: "bin/clang++.exe".to_string(),
        version_arg: Some("--version".to_string()),
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(!validation.ok);
    assert!(validation
        .issues
        .iter()
        .any(|issue| issue.code == "plugin.contribution.toolchain_integrity"));
}

#[test]
fn go_toolchain_installer_is_allowed_when_integrity_is_declared() {
    let mut contribution = base_contribution("toolchainInstaller");
    contribution.toolchain_installer = Some(PluginToolchainInstaller {
        id: "go".to_string(),
        kind: "go".to_string(),
        platform: "windows-x64".to_string(),
        download_url: "https://example.com/go.zip".to_string(),
        download_url_cn: None,
        sha256: "a".repeat(64),
        archive_format: "zip".to_string(),
        executable: "go/bin/go.exe".to_string(),
        version_arg: Some("version".to_string()),
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(validation.ok, "{:?}", validation.issues);
}

#[test]
fn rust_toolchain_probe_is_allowed_without_installer() {
    let mut contribution = base_contribution("toolchainProbe");
    contribution.toolchain_probe = Some(PluginToolchainProbe {
        id: "rust".to_string(),
        kind: "rust".to_string(),
        platform: "windows-x64".to_string(),
        executables: vec!["rustc.exe".to_string(), "cargo.exe".to_string()],
        version_arg: Some("--version".to_string()),
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(validation.ok, "{:?}", validation.issues);
}

#[test]
fn toolchain_probe_rejects_paths() {
    let mut contribution = base_contribution("toolchainProbe");
    contribution.toolchain_probe = Some(PluginToolchainProbe {
        id: "rust".to_string(),
        kind: "rust".to_string(),
        platform: "windows-x64".to_string(),
        executables: vec!["bin/rustc.exe".to_string()],
        version_arg: Some("--version".to_string()),
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(!validation.ok);
    assert!(validation
        .issues
        .iter()
        .any(|issue| issue.code == "plugin.contribution.toolchain_probe_invalid"));
}

#[test]
fn declarative_plugin_command_accepts_allowlisted_command_ref() {
    let mut contribution = base_contribution("docxCommand");
    contribution.command_ref = Some(PluginCommandRef {
        id: "docx.save".to_string(),
        title: Some("Save".to_string()),
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(validation.ok, "{:?}", validation.issues);
}

#[test]
fn analysis_plugin_command_accepts_allowlisted_command_ref() {
    let mut contribution = base_contribution("analysisCommand");
    contribution.command_ref = Some(PluginCommandRef {
        id: "analysis.run".to_string(),
        title: Some("Run analysis".to_string()),
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(validation.ok, "{:?}", validation.issues);
}

#[test]
fn preview_provider_contribution_is_declarative_and_allowed() {
    let mut contribution = base_contribution("previewProvider");
    contribution.preview_provider = Some(PluginPreviewProvider {
        extensions: vec!["md".to_string()],
        filenames: Vec::new(),
        preview_mode: "markdown".to_string(),
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(validation.ok, "{:?}", validation.issues);
}

#[test]
fn library_plugin_command_rejects_unsafe_command_ref() {
    let mut contribution = base_contribution("libraryCommand");
    contribution.command_ref = Some(PluginCommandRef {
        id: "network.fetch".to_string(),
        title: None,
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(!validation.ok);
    assert!(validation
        .issues
        .iter()
        .any(|issue| issue.code == "plugin.contribution.command_ref_unsafe"));
}

#[test]
fn file_open_handler_accepts_safe_extensions_and_targets() {
    let mut contribution = base_contribution("fileOpenHandler");
    contribution.file_open_handler = Some(PluginFileOpenHandler {
        extensions: vec!["toml".to_string(), ".json".to_string()],
        filenames: Vec::new(),
        open_with: "text".to_string(),
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(validation.ok, "{:?}", validation.issues);
}

#[test]
fn preview_provider_rejects_script_like_modes() {
    let mut contribution = base_contribution("previewProvider");
    contribution.preview_provider = Some(PluginPreviewProvider {
        extensions: vec!["abc".to_string()],
        filenames: Vec::new(),
        preview_mode: "javascript".to_string(),
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(!validation.ok);
    assert!(validation
        .issues
        .iter()
        .any(|issue| issue.code == "plugin.contribution.preview_provider_invalid"));
}

#[test]
fn runtime_asset_detector_rejects_paths() {
    let mut contribution = base_contribution("runtimeAssetDetector");
    contribution.runtime_asset_detector = Some(PluginRuntimeAssetDetector {
        kind: "uv".to_string(),
        filenames: vec!["bin/uv.exe".to_string()],
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(!validation.ok);
    assert!(validation
        .issues
        .iter()
        .any(|issue| issue.code == "plugin.contribution.runtime_asset_detector_invalid"));
}

#[test]
fn settings_schema_accepts_bounded_fields() {
    let mut contribution = base_contribution("settingsSchema");
    contribution.settings_schema = Some(PluginSettingsSchema {
        section: "editor".to_string(),
        fields: vec![PluginSettingsSchemaField {
            key: "my-plugin.option".to_string(),
            field_kind: "boolean".to_string(),
            label: "Enable option".to_string(),
            required: Some(false),
            options: Vec::new(),
        }],
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(validation.ok, "{:?}", validation.issues);
}

#[test]
fn file_template_rejects_path_traversal_name() {
    let mut contribution = base_contribution("fileTemplate");
    contribution.file_template = Some(PluginFileTemplate {
        extensions: vec!["tex".to_string()],
        default_name: "..\\unsafe.tex".to_string(),
        template_kind: "latex".to_string(),
        content: "\\documentclass{article}".to_string(),
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(!validation.ok);
    assert!(validation
        .issues
        .iter()
        .any(|issue| issue.code == "plugin.contribution.file_template_invalid"));
}

#[test]
fn snippet_provider_rejects_unknown_language() {
    let mut contribution = base_contribution("snippetProvider");
    contribution.snippet_provider = Some(PluginSnippetProvider {
        languages: vec!["powershell".to_string()],
        snippets: vec![PluginSnippet {
            label: "Run".to_string(),
            prefix: "run".to_string(),
            body: "Start-Process calc".to_string(),
        }],
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(!validation.ok);
    assert!(validation
        .issues
        .iter()
        .any(|issue| issue.code == "plugin.contribution.snippet_provider_invalid"));
}

#[test]
fn agent_context_pack_rejects_absolute_patterns() {
    let mut contribution = base_contribution("agentContextPack");
    contribution.agent_context_pack = Some(PluginAgentContextPack {
        scopes: vec!["selectedFile".to_string()],
        include_patterns: vec!["C:/Users/secrets/*".to_string()],
        exclude_patterns: Vec::new(),
        max_files: Some(8),
        max_bytes: Some(8192),
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(!validation.ok);
    assert!(validation
        .issues
        .iter()
        .any(|issue| issue.code == "plugin.contribution.agent_context_pack_invalid"));
}

#[test]
fn file_open_handler_accepts_dotfile_filenames() {
    let mut contribution = base_contribution("fileOpenHandler");
    contribution.file_open_handler = Some(PluginFileOpenHandler {
        extensions: Vec::new(),
        filenames: vec![".gitignore".to_string(), ".npmrc".to_string()],
        open_with: "text".to_string(),
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(validation.ok, "{:?}", validation.issues);
}

#[test]
fn language_support_rejects_custom_runtime_languages() {
    let mut contribution = base_contribution("languageSupport");
    contribution.language_support = Some(PluginLanguageSupport {
        language: "custom-script".to_string(),
        extensions: vec!["evil".to_string()],
        filenames: Vec::new(),
        editor_language: Some("javascript".to_string()),
        preview_mode: Some("script".to_string()),
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(!validation.ok);
    assert!(validation
        .issues
        .iter()
        .any(|issue| issue.code == "plugin.contribution.language_support_invalid"));
}

#[test]
fn language_support_accepts_builtin_dotfile_binding() {
    let mut contribution = base_contribution("languageSupport");
    contribution.language_support = Some(PluginLanguageSupport {
        language: "ignore".to_string(),
        extensions: Vec::new(),
        filenames: vec![".gitignore".to_string()],
        editor_language: Some("ignore".to_string()),
        preview_mode: Some("text".to_string()),
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(validation.ok, "{:?}", validation.issues);
}

#[test]
fn resource_classifier_accepts_safe_declarative_metadata() {
    let mut contribution = base_contribution("resourceClassifier");
    contribution.resource_classifier = Some(PluginResourceClassifier {
        extensions: vec!["typ".to_string()],
        filenames: Vec::new(),
        patterns: vec!["chapters/*.typ".to_string()],
        category: "source".to_string(),
        icon: Some("code".to_string()),
        color: Some("blue".to_string()),
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(validation.ok, "{:?}", validation.issues);
}

#[test]
fn problem_matcher_rejects_unbounded_groups() {
    let mut contribution = base_contribution("problemMatcher");
    contribution.problem_matcher = Some(PluginProblemMatcher {
        owner: "typst".to_string(),
        pattern: "^(.*):(\\d+):(.*)$".to_string(),
        file_group: Some(1),
        line_group: Some(99),
        column_group: None,
        message_group: Some(3),
        severity: Some("error".to_string()),
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(!validation.ok);
    assert!(validation
        .issues
        .iter()
        .any(|issue| issue.code == "plugin.contribution.problem_matcher_invalid"));
}

#[test]
fn plugin_panel_rejects_script_markdown() {
    let mut contribution = base_contribution("pluginPanel");
    contribution.plugin_panel = Some(PluginPanel {
        location: "plugins.details".to_string(),
        title: "Details".to_string(),
        markdown: "<script>alert(1)</script>".to_string(),
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(!validation.ok);
    assert!(validation
        .issues
        .iter()
        .any(|issue| issue.code == "plugin.contribution.plugin_panel_invalid"));
}

#[test]
fn sidebar_view_accepts_static_markdown() {
    let mut contribution = base_contribution("sidebarView");
    contribution.sidebar_view = Some(PluginSidebarView {
        location: "workspace.sidebar".to_string(),
        title: "Reference".to_string(),
        icon: Some("book".to_string()),
        markdown: "### Reference\n\nSafe static content.".to_string(),
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(validation.ok, "{:?}", validation.issues);
}

#[test]
fn tree_decoration_rejects_unsafe_matcher() {
    let mut contribution = base_contribution("treeDecoration");
    contribution.tree_decoration = Some(PluginTreeDecoration {
        extensions: Vec::new(),
        filenames: Vec::new(),
        patterns: vec!["C:/Users/*".to_string()],
        badge: Some("CFG".to_string()),
        color: Some("blue".to_string()),
        icon: Some("settings".to_string()),
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(!validation.ok);
    assert!(validation
        .issues
        .iter()
        .any(|issue| issue.code == "plugin.contribution.tree_decoration_invalid"));
}

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
