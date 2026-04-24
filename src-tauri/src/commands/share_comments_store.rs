use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const MAX_STORED_USERNAME_CHARS: usize = 64;
const MAX_STORED_COMMENT_TEXT_CHARS: usize = 4_000;
const MAX_STORED_COMMENT_QUOTE_CHARS: usize = 1_000;
const MAX_STORED_SESSION_NAME_CHARS: usize = 120;

fn truncate_text(value: &str, max_chars: usize) -> String {
    value.trim().chars().take(max_chars).collect::<String>()
}

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

pub fn normalize_comment_value(
    value: &Value,
    fallback_username: &str,
) -> Option<ShareCommentRecord> {
    let source_obj = value.as_object()?;
    let text = source_obj
        .get("text")
        .and_then(|item| item.as_str())
        .map(|item| truncate_text(item, MAX_STORED_COMMENT_TEXT_CHARS))
        .unwrap_or_default();
    let quote = source_obj
        .get("quote")
        .and_then(|item| item.as_str())
        .map(|item| truncate_text(item, MAX_STORED_COMMENT_QUOTE_CHARS))
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
    let session_name = parse_nonempty_text(source_obj.get("sessionName"))
        .map(|value| truncate_text(&value, MAX_STORED_SESSION_NAME_CHARS));
    let session_created_at = parse_nonempty_text(source_obj.get("sessionCreatedAt"));
    Some(ShareCommentRecord {
        id: parse_nonempty_text(source_obj.get("id"))
            .unwrap_or_else(|| format!("c-{}", Uuid::new_v4().simple())),
        username: truncate_text(
            &parse_nonempty_text(source_obj.get("username"))
                .unwrap_or_else(|| fallback_username.trim().to_string()),
            MAX_STORED_USERNAME_CHARS,
        ),
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normalizes_stored_share_comment_lengths() {
        let comment = normalize_comment_value(
            &json!({
                "username": "u".repeat(120),
                "text": "t".repeat(4_500),
                "quote": "q".repeat(1_500),
                "source": "pdf",
                "page": 2,
            }),
            "Guest",
        ).expect("comment should normalize");

        assert_eq!(comment.username.chars().count(), MAX_STORED_USERNAME_CHARS);
        assert_eq!(comment.text.chars().count(), MAX_STORED_COMMENT_TEXT_CHARS);
        assert_eq!(comment.quote.chars().count(), MAX_STORED_COMMENT_QUOTE_CHARS);
        assert_eq!(comment.source, "pdf");
        assert_eq!(comment.page, Some(2));
    }
}
