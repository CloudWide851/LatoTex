use super::plugins::validate_manifest;
use crate::models::{
    PluginCapabilities, PluginCatalogEntry, PluginContribution, PluginEngines, PluginManifest,
    PluginLocalizedManifest, PluginRuntimeAsset, PluginToolchainInstaller, PluginToolchainProbe,
};
use std::collections::HashMap;

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
        runtime_asset: None,
        localized: None,
    }
}

fn localized_manifest(
    en_name: &str,
    en_description: &str,
    en_categories: Vec<&str>,
    zh_name: &str,
    zh_description: &str,
    zh_categories: Vec<&str>,
) -> HashMap<String, PluginLocalizedManifest> {
    HashMap::from([
        ("en-US".to_string(), PluginLocalizedManifest {
            name: Some(en_name.to_string()),
            display_name: Some(en_name.to_string()),
            description: Some(en_description.to_string()),
            categories: en_categories.into_iter().map(str::to_string).collect(),
            keywords: Vec::new(),
        }),
        ("zh-CN".to_string(), PluginLocalizedManifest {
            name: Some(zh_name.to_string()),
            display_name: Some(zh_name.to_string()),
            description: Some(zh_description.to_string()),
            categories: zh_categories.into_iter().map(str::to_string).collect(),
            keywords: Vec::new(),
        }),
    ])
}

fn runtime_asset_manifest(
    id: &str,
    name: &str,
    description: &str,
    contribution_id: &str,
    title: &str,
    asset: PluginRuntimeAsset,
    activation_events: Vec<&str>,
    keywords: Vec<&str>,
) -> PluginManifest {
    let mut contribution = empty_contribution("runtimeAsset", contribution_id, title);
    contribution.description = Some(description.to_string());
    contribution.runtime_asset = Some(asset);
    let mut manifest = base_manifest(id, name, description, vec!["Runtime", "Assets"]);
    manifest.activation_events = activation_events.into_iter().map(str::to_string).collect();
    manifest.keywords = keywords.into_iter().map(str::to_string).collect();
    manifest.permissions = vec!["network.fetch".to_string()];
    manifest.contributions = vec![contribution];
    manifest
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

fn builtin_zh_text(id: &str) -> Option<(&'static str, &'static str, Vec<&'static str>)> {
    match id {
        "latotex.drawio-runtime" => Some(("DrawIO 运行资源", "按需下载绘图工作区需要的 DrawIO Web 运行资源。", vec!["运行资源", "绘图"])),
        "latotex.runtime.uv" => Some(("uv 运行时", "为托管 Python 环境按需下载 uv。", vec!["运行资源", "Python"])),
        "latotex.runtime.tectonic" => Some(("Tectonic 运行时", "为 LaTeX 编译按需下载 Windows x64 Tectonic 编译器。", vec!["运行资源", "LaTeX"])),
        "latotex.runtime.cloudflared" => Some(("Cloudflare Tunnel 运行时", "为公开共享隧道按需下载 cloudflared。", vec!["运行资源", "共享"])),
        "latotex.toolchain.c" => Some(("C 编译器", "由 LLVM-MinGW 提供的 Windows x64 便携 C 编译器。", vec!["工具链", "编译器"])),
        "latotex.toolchain.cpp" => Some(("C++ 编译器", "由 LLVM-MinGW 提供的 Windows x64 便携 C++ 编译器。", vec!["工具链", "编译器"])),
        "latotex.toolchain.go" => Some(("Go 编译器", "用于 Markdown 代码运行和项目工具的 Windows x64 便携 Go 工具链。", vec!["工具链", "编译器"])),
        "latotex.toolchain.git" => Some(("Git 工具", "系统 Git 不可用时用于工作区 Git 命令的便携 MinGit。", vec!["工具链", "Git"])),
        "latotex.toolchain.zig" => Some(("Zig 工具链", "检测已配置的 Windows x64 Zig 编译器，用于 Markdown 和项目工具。", vec!["工具链", "编译器"])),
        "latotex.toolchain.rust" => Some(("Rust 工具链", "检测已配置的 rustc 和 Cargo，不运行 rustup 或全局安装器。", vec!["工具链", "编译器"])),
        _ => None,
    }
}

fn apply_builtin_localization(mut manifest: PluginManifest) -> PluginManifest {
    if let Some((zh_name, zh_description, zh_categories)) = builtin_zh_text(&manifest.id) {
        let en_categories = manifest.categories.iter().map(String::as_str).collect::<Vec<_>>();
        manifest.localized = Some(localized_manifest(
            manifest.display_name.as_deref().unwrap_or(&manifest.name),
            &manifest.description,
            en_categories,
            zh_name,
            zh_description,
            zh_categories,
        ));
    }
    manifest
}

fn entry(manifest: PluginManifest) -> PluginCatalogEntry {
    let manifest = apply_builtin_localization(manifest);
    let validation = validate_manifest(&manifest);
    PluginCatalogEntry {
        manifest,
        source_id: "builtin".to_string(),
        source_name: "Built-in".to_string(),
        validation,
    }
}

fn base_manifest(id: &str, name: &str, description: &str, categories: Vec<&str>) -> PluginManifest {
    let localized = localized_manifest(name, description, categories.clone(), name, description, categories.clone());
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
        localized: Some(localized),
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
        localized: Some(localized_manifest(
            "DOCX Workspace",
            "Adds DOCX reading, rich text editing, package-preserving save, and document tools.",
            vec!["Editor", "Office"],
            "DOCX 工作区",
            "增加 DOCX 读取、富文本编辑、保留包结构保存和文档工具。",
            vec!["编辑器", "Office"],
        )),
    }
}

