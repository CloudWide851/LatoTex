use super::plugins_builtin::{empty_contribution, entry};
use super::plugins_builtin_science::{
    command, language, localize_contribution, probe, science_manifest, LocaleText,
};
use crate::models::{PluginCatalogEntry, PluginCommandRef, PluginManifest};

fn open_external(id: &str) -> crate::models::PluginContribution {
    let mut contribution = empty_contribution("resourceCommand", id, "Open externally");
    contribution.command_ref = Some(PluginCommandRef {
        id: "scientific.openExternal".to_string(),
        title: None,
    });
    localize_contribution(
        contribution,
        (
            "Open externally",
            "Open the selected validated file in the detected desktop application.",
        ),
        ("外部打开", "在检测到的桌面应用中打开所选的已验证文件。"),
        (
            "Abrir externamente",
            "Abre el archivo validado en la aplicación detectada.",
        ),
        (
            "外部で開く",
            "検証済みファイルを検出されたデスクトップアプリで開きます。",
        ),
    )
}

#[allow(clippy::too_many_arguments)]
fn connector(
    id: &str,
    en: LocaleText<'_>,
    zh: LocaleText<'_>,
    es: LocaleText<'_>,
    ja: LocaleText<'_>,
    kind: &str,
    executables: &[&str],
    license: &str,
) -> PluginManifest {
    science_manifest(
        id,
        en,
        zh,
        es,
        ja,
        "connector",
        "external",
        "local-probe",
        "not-applicable",
        license,
        &["workspace.read", "process.spawn"],
        &[kind, "research", "connector"],
        vec![
            probe(
                &format!("{kind}.windows-x64"),
                kind,
                executables,
                "--version",
            ),
            open_external(&format!("{kind}.openExternal")),
        ],
    )
}

#[allow(clippy::too_many_arguments)]
fn controlled(
    id: &str,
    en: LocaleText<'_>,
    zh: LocaleText<'_>,
    es: LocaleText<'_>,
    ja: LocaleText<'_>,
    kind: &str,
    executables: &[&str],
    license: &str,
) -> PluginManifest {
    let mut contributions = vec![
        probe(
            &format!("{kind}.windows-x64"),
            kind,
            executables,
            "--version",
        ),
        open_external(&format!("{kind}.workflow")),
    ];
    match kind {
        "julia" => {
            contributions.push(language(
                "julia.language",
                "julia",
                &["jl"],
                "julia",
                "code",
            ));
            contributions.push(command("julia.runFile", "scientific.runFile", false));
            contributions.push(command(
                "julia.runSelection",
                "scientific.runSelection",
                true,
            ));
        }
        "quarto" => {
            contributions.push(language(
                "quarto.language",
                "markdown",
                &["qmd"],
                "markdown",
                "markdown",
            ));
            contributions.push(command("quarto.render", "scientific.runFile", false));
        }
        "jupyter" => {
            contributions.push(language(
                "jupyter.language",
                "json",
                &["ipynb"],
                "json",
                "code",
            ));
            contributions.push(command("jupyter.runFile", "scientific.runFile", false));
        }
        _ => {}
    }
    science_manifest(
        id,
        en,
        zh,
        es,
        ja,
        "controlled",
        "local",
        "local-probe",
        "not-applicable",
        license,
        &["workspace.read", "process.spawn"],
        &[kind, "research"],
        contributions,
    )
}

