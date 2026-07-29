use super::{
    normalize_telegram_api_base_url, telegram_config_from_channels, telegram_http_status_error,
    telegram_method_url, telegram_proxy_mode, DEFAULT_TELEGRAM_API_BASE_URL,
};
use crate::models::ChannelPrefs;
use crate::outbound_http::OutboundProxyMode;

#[test]
fn telegram_base_url_defaults_and_trims_slashes() {
    assert_eq!(
        normalize_telegram_api_base_url(None).unwrap(),
        DEFAULT_TELEGRAM_API_BASE_URL
    );
    assert_eq!(
        normalize_telegram_api_base_url(Some(" https://example.test/proxy/ ")).unwrap(),
        "https://example.test/proxy"
    );
}

#[test]
fn telegram_base_url_rejects_non_http_query_and_fragment() {
    assert_eq!(
        normalize_telegram_api_base_url(Some("file:///tmp/api")).unwrap_err(),
        "channels.telegram.base_url_invalid"
    );
    assert_eq!(
        normalize_telegram_api_base_url(Some("https://example.test/api?token=1")).unwrap_err(),
        "channels.telegram.base_url_invalid"
    );
    assert_eq!(
        normalize_telegram_api_base_url(Some("https://example.test/api#bot")).unwrap_err(),
        "channels.telegram.base_url_invalid"
    );
    assert_eq!(
        normalize_telegram_api_base_url(Some("http://example.test/api")).unwrap_err(),
        "channels.telegram.base_url_invalid"
    );
    assert_eq!(
        normalize_telegram_api_base_url(Some("https://user:pass@example.test/api")).unwrap_err(),
        "channels.telegram.base_url_invalid"
    );
    assert_eq!(
        normalize_telegram_api_base_url(Some("http://127.0.0.1:8081")).unwrap(),
        "http://127.0.0.1:8081"
    );
}

#[test]
fn telegram_method_url_builds_bot_endpoint() {
    assert_eq!(
        telegram_method_url("https://example.test/base/", "123:abc", "/getMe"),
        "https://example.test/base/bot123:abc/getMe"
    );
}

#[test]
fn telegram_http_error_uses_stable_code_without_response_body() {
    assert_eq!(
        telegram_http_status_error(reqwest::StatusCode::UNAUTHORIZED),
        "channels.telegram.http_401"
    );
}

#[test]
fn telegram_proxy_migrates_legacy_modes_and_requires_manual_url() {
    assert_eq!(
        telegram_proxy_mode(&ChannelPrefs::default()).unwrap(),
        OutboundProxyMode::System
    );
    let direct = ChannelPrefs {
        telegram_proxy_enabled: Some(false),
        ..Default::default()
    };
    assert_eq!(
        telegram_proxy_mode(&direct).unwrap(),
        OutboundProxyMode::Direct
    );
    let manual = ChannelPrefs {
        telegram_proxy_mode: Some("manual".to_string()),
        telegram_manual_proxy_url: Some("socks5://127.0.0.1:10808".to_string()),
        ..Default::default()
    };
    assert_eq!(
        telegram_proxy_mode(&manual).unwrap(),
        OutboundProxyMode::Manual("socks5://127.0.0.1:10808".to_string())
    );
}

#[test]
fn connection_config_can_be_built_before_channel_is_enabled() {
    let channels = ChannelPrefs {
        telegram_enabled: Some(false),
        telegram_chat_id: Some(" 123 ".to_string()),
        telegram_proxy_mode: Some("direct".to_string()),
        ..Default::default()
    };
    let config = telegram_config_from_channels(&channels, "test-token".to_string()).unwrap();
    assert_eq!(config.allowed_chat_id.as_deref(), Some("123"));
    assert_eq!(config.proxy_mode, OutboundProxyMode::Direct);
}