pub(crate) fn built_in_catalog() -> Vec<PluginCatalogEntry> {
    let llvm_url = "https://github.com/mstorsjo/llvm-mingw/releases/download/20260519/llvm-mingw-20260519-ucrt-x86_64.zip";
    let llvm_sha = "72dbd6e64614e3b3401998992d1bd9c8ace29e74611d71c80309ea71c3fb26f9";
    let go_url = "https://go.dev/dl/go1.26.3.windows-amd64.zip";
    let go_sha = "20d2ceafb4ed41b96b879010927b28bc92a5be57a7c1801ce365a9ca51d3224a";
    let git_url = "https://github.com/git-for-windows/git/releases/download/v2.54.0.windows.1/MinGit-2.54.0-64-bit.zip";
    let git_sha = "04f937e1f0918b17b9be6f2294cb2bb66e96e1d9832d1c298e2de088a1d0e668";
    let tectonic_url = "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%400.16.9/tectonic-0.16.9-x86_64-pc-windows-msvc.zip";
    let cloudflared_url = "https://github.com/cloudflare/cloudflared/releases/download/2025.11.1/cloudflared-windows-amd64.exe";

    vec![
        entry(runtime_asset_manifest(
            "latotex.drawio-runtime",
            "DrawIO Runtime",
            "Downloads the DrawIO web runtime when the drawing workspace is first needed.",
            "drawio.webapp.windows-x64",
            "DrawIO Webapp",
            PluginRuntimeAsset {
                id: "drawio".to_string(),
                kind: "drawio".to_string(),
                platform: "windows-x64".to_string(),
                download_url: "https://github.com/jgraph/drawio/archive/refs/tags/v29.6.6.zip".to_string(),
                download_url_cn: Some("https://gh-proxy.com/https://github.com/jgraph/drawio/archive/refs/tags/v29.6.6.zip".to_string()),
                sha256: "f22ea8ecb61badeb58799e7eddb523aa786558210c488714deb1c2b6fe39ea25".to_string(),
                archive_format: "zip".to_string(),
                entry_path: "drawio-29.6.6/src/main/webapp/index.html".to_string(),
            },
            vec!["onPage:draw"],
            vec!["drawio", "diagram", "drawing"],
        )),
        entry(runtime_asset_manifest(
            "latotex.runtime.uv",
            "uv Runtime",
            "Downloads uv on demand for managed Python environments.",
            "uv.windows-x64",
            "uv Windows x64",
            PluginRuntimeAsset {
                id: "uv".to_string(),
                kind: "uv".to_string(),
                platform: "windows-x64".to_string(),
                download_url: "https://github.com/astral-sh/uv/releases/download/0.11.16/uv-x86_64-pc-windows-msvc.zip".to_string(),
                download_url_cn: Some("https://gh-proxy.com/https://github.com/astral-sh/uv/releases/download/0.11.16/uv-x86_64-pc-windows-msvc.zip".to_string()),
                sha256: "dd9d6d6554bfab265bfa98aa8e8a406c5c3a7b97582f93de1f4d48d9154a0395".to_string(),
                archive_format: "zip".to_string(),
                entry_path: "uv.exe".to_string(),
            },
            vec!["onCommand:analysis.prepareEnv"],
            vec!["uv", "python"],
        )),
        entry(runtime_asset_manifest(
            "latotex.runtime.tectonic",
            "Tectonic Runtime",
            "Downloads the Windows x64 Tectonic compiler on demand for LaTeX builds.",
            "tectonic.windows-x64",
            "Tectonic Windows x64",
            PluginRuntimeAsset {
                id: "tectonic".to_string(),
                kind: "tectonic".to_string(),
                platform: "windows-x64".to_string(),
                download_url: tectonic_url.to_string(),
                download_url_cn: Some(format!("https://gh-proxy.com/{tectonic_url}")),
                sha256: "131a24604785a9600989a3d91225f597df52ac06f00aeffe86fd529f99ee5cdd".to_string(),
                archive_format: "zip".to_string(),
                entry_path: "tectonic.exe".to_string(),
            },
            vec!["onCommand:latex.compile"],
            vec!["tectonic", "latex", "tex"],
        )),
        entry(runtime_asset_manifest(
            "latotex.runtime.cloudflared",
            "Cloudflare Tunnel Runtime",
            "Downloads cloudflared on demand for public share tunnels.",
            "cloudflared.windows-x64",
            "cloudflared Windows x64",
            PluginRuntimeAsset {
                id: "cloudflared".to_string(),
                kind: "cloudflared".to_string(),
                platform: "windows-x64".to_string(),
                download_url: cloudflared_url.to_string(),
                download_url_cn: Some(format!("https://gh-proxy.com/{cloudflared_url}")),
                sha256: "413f9b24dc6e61a455564651524f167b8ce29ac4ccd40703dea7af93cd37ed39".to_string(),
                archive_format: "exe".to_string(),
                entry_path: "cloudflared.exe".to_string(),
            },
            vec!["onCommand:share.startCloudTunnel"],
            vec!["cloudflared", "share", "tunnel"],
        )),
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
                download_url_cn: Some(format!("https://gh-proxy.com/{llvm_url}")),
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
                download_url_cn: Some(format!("https://gh-proxy.com/{llvm_url}")),
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
                download_url_cn: Some("https://golang.google.cn/dl/go1.26.3.windows-amd64.zip".to_string()),
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
                download_url_cn: Some(format!("https://gh-proxy.com/{git_url}")),
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
