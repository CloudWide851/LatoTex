use crate::models::{
    Ack, EmailFetchSubmissionInput, EmailFetchSubmissionResult, EmailPasswordSaveInput,
    EmailSubmissionItem,
};
use crate::secure::{self, SecureStorageContext};
use crate::state::AppState;
use crate::storage;
use imap::{ClientBuilder, ConnectionMode, TlsKind};
use mail_parser::{Address, HeaderName, MessageParser};
use std::collections::BTreeSet;
use tauri::State;

const EMAIL_SECRET_ID: &str = "channel:email:imap-password:v1";
const DEFAULT_MAILBOX: &str = "INBOX";
const DEFAULT_MAX_RESULTS: u32 = 20;
const HARD_MAX_RESULTS: u32 = 50;
const PREVIEW_CHARS: usize = 520;
const DEFAULT_KEYWORDS: &[&str] = &[
    "submission",
    "submitted",
    "manuscript",
    "review",
    "reviewer",
    "editor",
    "decision",
    "revision",
    "accept",
    "accepted",
    "reject",
    "rejected",
    "journal",
    "conference",
];

#[derive(Clone, Debug)]
struct EmailConfig {
    host: String,
    port: u16,
    security: String,
    username: String,
    mailbox: String,
    keywords: Vec<String>,
    max_results: u32,
}

fn stable_join_error(error: impl std::fmt::Display) -> String {
    format!("channels.email.worker: {error}")
}

fn normalize_non_empty(raw: Option<String>) -> String {
    raw.unwrap_or_default().trim().to_string()
}

fn normalize_security(raw: Option<String>) -> Result<String, String> {
    let value = raw
        .unwrap_or_else(|| "tls".to_string())
        .trim()
        .to_ascii_lowercase();
    if matches!(value.as_str(), "tls" | "starttls" | "plain") {
        return Ok(value);
    }
    Err("channels.email.security_invalid".to_string())
}

fn normalize_host(raw: Option<String>) -> Result<String, String> {
    let host = normalize_non_empty(raw);
    if host.is_empty() {
        return Err("channels.email.host_missing".to_string());
    }
    if host.contains("://") || host.contains('/') || host.chars().any(char::is_whitespace) {
        return Err("channels.email.host_invalid".to_string());
    }
    Ok(host)
}

fn normalize_keywords(raw: Option<String>) -> Vec<String> {
    let keywords: Vec<String> = raw
        .unwrap_or_default()
        .split([',', '\n', ';'])
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    if keywords.is_empty() {
        DEFAULT_KEYWORDS
            .iter()
            .map(|value| (*value).to_string())
            .collect()
    } else {
        keywords
    }
}

fn resolve_email_config(state: &AppState) -> Result<EmailConfig, String> {
    let settings = storage::load_settings(&state.db_path, &state.runtime_root)?;
    let channels = settings
        .ui_prefs
        .and_then(|prefs| prefs.channels)
        .ok_or_else(|| "channels.email.disabled".to_string())?;
    if !channels.email_enabled.unwrap_or(false) {
        return Err("channels.email.disabled".to_string());
    }
    let address = normalize_non_empty(channels.email_address);
    if address.is_empty() {
        return Err("channels.email.address_missing".to_string());
    }
    let host = normalize_host(channels.email_imap_host)?;
    let security = normalize_security(channels.email_security)?;
    let port = channels
        .email_imap_port
        .unwrap_or(if security == "plain" { 143 } else { 993 });
    if port == 0 {
        return Err("channels.email.port_invalid".to_string());
    }
    let username = normalize_non_empty(channels.email_username).if_empty(address.clone());
    let mailbox = normalize_non_empty(channels.email_mailbox).if_empty(DEFAULT_MAILBOX.to_string());
    let max_results = channels
        .email_max_results
        .unwrap_or(DEFAULT_MAX_RESULTS)
        .clamp(1, HARD_MAX_RESULTS);
    Ok(EmailConfig {
        host,
        port,
        security,
        username,
        mailbox,
        keywords: normalize_keywords(channels.email_search_keywords),
        max_results,
    })
}

trait EmptyFallback {
    fn if_empty(self, fallback: String) -> String;
}

impl EmptyFallback for String {
    fn if_empty(self, fallback: String) -> String {
        if self.trim().is_empty() {
            fallback
        } else {
            self
        }
    }
}

fn secure_context(state: &AppState) -> SecureStorageContext {
    SecureStorageContext {
        db_path: state.db_path.clone(),
        runtime_root: state.runtime_root.clone(),
    }
}

