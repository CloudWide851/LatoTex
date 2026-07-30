use super::plugins_builtin::{base_manifest, empty_contribution, entry};
use super::plugins_trusted_recipes::{cran_r_installer, matlab_mcp_asset};
use crate::models::{
    PluginCatalogEntry, PluginCommandRef, PluginContribution, PluginLanguageSupport,
    PluginLocalizedContribution, PluginLocalizedManifest, PluginManifest, PluginMcpServerTemplate,
    PluginSnippet, PluginSnippetProvider, PluginToolchainProbe,
};
use std::collections::HashMap;

pub(super) type LocaleText<'a> = (&'a str, &'a str, &'a [&'a str]);

fn manifest_locale(value: LocaleText<'_>) -> PluginLocalizedManifest {
    PluginLocalizedManifest {
        name: Some(value.0.to_string()),
        display_name: Some(value.0.to_string()),
        description: Some(value.1.to_string()),
        categories: value.2.iter().map(|item| (*item).to_string()).collect(),
        keywords: Vec::new(),
    }
}

fn contribution_locale(title: &str, description: &str) -> PluginLocalizedContribution {
    PluginLocalizedContribution {
        title: Some(title.to_string()),
        description: Some(description.to_string()),
    }
}

pub(super) fn localize_contribution(
    mut contribution: PluginContribution,
    en: (&str, &str),
    zh: (&str, &str),
    es: (&str, &str),
    ja: (&str, &str),
) -> PluginContribution {
    contribution.title = en.0.to_string();
    contribution.description = Some(en.1.to_string());
    contribution.localized = Some(HashMap::from([
        ("en-US".to_string(), contribution_locale(en.0, en.1)),
        ("zh-CN".to_string(), contribution_locale(zh.0, zh.1)),
        ("es-ES".to_string(), contribution_locale(es.0, es.1)),
        ("ja-JP".to_string(), contribution_locale(ja.0, ja.1)),
    ]));
    contribution
}

#[allow(clippy::too_many_arguments)]
pub(super) fn science_manifest(
    id: &str,
    en: LocaleText<'_>,
    zh: LocaleText<'_>,
    es: LocaleText<'_>,
    ja: LocaleText<'_>,
    integration_level: &str,
    runtime_source: &str,
    integrity: &str,
    telemetry: &str,
    license: &str,
    permissions: &[&str],
    keywords: &[&str],
    contributions: Vec<PluginContribution>,
) -> PluginManifest {
    let mut manifest = base_manifest(id, en.0, en.1, en.2.to_vec());
    manifest.license = Some(license.to_string());
    manifest.integration_level = Some(integration_level.to_string());
    manifest.runtime_source = Some(runtime_source.to_string());
    manifest.integrity = Some(integrity.to_string());
    manifest.telemetry = Some(telemetry.to_string());
    manifest.permissions = permissions.iter().map(|item| (*item).to_string()).collect();
    manifest.keywords = keywords.iter().map(|item| (*item).to_string()).collect();
    manifest.contributions = contributions;
    manifest.localized = Some(HashMap::from([
        ("en-US".to_string(), manifest_locale(en)),
        ("zh-CN".to_string(), manifest_locale(zh)),
        ("es-ES".to_string(), manifest_locale(es)),
        ("ja-JP".to_string(), manifest_locale(ja)),
    ]));
    manifest
}

pub(super) fn probe(
    id: &str,
    kind: &str,
    executables: &[&str],
    version_arg: &str,
) -> PluginContribution {
    let mut contribution = empty_contribution("toolchainProbe", id, "Local runtime");
    contribution.toolchain_probe = Some(PluginToolchainProbe {
        id: kind.to_string(),
        kind: kind.to_string(),
        platform: "windows-x64".to_string(),
        executables: executables.iter().map(|item| (*item).to_string()).collect(),
        version_arg: Some(version_arg.to_string()),
    });
    localize_contribution(
        contribution,
        (
            "Local runtime",
            "Detect the existing local executable without installing proprietary software.",
        ),
        ("本地运行时", "检测现有本地可执行文件，不安装专有软件。"),
        (
            "Runtime local",
            "Detecta el ejecutable local sin instalar software propietario.",
        ),
        (
            "ローカルランタイム",
            "専用ソフトをインストールせず既存の実行ファイルを検出します。",
        ),
    )
}

pub(super) fn language(
    id: &str,
    language: &str,
    extensions: &[&str],
    editor_language: &str,
    preview_mode: &str,
) -> PluginContribution {
    let mut contribution = empty_contribution("languageSupport", id, "Language support");
    contribution.language_support = Some(PluginLanguageSupport {
        language: language.to_string(),
        extensions: extensions.iter().map(|item| (*item).to_string()).collect(),
        filenames: Vec::new(),
        patterns: Vec::new(),
        editor_language: Some(editor_language.to_string()),
        preview_mode: Some(preview_mode.to_string()),
    });
    localize_contribution(
        contribution,
        (
            "Language support",
            "Syntax highlighting and safe file association.",
        ),
        ("语言支持", "语法高亮和安全文件关联。"),
        (
            "Soporte de lenguaje",
            "Resaltado de sintaxis y asociación segura.",
        ),
        ("言語サポート", "構文強調と安全なファイル関連付け。"),
    )
}

pub(super) fn command(id: &str, command_ref: &str, selection: bool) -> PluginContribution {
    let mut contribution = empty_contribution("editorCommand", id, "Run current file");
    contribution.command_ref = Some(PluginCommandRef {
        id: command_ref.to_string(),
        title: None,
    });
    if selection {
        localize_contribution(
            contribution,
            (
                "Run selection",
                "Run only the selected code through the validated runtime.",
            ),
            ("运行选区", "仅通过已验证运行时执行所选代码。"),
            (
                "Ejecutar selección",
                "Ejecuta solo el código seleccionado con el runtime validado.",
            ),
            (
                "選択範囲を実行",
                "検証済みランタイムで選択コードだけを実行します。",
            ),
        )
    } else {
        localize_contribution(
            contribution,
            (
                "Run current file",
                "Run the active workspace file through the validated runtime.",
            ),
            ("运行当前文件", "通过已验证运行时执行当前工作区文件。"),
            (
                "Ejecutar archivo",
                "Ejecuta el archivo activo con el runtime validado.",
            ),
            (
                "現在のファイルを実行",
                "検証済みランタイムで現在のファイルを実行します。",
            ),
        )
    }
}

fn snippets(id: &str, language: &str, values: &[(&str, &str, &str)]) -> PluginContribution {
    let mut contribution = empty_contribution("snippetProvider", id, "Research snippets");
    contribution.snippet_provider = Some(PluginSnippetProvider {
        languages: vec![language.to_string()],
        snippets: values
            .iter()
            .map(|(label, prefix, body)| PluginSnippet {
                label: (*label).to_string(),
                prefix: (*prefix).to_string(),
                body: (*body).to_string(),
            })
            .collect(),
    });
    localize_contribution(
        contribution,
        (
            "Research snippets",
            "Small reproducible data-analysis snippets.",
        ),
        ("科研片段", "小型、可复现的数据分析片段。"),
        (
            "Fragmentos científicos",
            "Pequeños fragmentos reproducibles de análisis.",
        ),
        ("研究スニペット", "再現可能な小さな解析スニペットです。"),
    )
}

#[allow(clippy::too_many_arguments)]
fn local_runtime_manifest(
    id: &str,
    en: LocaleText<'_>,
    zh: LocaleText<'_>,
    es: LocaleText<'_>,
    ja: LocaleText<'_>,
    kind: &str,
    executables: &[&str],
    version_arg: &str,
    language_id: &str,
    extensions: &[&str],
    license: &str,
) -> PluginManifest {
    science_manifest(
        id,
        en,
        zh,
        es,
        ja,
        "full",
        "local",
        "local-probe",
        "not-applicable",
        license,
        &["workspace.read", "process.spawn"],
        &[kind, "research", "runtime"],
        vec![
            probe(
                &format!("{kind}.windows-x64"),
                kind,
                executables,
                version_arg,
            ),
            language(
                &format!("{kind}.language"),
                language_id,
                extensions,
                language_id,
                "code",
            ),
            command(&format!("{kind}.runFile"), "scientific.runFile", false),
            command(
                &format!("{kind}.runSelection"),
                "scientific.runSelection",
                true,
            ),
        ],
    )
}

fn matlab_manifest() -> PluginManifest {
    let mut manifest = local_runtime_manifest(
        "latotex.science.matlab",
        (
            "MATLAB",
            "Edit and run MATLAB files through an existing licensed installation.",
            &["Research", "Numerical Computing"],
        ),
        (
            "MATLAB",
            "通过用户已有的正版 MATLAB 编辑并运行 MATLAB 文件。",
            &["科研", "数值计算"],
        ),
        (
            "MATLAB",
            "Edita y ejecuta MATLAB mediante una instalación local con licencia.",
            &["Investigación", "Cálculo numérico"],
        ),
        (
            "MATLAB",
            "既存の正規ライセンス MATLAB でファイルを編集・実行します。",
            &["研究", "数値計算"],
        ),
        "matlab",
        &["matlab.exe"],
        "-help",
        "matlab",
        &["m"],
        "Proprietary; user-supplied license",
    );
    manifest.contributions.push(snippets(
        "matlab.snippets",
        "matlab",
        &[
            ("Read table", "readtable", "data = readtable(\"data.csv\");"),
            ("Reproducible seed", "rng", "rng(20260729, \"twister\");"),
        ],
    ));
    manifest
}

fn octave_manifest() -> PluginManifest {
    local_runtime_manifest(
        "latotex.science.octave",
        (
            "GNU Octave",
            "Use GNU Octave as an explicitly selected MATLAB-compatible runtime.",
            &["Research", "Numerical Computing"],
        ),
        (
            "GNU Octave",
            "将 GNU Octave 作为明确选择的 MATLAB 兼容运行时。",
            &["科研", "数值计算"],
        ),
        (
            "GNU Octave",
            "Usa GNU Octave como runtime compatible seleccionado explícitamente.",
            &["Investigación", "Cálculo numérico"],
        ),
        (
            "GNU Octave",
            "明示的に選択した MATLAB 互換ランタイムとして使用します。",
            &["研究", "数値計算"],
        ),
        "octave",
        &["octave-cli.exe", "octave.exe"],
        "--version",
        "matlab",
        &["m"],
        "GPL-3.0-or-later",
    )
}

fn r_manifest() -> PluginManifest {
    let mut installer = empty_contribution(
        "toolchainInstaller",
        super::plugins_trusted_recipes::CRAN_R_CONTRIBUTION_ID,
        "Managed R",
    );
    installer.toolchain_installer = Some(cran_r_installer());
    installer = localize_contribution(
        installer,
        (
            "Managed R",
            "Install pinned CRAN R into an isolated app directory.",
        ),
        ("托管 R", "将固定版本的 CRAN R 安装到隔离应用目录。"),
        (
            "R administrado",
            "Instala R de CRAN fijado en un directorio aislado.",
        ),
        (
            "管理対象 R",
            "固定 CRAN R を隔離アプリ領域へインストールします。",
        ),
    );
    let mut manifest = science_manifest(
        "latotex.science.r",
        (
            "R Statistical Computing",
            "Edit and run R/R Markdown with local R or a pinned isolated CRAN runtime.",
            &["Research", "Statistics"],
        ),
        (
            "R 统计计算",
            "使用本地 R 或固定版本的隔离 CRAN 运行时编辑并运行 R/R Markdown。",
            &["科研", "统计分析"],
        ),
        (
            "Computación estadística R",
            "Edita y ejecuta R/R Markdown con R local o CRAN aislado.",
            &["Investigación", "Estadística"],
        ),
        (
            "R 統計計算",
            "ローカル R または固定・隔離された CRAN で R/R Markdown を編集・実行します。",
            &["研究", "統計"],
        ),
        "full",
        "managed",
        "sha256+authenticode",
        "none",
        "GPL-2.0-or-later",
        &["workspace.read", "network.fetch", "process.spawn"],
        &["r", "statistics", "research", "cran"],
        vec![
            installer,
            probe(
                "r.local.windows-x64",
                "r",
                &["Rscript.exe", "R.exe"],
                "--version",
            ),
            language("r.language", "r", &["r"], "r", "code"),
            language(
                "rmarkdown.language",
                "markdown",
                &["rmd"],
                "markdown",
                "markdown",
            ),
            command("r.runFile", "scientific.runFile", false),
            command("r.runSelection", "scientific.runSelection", true),
            snippets(
                "r.snippets",
                "r",
                &[
                    ("Read CSV", "readcsv", "data <- read.csv(\"data.csv\")"),
                    ("Reproducible seed", "setseed", "set.seed(20260729)"),
                ],
            ),
        ],
    );
    manifest.version = super::plugins_trusted_recipes::CRAN_R_VERSION.to_string();
    manifest
}

fn matlab_mcp_manifest() -> PluginManifest {
    let mut asset = empty_contribution(
        "runtimeAsset",
        super::plugins_trusted_recipes::MATLAB_MCP_CONTRIBUTION_ID,
        "Official MATLAB MCP",
    );
    asset.runtime_asset = Some(matlab_mcp_asset());
    asset = localize_contribution(
        asset,
        (
            "Official MATLAB MCP",
            "Pinned MathWorks Windows x64 executable with SHA-256 verification.",
        ),
        (
            "官方 MATLAB MCP",
            "固定版本且经 SHA-256 校验的 MathWorks Windows x64 可执行文件。",
        ),
        (
            "MCP oficial de MATLAB",
            "Ejecutable MathWorks Windows x64 fijado y verificado.",
        ),
        (
            "公式 MATLAB MCP",
            "固定・SHA-256 検証済み MathWorks Windows x64 実行ファイルです。",
        ),
    );
    let mut mcp = empty_contribution("mcpServer", "matlab.mcp", "MATLAB MCP");
    mcp.mcp_server = Some(PluginMcpServerTemplate {
        id: "matlab-mcp".to_string(),
        command: "runtimeAsset:matlab-mcp".to_string(),
        args: None,
        env: None,
    });
    mcp = localize_contribution(
        mcp,
        (
            "MATLAB MCP",
            "Approved tools remain subject to LatoTex execution approval.",
        ),
        ("MATLAB MCP", "执行类工具仍受 LatoTex 审批策略约束。"),
        (
            "MATLAB MCP",
            "Las herramientas siguen sujetas a aprobación de ejecución.",
        ),
        (
            "MATLAB MCP",
            "実行ツールには引き続き LatoTex の承認が必要です。",
        ),
    );
    let mut manifest = science_manifest(
        "latotex.science.matlab-mcp",
        (
            "MATLAB MCP",
            "Pinned official MathWorks MCP server for approved MATLAB tools.",
            &["Research", "MCP"],
        ),
        (
            "MATLAB MCP",
            "用于已审批 MATLAB 工具的固定版本 MathWorks 官方 MCP。",
            &["科研", "MCP"],
        ),
        (
            "MATLAB MCP",
            "Servidor MCP oficial fijado para herramientas MATLAB aprobadas.",
            &["Investigación", "MCP"],
        ),
        (
            "MATLAB MCP",
            "承認済み MATLAB ツール向けの固定 MathWorks 公式 MCP です。",
            &["研究", "MCP"],
        ),
        "full",
        "managed",
        "sha256",
        "disabled",
        "MathWorks license",
        &["network.fetch", "process.spawn", "mcp"],
        &["matlab", "mcp", "mathworks"],
        vec![asset, mcp],
    );
    manifest.version = super::plugins_trusted_recipes::MATLAB_MCP_VERSION.to_string();
    manifest
}

pub(super) fn science_catalog() -> Vec<PluginCatalogEntry> {
    let mut catalog = vec![
        entry(matlab_manifest()),
        entry(octave_manifest()),
        entry(r_manifest()),
        entry(matlab_mcp_manifest()),
    ];
    catalog.extend(super::plugins_builtin_science_connectors::science_connector_catalog());
    catalog
}

#[cfg(test)]
mod tests {
    use super::science_catalog;

    #[test]
    fn scientific_catalog_is_localized_and_validated() {
        let catalog = science_catalog();
        assert!(catalog.len() >= 12);
        for entry in catalog {
            assert!(entry.validation.ok, "{:?}", entry.validation.issues);
            assert!(entry.manifest.id.starts_with("latotex.science."));
            assert!(entry.manifest.integration_level.is_some());
            assert!(entry.manifest.runtime_source.is_some());
            assert!(entry.manifest.integrity.is_some());
            assert!(entry.manifest.telemetry.is_some());
            let localized = entry.manifest.localized.expect("localized catalog");
            for locale in ["en-US", "zh-CN", "es-ES", "ja-JP"] {
                assert!(localized.contains_key(locale));
            }
        }
    }
}
