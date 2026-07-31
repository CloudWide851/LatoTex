use super::plugins_builtin::{empty_contribution, entry};
use super::plugins_builtin_science::{localize_contribution, science_manifest};
use super::plugins_trusted_recipes::{
    knowledge_embedding_asset, KNOWLEDGE_EMBEDDING_CONTRIBUTION_ID, KNOWLEDGE_EMBEDDING_PLUGIN_ID,
    KNOWLEDGE_EMBEDDING_REVISION,
};
use crate::models::PluginCatalogEntry;

pub(super) fn knowledge_catalog() -> Vec<PluginCatalogEntry> {
    let mut asset = empty_contribution(
        "runtimeAsset",
        KNOWLEDGE_EMBEDDING_CONTRIBUTION_ID,
        "Multilingual E5 Small int8",
    );
    asset.runtime_asset = Some(knowledge_embedding_asset());
    asset = localize_contribution(
        asset,
        (
            "Multilingual E5 Small int8",
            "Pinned Windows x64 CPU ONNX model with SHA-256 verification.",
        ),
        (
            "多语言 E5 Small int8",
            "固定 revision、适用于 Windows x64 CPU 且经 SHA-256 校验的 ONNX 模型。",
        ),
        (
            "Multilingual E5 Small int8",
            "Modelo ONNX fijado para CPU Windows x64 y verificado con SHA-256.",
        ),
        (
            "Multilingual E5 Small int8",
            "固定 revision・SHA-256 検証済みの Windows x64 CPU 向け ONNX モデルです。",
        ),
    );
    let description = format!(
        "Optional local semantic retrieval model pinned to Xenova revision {KNOWLEDGE_EMBEDDING_REVISION}. Exact and BM25 retrieval remain available without it."
    );
    let mut manifest = science_manifest(
        KNOWLEDGE_EMBEDDING_PLUGIN_ID,
        (
            "Multilingual Semantic Search",
            &description,
            &["Research", "Knowledge", "Runtime"],
        ),
        (
            "多语言语义检索模型",
            "可选的本地语义检索模型；未安装时精确匹配与 BM25 仍完整可用。",
            &["科研", "知识库", "运行时"],
        ),
        (
            "Búsqueda semántica multilingüe",
            "Modelo local opcional; la búsqueda exacta y BM25 siguen disponibles sin él.",
            &["Investigación", "Conocimiento", "Runtime"],
        ),
        (
            "多言語セマンティック検索",
            "任意のローカルモデルです。未導入でも完全一致と BM25 は利用できます。",
            &["研究", "ナレッジ", "ランタイム"],
        ),
        "full",
        "managed",
        "sha256",
        "disabled",
        "MIT",
        &["network.fetch"],
        &["embedding", "rag", "multilingual", "research", "onnx"],
        vec![asset],
    );
    manifest.activation_events = vec!["onPage:library".to_string()];
    vec![entry(manifest)]
}

#[cfg(test)]
mod tests {
    use super::knowledge_catalog;

    #[test]
    fn knowledge_model_manifest_is_localized_and_validated() {
        let entry = knowledge_catalog().pop().unwrap();
        assert!(entry.validation.ok, "{:?}", entry.validation.issues);
        let localized = entry.manifest.localized.unwrap();
        for locale in ["en-US", "zh-CN", "es-ES", "ja-JP"] {
            assert!(localized.contains_key(locale));
        }
    }
}