fn load_email_password(state: &AppState) -> Result<String, String> {
    let result = secure::get_model_api_key(&secure_context(state), EMAIL_SECRET_ID)
        .map_err(|_| "channels.email.password_missing".to_string())?;
    let password = result.api_key.unwrap_or_default();
    if password.trim().is_empty() {
        Err("channels.email.password_missing".to_string())
    } else {
        Ok(password)
    }
}

fn connect_email_session(
    config: &EmailConfig,
    password: &str,
) -> Result<imap::Session<imap::Connection>, String> {
    let mode = match config.security.as_str() {
        "plain" => ConnectionMode::Plaintext,
        "starttls" => ConnectionMode::StartTls,
        _ => ConnectionMode::Tls,
    };
    let client = ClientBuilder::new(&config.host, config.port)
        .tls_kind(TlsKind::Rust)
        .mode(mode)
        .connect()
        .map_err(|_| "channels.email.transport".to_string())?;
    client
        .login(&config.username, password)
        .map_err(|_| "channels.email.auth_failed".to_string())
}

fn verify_email_config(state: &AppState) -> Result<(), String> {
    let config = resolve_email_config(state)?;
    let password = load_email_password(state)?;
    let mut session = connect_email_session(&config, &password)?;
    if session.select(&config.mailbox).is_err() {
        let _ = session.logout();
        return Err("channels.email.mailbox_failed".to_string());
    }
    let _ = session.logout();
    Ok(())
}

fn compact_text(raw: &str) -> String {
    raw.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate_chars(raw: &str, max_chars: usize) -> String {
    let mut output = String::new();
    for (index, ch) in raw.chars().enumerate() {
        if index >= max_chars {
            output.push('…');
            break;
        }
        output.push(ch);
    }
    output
}

fn format_address(address: Option<&Address<'_>>) -> String {
    let Some(addr) = address.and_then(Address::first) else {
        return String::new();
    };
    match (addr.name(), addr.address()) {
        (Some(name), Some(email)) if !name.trim().is_empty() => {
            format!("{} <{}>", name.trim(), email.trim())
        }
        (_, Some(email)) => email.trim().to_string(),
        (Some(name), _) => name.trim().to_string(),
        _ => String::new(),
    }
}

fn status_tag_for(haystack: &str) -> String {
    if haystack.contains("accept") {
        "accepted".to_string()
    } else if haystack.contains("reject") || haystack.contains("declin") {
        "rejected".to_string()
    } else if haystack.contains("revision") || haystack.contains("revise") {
        "revision".to_string()
    } else if haystack.contains("decision") {
        "decision".to_string()
    } else if haystack.contains("review") {
        "review".to_string()
    } else {
        "submission".to_string()
    }
}

fn parse_submission_email(
    seq: u32,
    raw: &[u8],
    keywords: &[String],
) -> Option<EmailSubmissionItem> {
    let message = MessageParser::default().parse(raw)?;
    let subject = compact_text(message.subject().unwrap_or(""));
    let from = compact_text(&format_address(message.from()));
    let date = compact_text(message.header_raw(HeaderName::Date).unwrap_or(""));
    let preview = truncate_chars(
        &compact_text(
            &message
                .body_preview(PREVIEW_CHARS)
                .map(|value| value.into_owned())
                .unwrap_or_default(),
        ),
        PREVIEW_CHARS,
    );
    let haystack = format!("{subject} {from} {preview}").to_ascii_lowercase();
    let match_reason = keywords
        .iter()
        .find(|keyword| haystack.contains(keyword.as_str()))
        .cloned()?;
    Some(EmailSubmissionItem {
        id: format!("imap-seq-{seq}"),
        subject,
        from,
        date,
        preview,
        status_tag: status_tag_for(&haystack),
        match_reason,
    })
}

fn fetch_submission_emails(
    state: &AppState,
    input: EmailFetchSubmissionInput,
) -> Result<EmailFetchSubmissionResult, String> {
    let mut config = resolve_email_config(state)?;
    if let Some(limit) = input.limit {
        config.max_results = limit.clamp(1, HARD_MAX_RESULTS);
    }
    let password = load_email_password(state)?;
    let mut session = connect_email_session(&config, &password)?;
    if session.select(&config.mailbox).is_err() {
        let _ = session.logout();
        return Err("channels.email.mailbox_failed".to_string());
    }
    let mut sequences: Vec<u32> = session
        .search("ALL")
        .map_err(|_| "channels.email.transport".to_string())?
        .into_iter()
        .collect();
    sequences.sort_unstable_by(|a, b| b.cmp(a));
    let mut items = Vec::new();
    for seq in sequences
        .into_iter()
        .take((config.max_results * 3) as usize)
    {
        if items.len() >= config.max_results as usize {
            break;
        }
        let messages = match session.fetch(seq.to_string(), "RFC822") {
            Ok(value) => value,
            Err(_) => continue,
        };
        let Some(message) = messages.iter().next() else {
            continue;
        };
        let Some(body) = message.body() else {
            continue;
        };
        if let Some(item) = parse_submission_email(seq, body, &config.keywords) {
            items.push(item);
        }
    }
    let _ = session.logout();
    Ok(EmailFetchSubmissionResult {
        status: if items.is_empty() {
            "channels.email.no_matches".to_string()
        } else {
            "ok".to_string()
        },
        items,
    })
}

#[tauri::command]
pub async fn channels_email_password_save_verified(
    state: State<'_, AppState>,
    input: EmailPasswordSaveInput,
) -> Result<Ack, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let password = input.password.trim().to_string();
        if password.is_empty() {
            return Err("channels.email.password_missing".to_string());
        }
        secure::store_model_api_key(&secure_context(&state), EMAIL_SECRET_ID, &password)
            .map_err(|_| "channels.email.password_save_failed".to_string())?;
        let loaded = load_email_password(&state)?;
        if loaded != password {
            return Err("channels.email.password_verify_failed".to_string());
        }
        Ok(Ack {
            ok: true,
            message: "saved".to_string(),
        })
    })
    .await
    .map_err(stable_join_error)?
}