pub(super) fn science_connector_catalog() -> Vec<PluginCatalogEntry> {
    vec![
        entry(controlled(
            "latotex.science.julia",
            (
                "Julia",
                "Edit and run Julia scripts through a detected local runtime.",
                &["Research", "Scientific Computing"],
            ),
            (
                "Julia",
                "通过检测到的本地运行时编辑并运行 Julia 脚本。",
                &["科研", "科学计算"],
            ),
            (
                "Julia",
                "Edita y ejecuta Julia mediante un runtime local detectado.",
                &["Investigación", "Cálculo científico"],
            ),
            (
                "Julia",
                "検出済みローカルランタイムで Julia を編集・実行します。",
                &["研究", "科学計算"],
            ),
            "julia",
            &["julia.exe"],
            "MIT",
        )),
        entry(controlled(
            "latotex.science.quarto",
            (
                "Quarto",
                "Edit and render Quarto documents through a bounded local workflow.",
                &["Research", "Publishing"],
            ),
            (
                "Quarto",
                "通过受控本地工作流编辑并渲染 Quarto 文档。",
                &["科研", "出版"],
            ),
            (
                "Quarto",
                "Edita y renderiza Quarto mediante un flujo local controlado.",
                &["Investigación", "Publicación"],
            ),
            (
                "Quarto",
                "制御されたローカルワークフローで Quarto 文書を処理します。",
                &["研究", "出版"],
            ),
            "quarto",
            &["quarto.exe"],
            "GPL-2.0-or-later",
        )),
        entry(controlled(
            "latotex.science.jupyter",
            (
                "Jupyter Notebook",
                "Preview notebooks and use controlled staging without an unrestricted browser service.",
                &["Research", "Notebook"],
            ),
            (
                "Jupyter Notebook",
                "预览 Notebook 并使用受控 staging，不启动不受限浏览器服务。",
                &["科研", "Notebook"],
            ),
            (
                "Jupyter Notebook",
                "Previsualiza notebooks con staging controlado sin servicio web abierto.",
                &["Investigación", "Notebook"],
            ),
            (
                "Jupyter Notebook",
                "無制限ブラウザーサービスなしで Notebook をプレビュー・制御実行します。",
                &["研究", "Notebook"],
            ),
            "jupyter",
            &["jupyter.exe", "jupyter-lab.exe"],
            "BSD-3-Clause",
        )),
        entry(connector(
            "latotex.science.zotero",
            (
                "Zotero Connector",
                "Connect Zotero to the existing paper-library synchronization flow.",
                &["Research", "References"],
            ),
            (
                "Zotero 连接器",
                "将 Zotero 接入现有论文库同步流程。",
                &["科研", "文献管理"],
            ),
            (
                "Conector Zotero",
                "Conecta Zotero con la sincronización de la biblioteca.",
                &["Investigación", "Referencias"],
            ),
            (
                "Zotero コネクター",
                "Zotero を既存の論文ライブラリ同期へ接続します。",
                &["研究", "参考文献"],
            ),
            "zotero",
            &["zotero.exe"],
            "AGPL-3.0",
        )),
        entry(connector(
            "latotex.science.spss",
            (
                "IBM SPSS Connector",
                "Detect SPSS for explicit external opening and diagnostics.",
                &["Research", "Statistics"],
            ),
            (
                "IBM SPSS 连接器",
                "检测 SPSS，仅提供明确的外部打开和诊断。",
                &["科研", "统计分析"],
            ),
            (
                "Conector IBM SPSS",
                "Detecta SPSS para apertura externa y diagnóstico.",
                &["Investigación", "Estadística"],
            ),
            (
                "IBM SPSS コネクター",
                "SPSS を検出し、明示的な外部起動と診断を提供します。",
                &["研究", "統計"],
            ),
            "spss",
            &["stats.exe"],
            "Proprietary; user-supplied license",
        )),
        entry(connector(
            "latotex.science.sas",
            (
                "SAS Connector",
                "Detect SAS for explicit external opening and diagnostics.",
                &["Research", "Statistics"],
            ),
            (
                "SAS 连接器",
                "检测 SAS，仅提供明确的外部打开和诊断。",
                &["科研", "统计分析"],
            ),
            (
                "Conector SAS",
                "Detecta SAS para apertura externa y diagnóstico.",
                &["Investigación", "Estadística"],
            ),
            (
                "SAS コネクター",
                "SAS を検出し、明示的な外部起動と診断を提供します。",
                &["研究", "統計"],
            ),
            "sas",
            &["sas.exe"],
            "Proprietary; user-supplied license",
        )),
        entry(connector(
            "latotex.science.stata",
            (
                "Stata Connector",
                "Detect Stata for explicit external opening and diagnostics.",
                &["Research", "Statistics"],
            ),
            (
                "Stata 连接器",
                "检测 Stata，仅提供明确的外部打开和诊断。",
                &["科研", "统计分析"],
            ),
            (
                "Conector Stata",
                "Detecta Stata para apertura externa y diagnóstico.",
                &["Investigación", "Estadística"],
            ),
            (
                "Stata コネクター",
                "Stata を検出し、明示的な外部起動と診断を提供します。",
                &["研究", "統計"],
            ),
            "stata",
            &["StataMP-64.exe", "StataSE-64.exe", "Stata-64.exe"],
            "Proprietary; user-supplied license",
        )),
        entry(connector(
            "latotex.science.imagej",
            (
                "ImageJ / Fiji Connector",
                "Detect ImageJ or Fiji for explicit image-analysis handoff.",
                &["Research", "Imaging"],
            ),
            (
                "ImageJ / Fiji 连接器",
                "检测 ImageJ 或 Fiji，提供明确的图像分析外部交接。",
                &["科研", "图像分析"],
            ),
            (
                "Conector ImageJ / Fiji",
                "Detecta ImageJ o Fiji para análisis externo.",
                &["Investigación", "Imagen"],
            ),
            (
                "ImageJ / Fiji コネクター",
                "ImageJ または Fiji を検出し画像解析へ連携します。",
                &["研究", "画像解析"],
            ),
            "imagej",
            &["ImageJ-win64.exe", "ImageJ.exe"],
            "Public domain / GPL components",
        )),
        entry(connector(
            "latotex.science.qgis",
            (
                "QGIS Connector",
                "Detect QGIS for explicit geospatial-file handoff.",
                &["Research", "Geospatial"],
            ),
            (
                "QGIS 连接器",
                "检测 QGIS，提供明确的地理空间文件外部交接。",
                &["科研", "地理空间"],
            ),
            (
                "Conector QGIS",
                "Detecta QGIS para entrega explícita de archivos geoespaciales.",
                &["Investigación", "Geoespacial"],
            ),
            (
                "QGIS コネクター",
                "QGIS を検出し地理空間ファイルを明示的に連携します。",
                &["研究", "地理空間"],
            ),
            "qgis",
            &["qgis-bin.exe", "qgis.exe"],
            "GPL-2.0-or-later",
        )),
    ]
}
