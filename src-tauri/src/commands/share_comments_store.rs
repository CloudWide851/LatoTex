use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareCommentRecord {
    pub id: String,
    pub username: String,
    pub text: String,
    #[serde(default)]
    pub quote: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end: Option<u32>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct ShareCommentsStore {
    file_path: PathBuf,
}

impl ShareCommentsStore {
    pub fn new(project_root: &Path, session_id: &str) -> Self {
        let file_path = project_root
            .join(".latotex")
            .join("share")
            .join("comments")
            .join(format!("{}.json", session_id.trim()));
        Self { file_path }
    }

    pub fn load_comments(&self) -> Vec<ShareCommentRecord> {
        let raw = match fs::read_to_string(&self.file_path) {
            Ok(content) => content,
            Err(_) => return Vec::new(),
        };
        if raw.trim().is_empty() {
            return Vec::new();
        }
        let parsed = match serde_json::from_str::<Value>(&raw) {
            Ok(value) => value,
            Err(_) => return Vec::new(),
        };
        let items = comments_array(&parsed);
        items
            .into_iter()
            .filter_map(|item| normalize_comment_value(item, "Guest"))
            .collect()
    }

    pub fn persist_comments(&self, comments: &[ShareCommentRecord]) -> Result<(), String> {
        if let Some(parent) = self.file_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let payload = json!({
            "version": 1,
            "comments": comments,
        });
        let serialized = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
        fs::write(&self.file_path, serialized).map_err(|e| e.to_string())
    }
}

fn comments_array(value: &Value) -> Vec<&Value> {
    if let Some(array) = value.as_array() {
        return array.iter().collect();
    }
    value
        .get("comments")
        .and_then(|items| items.as_array())
        .map(|items| items.iter().collect())
        .unwrap_or_default()
}

fn parse_u32(value: Option<&Value>) -> Option<u32> {
    let Some(raw) = value else {
        return None;
    };
    if let Some(num) = raw.as_u64() {
        return u32::try_from(num).ok();
    }
    raw.as_str()
        .and_then(|text| text.trim().parse::<u32>().ok())
}

fn parse_nonempty_text(value: Option<&Value>) -> Option<String> {
    value
        .and_then(|item| item.as_str())
        .map(|text| text.trim())
        .filter(|text| !text.is_empty())
        .map(|text| text.to_string())
}

pub fn normalize_comment_value(value: &Value, fallback_username: &str) -> Option<ShareCommentRecord> {
    let source_obj = value.as_object()?;
    let text = source_obj
        .get("text")
        .and_then(|item| item.as_str())
        .map(|item| item.trim().to_string())
        .unwrap_or_default();
    let quote = source_obj
        .get("quote")
        .and_then(|item| item.as_str())
        .map(|item| item.trim().to_string())
        .unwrap_or_default();
    if text.is_empty() && quote.is_empty() {
        return None;
    }
    let page = parse_u32(source_obj.get("page")).filter(|value| *value > 0);
    let source = parse_nonempty_text(source_obj.get("source")).unwrap_or_else(|| {
        if page.is_some() {
            "pdf".to_string()
        } else {
            "tex".to_string()
        }
    });
    let source = if source == "pdf" { "pdf" } else { "tex" }.to_string();
    let session_name = parse_nonempty_text(source_obj.get("sessionName"));
    let session_created_at = parse_nonempty_text(source_obj.get("sessionCreatedAt"));
    Some(ShareCommentRecord {
        id: parse_nonempty_text(source_obj.get("id"))
            .unwrap_or_else(|| format!("c-{}", Uuid::new_v4().simple())),
        username: parse_nonempty_text(source_obj.get("username"))
            .unwrap_or_else(|| fallback_username.trim().to_string())
            .chars()
            .take(64)
            .collect::<String>()
            .trim()
            .to_string(),
        text,
        quote,
        source,
        session_name,
        session_created_at,
        page,
        start: parse_u32(source_obj.get("start")),
        end: parse_u32(source_obj.get("end")),
        created_at: parse_nonempty_text(source_obj.get("createdAt"))
            .unwrap_or_else(|| Utc::now().to_rfc3339()),
    })
}
