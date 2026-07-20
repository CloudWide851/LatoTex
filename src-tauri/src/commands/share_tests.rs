use super::*;

fn test_runtime(name: &str) -> (ShareRuntime, PathBuf) {
    let root = std::env::temp_dir().join(format!("latotex-share-{name}-{}", Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let owner_participant_id = "owner-session-test".to_string();
    let mut participants = HashMap::new();
    participants.insert(
        owner_participant_id.clone(),
        ShareParticipantState {
            participant_id: owner_participant_id.clone(),
            username: "Desktop".to_string(),
            auth_token: "old-owner-token".to_string(),
            last_seen_at: now_iso(),
            last_seen_unix: Utc::now().timestamp(),
            last_action: Some("editing".to_string()),
        },
    );
    (
        ShareRuntime {
            session_id: "session-test".to_string(),
            session_name: Some("Test".to_string()),
            session_created_at: now_iso(),
            project_id: "project-test".to_string(),
            target_path: "main.tex".to_string(),
            project_root: root.clone(),
            mode: "local".to_string(),
            password: "join-password".to_string(),
            local_port: 43123,
            local_url: "http://127.0.0.1:43123".to_string(),
            tunnel_url: None,
            status: "ready".to_string(),
            tunnel_state: "ready".to_string(),
            tunnel_error: None,
            expires_at: now_iso(),
            expires_unix: Utc::now().timestamp() + 60,
            next_seq: 1,
            sync_events: Vec::new(),
            owner_participant_id,
            participants,
            join_attempt_limiter: JoinAttemptLimiter::new(),
            compile_requested: false,
            pdf_cache_path: None,
            pdf_size_bytes: 0,
            pdf_updated_at: None,
            last_sync_at: None,
            comments_store: ShareCommentsStore::new(&root, "session-test").unwrap(),
            comments: Vec::new(),
            stop_flag: Arc::new(AtomicBool::new(false)),
            cloudflared_child: None,
        },
        root,
    )
}

#[test]
fn share_sync_event_serializes_participant_metadata() {
    let event = ShareSyncEvent {
        seq: 7,
        from: "web-1".to_string(),
        update: "abc".to_string(),
        participant_id: "p-web-1".to_string(),
        username: "Alice".to_string(),
        action: Some("editing".to_string()),
        created_at: "2026-05-25T10:00:00Z".to_string(),
    };
    let value = serde_json::to_value(event).expect("event serializes");
    assert_eq!(value["participantId"], "p-web-1");
    assert_eq!(value["username"], "Alice");
    assert_eq!(value["action"], "editing");
    assert_eq!(value["from"], "web-1");
}

#[test]
fn public_join_url_contains_only_the_non_secret_session_id() {
    let url = build_public_join_url("https://example.trycloudflare.com/", "sid-123");
    assert_eq!(url, "https://example.trycloudflare.com/?sid=sid-123");
    assert!(!url.contains("pwd="));
    assert!(!url.contains("token"));
}

#[test]
fn inactive_status_serialization_contains_no_password_field() {
    let value = serde_json::to_value(inactive_share_session_info()).expect("status serializes");
    assert!(value.get("password").is_none());
    assert!(value.get("participantToken").is_none());
}

#[test]
fn rotating_owner_auth_invalidates_the_previous_token() {
    let (mut runtime, root) = test_runtime("owner-rotation");
    let owner = rotate_owner_auth(&mut runtime, "Desktop");

    assert_ne!(owner.participant_token, "old-owner-token");
    assert!(runtime
        .participants
        .values()
        .all(|participant| participant.auth_token != "old-owner-token"));
    assert_eq!(
        runtime
            .participants
            .get(&owner.participant_id)
            .map(|participant| participant.auth_token.as_str()),
        Some(owner.participant_token.as_str())
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn participant_prune_and_runtime_stop_revoke_tokens() {
    let (mut runtime, root) = test_runtime("token-revocation");
    runtime.participants.insert(
        "stale".to_string(),
        ShareParticipantState {
            participant_id: "stale".to_string(),
            username: "Guest".to_string(),
            auth_token: "stale-token".to_string(),
            last_seen_at: now_iso(),
            last_seen_unix: Utc::now().timestamp() - SHARE_PARTICIPANT_IDLE_SECS - 1,
            last_action: None,
        },
    );
    prune_participants(&mut runtime);
    assert!(!runtime.participants.contains_key("stale"));

    runtime.expires_unix = Utc::now().timestamp() - 1;
    assert!(is_session_expired(&runtime));
    let runtime = Arc::new(Mutex::new(runtime));
    stop_runtime(&runtime);
    let guard = runtime.lock().unwrap();
    assert!(guard.participants.is_empty());
    assert!(guard.password.is_empty());
    drop(guard);
    let _ = fs::remove_dir_all(root);
}
