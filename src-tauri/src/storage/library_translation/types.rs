use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationBlock {
    pub id: String,
    pub page: Option<u32>,
    pub role: String,
    pub text: String,
    pub confidence: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationExtraction {
    pub normalized_relative_path: String,
    pub source_kind: String,
    pub output_ext: String,
    pub title_hint: String,
    pub detected_language: Option<String>,
    pub extraction_engine: Option<String>,
    pub blocks: Vec<TranslationBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationLayoutSection {
    pub id: String,
    pub title: String,
    pub block_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationLayoutPlan {
    pub source_kind: String,
    pub sections: Vec<TranslationLayoutSection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationSectionResult {
    pub id: String,
    pub title: String,
    pub translated_text: String,
    pub confidence: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationGlossaryEntry {
    pub source_term: String,
    pub target_term: String,
    pub confidence: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationMemoryHit {
    pub source_term: String,
    pub target_term: String,
    pub confidence: f32,
    pub hit_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationLayoutResult {
    pub source_kind: String,
    pub sections: Vec<TranslationSectionResult>,
    pub raw_output: String,
    #[serde(default)]
    pub glossary: Vec<TranslationGlossaryEntry>,
    #[serde(default)]
    pub uncertain_terms: Vec<String>,
    #[serde(default)]
    pub memory_hits: Vec<TranslationMemoryHit>,
    pub refined_by_search: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationPersistResult {
    pub primary_relative_path: String,
    pub artifact_paths: Vec<String>,
}
