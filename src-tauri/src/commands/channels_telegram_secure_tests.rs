use super::migrate_legacy_telegram_token_with;
use crate::models::ChannelPrefs;

#[test]
fn legacy_token_is_cleared_only_after_verified_storage() {
    let mut channels = ChannelPrefs {
        telegram_bot_token: Some("legacy-placeholder".to_string()),
        ..Default::default()
    };
    let migrated = migrate_legacy_telegram_token_with(&mut channels, |token| {
        assert_eq!(token, "legacy-placeholder");
        Ok(())
    })
    .unwrap();
    assert!(migrated);
    assert!(channels.telegram_bot_token.is_none());
    assert_eq!(channels.telegram_token_stored, Some(true));
}

#[test]
fn failed_secure_migration_retains_plaintext_for_safe_retry() {
    let mut channels = ChannelPrefs {
        telegram_bot_token: Some("legacy-placeholder".to_string()),
        ..Default::default()
    };
    let error = migrate_legacy_telegram_token_with(&mut channels, |_| {
        Err("channels.telegram.token_migration_verify_failed".to_string())
    })
    .unwrap_err();
    assert_eq!(
        error,
        "channels.telegram.token_migration_verify_failed".to_string()
    );
    assert_eq!(
        channels.telegram_bot_token.as_deref(),
        Some("legacy-placeholder")
    );
    assert_eq!(channels.telegram_token_stored, None);
}

#[test]
fn migration_is_noop_without_a_legacy_token() {
    let mut channels = ChannelPrefs::default();
    let migrated = migrate_legacy_telegram_token_with(&mut channels, |_| {
        panic!("storage must not run without a token")
    })
    .unwrap();
    assert!(!migrated);
}
