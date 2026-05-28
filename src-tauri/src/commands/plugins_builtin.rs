use super::plugins::validate_manifest;
use crate::models::{
    PluginCapabilities, PluginCatalogEntry, PluginContribution, PluginEngines, PluginManifest,
    PluginToolchainInstaller, PluginToolchainProbe,
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
        toolchain_probe: None,
    }
}

fn toolchain_probe_manifest(
    id: &str,
    name: &str,
    description: &str,
    contribution_id: &str,
    title: &str,
    probe: PluginToolchainProbe,
    activation_events: Vec<&str>,
    keywords: Vec<&str>,
) -> PluginManifest {
    let mut contribution = empty_contribution("toolchainProbe", contribution_id, title);
    contribution.description = Some(description.to_string());
    contribution.toolchain_probe = Some(probe);
    let mut manifest = base_manifest(id, name, description, vec!["Toolchains", "Runtime"]);
    manifest.activation_events = activation_events.into_iter().map(str::to_string).collect();
    manifest.keywords = keywords.into_iter().map(str::to_string).collect();
    manifest.permissions = vec!["process.spawn".to_string()];
    manifest.contributions = vec![contribution];
    manifest
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

fn base_manifest(id: &str, name: &str, description: &str, categories: Vec<&str>) -> PluginManifest {
    PluginManifest {
        schema: PLUGIN_SCHEMA.to_string(),
        id: id.to_string(),
        name: name.to_string(),
        display_name: Some(name.to_string()),
        publisher: "LatoTex".to_string(),
        version: "0.1.0".to_string(),
        description: description.to_string(),
        categories: categories.into_iter().map(str::to_string).collect(),
        icon: None,
        download_url: None,
        sha256: None,
        homepage: None,
        repository: Some("https://github.com".to_string()),
        license: Some("Bundled template".to_string()),
        keywords: Vec::new(),
        engines: Some(PluginEngines { latotex: Some(">=0.1.0".to_string()) }),
        activation_events: Vec::new(),
        capabilities: Some(PluginCapabilities {
            untrusted_workspaces: Some("limited".to_string()),
            virtual_workspaces: Some(false),
        }),
        permissions: vec!["network.fetch".to_string(), "process.spawn".to_string()],
        contributions: Vec::new(),
    }
}

fn toolchain_manifest(
    id: &str,
    name: &str,
    description: &str,
    contribution_id: &str,
    title: &str,
    installer: PluginToolchainInstaller,
    activation_events: Vec<&str>,
    keywords: Vec<&str>,
) -> PluginManifest {
    let mut contribution = empty_contribution("toolchainInstaller", contribution_id, title);
    contribution.description = Some(description.to_string());
    contribution.toolchain_installer = Some(installer);
    let mut manifest = base_manifest(id, name, description, vec!["Toolchains", "Runtime"]);
    manifest.activation_events = activation_events.into_iter().map(str::to_string).collect();
    manifest.keywords = keywords.into_iter().map(str::to_string).collect();
    manifest.contributions = vec![contribution];
    manifest
}

fn docx_manifest() -> PluginManifest {
    let mut docx_page = empty_contribution("workspacePage", "docx", "DOCX");
    docx_page.description = Some("DOCX editor under the LaTeX workspace.".to_string());
    let mut docx_tool = empty_contribution("docxTool", "docx.richText.v1", "DOCX rich text bridge");
    docx_tool.description = Some("Reads and writes common DOCX text structures.".to_string());
    PluginManifest {
        schema: PLUGIN_SCHEMA.to_string(),
        id: "latotex.docx-workspace".to_string(),
        name: "DOCX Workspace".to_string(),
        display_name: Some("DOCX Workspace".to_string()),
        publisher: "LatoTex".to_string(),
        version: "1.3.0".to_string(),
        description: "Adds DOCX reading, rich text editing, package-preserving save, and document tools.".to_string(),
        categories: vec!["Editor".to_string(), "Office".to_string()],
        icon: None,
        download_url: None,
        sha256: None,
        homepage: None,
        repository: Some("https://github.com".to_string()),
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
    }
}

pub(crate) fn built_in_catalog() -> Vec<PluginCatalogEntry> {
    let llvm_url = "https://github.com/mstorsjo/llvm-mingw/releases/download/20260519/llvm-mingw-20260519-ucrt-x86_64.zip";
    let llvm_sha = "72dbd6e64614e3b3401998992d1bd9c8ace29e74611d71c80309ea71c3fb26f9";
    let go_url = "https://go.dev/dl/go1.26.3.windows-amd64.zip";
    let go_sha = "20d2ceafb4ed41b96b879010927b28bc92a5be57a7c1801ce365a9ca51d3224a";
    let git_url = "https://github.com/git-for-windows/git/releases/download/v2.54.0.windows.1/MinGit-2.54.0-64-bit.zip";
    let git_sha = "04f937e1f0918b17b9be6f2294cb2bb66e96e1d9832d1c298e2de088a1d0e668";

    vec![
        entry(docx_manifest()),
        entry(toolchain_manifest(
            "latotex.toolchain.c",
            "C Compiler",
            "Portable Windows x64 C compiler powered by LLVM-MinGW.",
            "llvm-mingw.c.windows-x64",
            "LLVM-MinGW C",
            PluginToolchainInstaller {
                id: "llvm-mingw-c".to_string(),
                kind: "c".to_string(),
                platform: "windows-x64".to_string(),
                download_url: llvm_url.to_string(),
                sha256: llvm_sha.to_string(),
                archive_format: "zip".to_string(),
                executable: "llvm-mingw-20260519-ucrt-x86_64/bin/clang.exe".to_string(),
                version_arg: Some("--version".to_string()),
            },
            vec!["onMarkdownCode:c"],
            vec!["compiler", "c", "clang"],
        )),
        entry(toolchain_manifest(
            "latotex.toolchain.cpp",
            "C++ Compiler",
            "Portable Windows x64 C++ compiler powered by LLVM-MinGW.",
            "llvm-mingw.cpp.windows-x64",
            "LLVM-MinGW C++",
            PluginToolchainInstaller {
                id: "llvm-mingw-cpp".to_string(),
                kind: "cpp".to_string(),
                platform: "windows-x64".to_string(),
                download_url: llvm_url.to_string(),
                sha256: llvm_sha.to_string(),
                archive_format: "zip".to_string(),
                executable: "llvm-mingw-20260519-ucrt-x86_64/bin/clang++.exe".to_string(),
                version_arg: Some("--version".to_string()),
            },
            vec!["onMarkdownCode:cpp"],
            vec!["compiler", "cpp", "clang"],
        )),
        entry(toolchain_manifest(
            "latotex.toolchain.go",
            "Go Compiler",
            "Portable Windows x64 Go toolchain for Markdown code runs and project tools.",
            "go.windows-x64",
            "Go Windows x64",
            PluginToolchainInstaller {
                id: "go".to_string(),
                kind: "go".to_string(),
                platform: "windows-x64".to_string(),
                download_url: go_url.to_string(),
                sha256: go_sha.to_string(),
                archive_format: "zip".to_string(),
                executable: "go/bin/go.exe".to_string(),
                version_arg: Some("version".to_string()),
            },
            vec!["onCommand:toolchain.install.go"],
            vec!["go", "compiler"],
        )),
        entry(toolchain_manifest(
            "latotex.toolchain.git",
            "Git Tools",
            "Portable MinGit for workspace Git commands when system Git is unavailable.",
            "mingit.windows-x64",
            "MinGit Windows x64",
            PluginToolchainInstaller {
                id: "mingit".to_string(),
                kind: "git".to_string(),
                platform: "windows-x64".to_string(),
                download_url: git_url.to_string(),
                sha256: git_sha.to_string(),
                archive_format: "zip".to_string(),
                executable: "cmd/git.exe".to_string(),
                version_arg: Some("--version".to_string()),
            },
            vec!["onCommand:toolchain.install.git"],
            vec!["git", "mingit"],
        )),
        entry(toolchain_probe_manifest(
            "latotex.toolchain.zig",
            "Zig Toolchain",
            "Detects a configured Windows x64 Zig compiler for Markdown and project tooling.",
            "zig.windows-x64",
            "Zig Windows x64",
            PluginToolchainProbe {
                id: "zig".to_string(),
                kind: "zig".to_string(),
                platform: "windows-x64".to_string(),
                executables: vec!["zig.exe".to_string()],
                version_arg: Some("version".to_string()),
            },
            vec!["onCommand:toolchain.verify.zig"],
            vec!["zig", "compiler"],
        )),
        entry(toolchain_probe_manifest(
            "latotex.toolchain.rust",
            "Rust Toolchain",
            "Detects configured rustc and Cargo without running rustup or global installers.",
            "rust.windows-x64",
            "Rust Windows x64",
            PluginToolchainProbe {
                id: "rust".to_string(),
                kind: "rust".to_string(),
                platform: "windows-x64".to_string(),
                executables: vec!["rustc.exe".to_string(), "cargo.exe".to_string()],
                version_arg: Some("--version".to_string()),
            },
            vec!["onCommand:toolchain.verify.rust"],
            vec!["rust", "cargo", "rustc"],
        )),
    ]
}
