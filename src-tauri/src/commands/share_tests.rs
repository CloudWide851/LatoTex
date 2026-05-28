use super::*;

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