#[tauri::command]
pub async fn channels_email_test(state: State<'_, AppState>) -> Result<Ack, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        verify_email_config(&state)?;
        Ok(Ack {
            ok: true,
            message: "verified".to_string(),
        })
    })
    .await
    .map_err(stable_join_error)?
}

#[tauri::command]
pub async fn channels_email_fetch_submission(
    state: State<'_, AppState>,
    input: EmailFetchSubmissionInput,
) -> Result<EmailFetchSubmissionResult, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || fetch_submission_emails(&state, input))
        .await
        .map_err(stable_join_error)?
}

#[cfg(test)]
mod tests {
    use super::{normalize_keywords, parse_submission_email, status_tag_for};
    use crate::models::ChannelPrefs;

    #[test]
    fn email_keywords_fall_back_to_submission_terms() {
        let keywords = normalize_keywords(Some("  \n ".to_string()));
        assert!(keywords.iter().any(|keyword| keyword == "submission"));
        assert!(keywords.iter().any(|keyword| keyword == "decision"));
    }

    #[test]
    fn email_parser_extracts_bounded_submission_summary() {
        let raw = b"From: Editor <editor@example.test>\r\nSubject: Manuscript decision for LATOTEX-42\r\nDate: Mon, 15 Jun 2026 10:00:00 +0000\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nYour manuscript submission received a major revision decision. Please upload the revised source files.";
        let keywords = vec!["decision".to_string(), "manuscript".to_string()];
        let item = parse_submission_email(7, raw, &keywords).expect("matched submission mail");
        assert_eq!(item.id, "imap-seq-7");
        assert!(item.subject.contains("Manuscript decision"));
        assert_eq!(item.status_tag, "revision");
        assert_eq!(item.match_reason, "decision");
        assert!(item.preview.len() <= 521);
    }

    #[test]
    fn email_password_is_not_part_of_channel_preferences() {
        let prefs = ChannelPrefs {
            telegram_enabled: None,
            telegram_bot_token: None,
            telegram_chat_id: None,
            telegram_api_base_url: None,
            dingtalk_enabled: None,
            dingtalk_client_id: None,
            dingtalk_client_secret: None,
            email_enabled: Some(true),
            email_address: Some("author@example.test".to_string()),
            email_imap_host: Some("imap.example.test".to_string()),
            email_imap_port: Some(993),
            email_security: Some("tls".to_string()),
            email_username: Some("author@example.test".to_string()),
            email_mailbox: Some("INBOX".to_string()),
            email_search_keywords: Some("submission,decision".to_string()),
            email_max_results: Some(20),
        };
        let serialized = serde_json::to_string(&prefs).expect("serialize prefs");
        assert!(!serialized.contains("password"));
        assert!(!serialized.contains("secret"));
    }

    #[test]
    fn email_status_tags_are_stable() {
        assert_eq!(status_tag_for("paper accepted"), "accepted");
        assert_eq!(status_tag_for("major revision required"), "revision");
        assert_eq!(status_tag_for("decision letter"), "decision");
    }
}
