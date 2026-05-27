use super::plugins::validate_manifest;
use crate::models::{
    PluginCapabilities, PluginCatalogEntry, PluginContribution, PluginEngines, PluginManifest,
    PluginToolchainInstaller,
};

const PLUGIN_SCHEMA: &str = "latotex.plugin.v1";

fn empty_contribution(kind: &str, id: &str, title: &str) -> PluginContribution {
    PluginContribution {
        kind: kind.to_string(),
        id: id.to_string(),
        title: title.to_string(),
        description: None,
        command_ref: None,
        location: None,
        group: None,
        when: None,
        mcp_server: None,
        command: None,
        skill_id: None,
        toolchain_installer: None,
    }
}

fn entry(manifest: PluginManifest) -> PluginCatalogEntry {
    let validation = validate_manifest(&manifest);
    PluginCatalogEntry {
        manifest,
        source_id: "builtin".to_string(),
        source_name: "Built-in".to_string(),
        validation,
    }
}

pub(crate) fn built_in_catalog() -> Vec<PluginCatalogEntry> {
    let mut docx_page = empty_contribution("workspacePage", "docx", "DOCX");
    docx_page.description = Some("DOCX editor under the LaTeX workspace.".to_string());
    let mut docx_tool = empty_contribution("docxTool", "docx.richText.v1", "DOCX rich text bridge");
    docx_tool.description = Some("Reads and writes common DOCX text structures.".to_string());

    let docx_manifest = PluginManifest {
        schema: PLUGIN_SCHEMA.to_string(),
        id: "latotex.docx-workspace".to_string(),
        name: "DOCX Workspace".to_string(),
        display_name: Some("DOCX Workspace".to_string()),
        publisher: "LatoTex".to_string(),
        version: "1.2.0".to_string(),
        description: "Adds DOCX reading, rich text editing, package-preserving save, and document tools.".to_string(),
        categories: vec!["Editor".to_string(), "Office".to_string()],
        icon: None,
        download_url: None,
        sha256: None,
        homepage: None,
        repository: None,
        license: Some("Bundled".to_string()),
        keywords: vec!["docx".to_string(), "word".to_string(), "office".to_string()],
        engines: Some(PluginEngines { latotex: Some(">=0.1.0".to_string()) }),
        activation_events: vec!["onWorkspaceContains:**/*.docx".to_string()],
        capabilities: Some(PluginCapabilities {
            untrusted_workspaces: Some("limited".to_string()),
            virtual_workspaces: Some(false),
        }),
        permissions: vec!["workspace.read".to_string(), "workspace.write".to_string()],
        contributions: vec![docx_page, docx_tool],
    };

    let mut cpp_installer = empty_contribution("toolchainInstaller", "llvm-mingw.windows-x64", "LLVM MinGW");
    cpp_installer.description = Some("Portable Windows x64 C/C++ compiler toolchain.".to_string());
    cpp_installer.toolchain_installer = Some(PluginToolchainInstaller {
        id: "llvm-mingw".to_string(),
        kind: "cpp".to_string(),
        platform: "windows-x64".to_string(),
        download_url: "https://example.invalid/llvm-mingw-windows-x64.zip".to_string(),
        sha256: "0000000000000000000000000000000000000000000000000000000000000000".to_string(),
        archive_format: "zip".to_string(),
        executable: "bin/clang++.exe".to_string(),
        version_arg: Some("--version".to_string()),
    });
    let toolchain_manifest = PluginManifest {
        schema: PLUGIN_SCHEMA.to_string(),
        id: "latotex.toolchains.windows".to_string(),
        name: "Windows Toolchains".to_string(),
        display_name: Some("Windows Toolchains".to_string()),
        publisher: "LatoTex".to_string(),
        version: "0.1.0".to_string(),
        description: "Declares safe installer templates for common Windows x64 development tools.".to_string(),
        categories: vec!["Toolchains".to_string(), "Runtime".to_string()],
        icon: None,
        download_url: None,
        sha256: None,
        homepage: None,
        repository: None,
        license: Some("Bundled template".to_string()),
        keywords: vec!["compiler".to_string(), "cpp".to_string(), "git".to_string()],
        engines: Some(PluginEngines { latotex: Some(">=0.1.0".to_string()) }),
        activation_events: vec!["onMarkdownCode:c".to_string(), "onMarkdownCode:cpp".to_string()],
        capabilities: Some(PluginCapabilities {
            untrusted_workspaces: Some("limited".to_string()),
            virtual_workspaces: Some(false),
        }),
        permissions: vec!["network.fetch".to_string(), "process.spawn".to_string()],
        contributions: vec![cpp_installer],
    };

    vec![entry(docx_manifest), entry(toolchain_manifest)]
}
