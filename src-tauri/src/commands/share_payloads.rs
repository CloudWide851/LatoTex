use serde::{Deserialize, Serialize};

use super::ShareSyncEvent;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PushSyncBody {
    pub sid: String,
    pub pwd: String,
    pub client_id: String,
    pub update: String,
    pub participant_id: Option<String>,
    pub participant_token: Option<String>,
    pub username: Option<String>,
    pub action: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SessionBody {
    pub sid: String,
    pub pwd: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct UploadPdfBody {
    pub sid: String,
    pub pwd: String,
    pub pdf_base64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct JoinBody {
    pub sid: String,
    pub pwd: String,
    pub client_id: Option<String>,
    pub username: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PresencePingBody {
    pub sid: String,
    pub pwd: String,
    pub participant_id: String,
    pub participant_token: Option<String>,
    pub action: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CommentPostBody {
    pub sid: String,
    pub pwd: String,
    pub participant_id: Option<String>,
    pub participant_token: Option<String>,
    pub username: Option<String>,
    pub id: Option<String>,
    pub text: Option<String>,
    pub quote: Option<String>,
    pub source: Option<String>,
    pub page: Option<u32>,
    pub start: Option<u32>,
    pub end: Option<u32>,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PullSyncResponse {
    pub next_cursor: u64,
    pub events: Vec<ShareSyncEvent>,
}
