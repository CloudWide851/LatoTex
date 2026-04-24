pub(super) const MAX_SHARE_JSON_BODY_BYTES: u64 = 2 * 1024 * 1024;
pub(super) const MAX_SHARE_PDF_UPLOAD_BASE64_BYTES: usize = 48 * 1024 * 1024;
pub(super) const MAX_SHARE_SYNC_UPDATE_CHARS: usize = 200_000;
pub(super) const MAX_SHARE_COMMENT_TEXT_CHARS: usize = 4_000;
pub(super) const MAX_SHARE_COMMENT_QUOTE_CHARS: usize = 1_000;
pub(super) const MAX_SHARE_USERNAME_CHARS: usize = 64;
pub(super) const MAX_SHARE_ACTION_CHARS: usize = 120;

fn truncate_share_text(value: &str, max_chars: usize) -> String {
    value.trim().chars().take(max_chars).collect::<String>()
}

pub(super) fn normalize_share_username(value: &str) -> String {
    truncate_share_text(value, MAX_SHARE_USERNAME_CHARS)
}

pub(super) fn normalize_share_action(value: &str) -> String {
    truncate_share_text(value, MAX_SHARE_ACTION_CHARS)
}

pub(super) fn normalize_share_comment_text(value: &str) -> String {
    truncate_share_text(value, MAX_SHARE_COMMENT_TEXT_CHARS)
}

pub(super) fn normalize_share_comment_quote(value: &str) -> String {
    truncate_share_text(value, MAX_SHARE_COMMENT_QUOTE_CHARS)
}

pub(super) fn normalize_share_sync_update(value: &str) -> String {
    value.chars().take(MAX_SHARE_SYNC_UPDATE_CHARS).collect::<String>()
}
