use super::*;

pub(super) fn prune_participants(runtime: &mut ShareRuntime) {
    let cutoff = Utc::now().timestamp() - SHARE_PARTICIPANT_IDLE_SECS;
    runtime
        .participants
        .retain(|_, value| value.last_seen_unix >= cutoff);
}

pub(super) fn upsert_participant(
    runtime: &mut ShareRuntime,
    participant_id: &str,
    username: &str,
    action: Option<&str>,
) {
    if participant_id.trim().is_empty() || username.trim().is_empty() {
        return;
    }
    let now_unix = Utc::now().timestamp();
    let now = now_iso();
    let next_action = action
        .map(normalize_share_action)
        .filter(|value| !value.is_empty());
    if let Some(existing) = runtime.participants.get_mut(participant_id) {
        if !username.trim().is_empty() {
            existing.username = normalize_share_username(username);
        }
        existing.last_seen_unix = now_unix;
        existing.last_seen_at = now;
        if next_action.is_some() {
            existing.last_action = next_action;
        }
    } else {
        runtime.participants.insert(
            participant_id.to_string(),
            ShareParticipantState {
                participant_id: participant_id.to_string(),
                username: normalize_share_username(username),
                auth_token: new_participant_token(),
                last_seen_unix: now_unix,
                last_seen_at: now,
                last_action: next_action,
            },
        );
    }
    prune_participants(runtime);
}

pub(super) fn rotate_owner_auth(runtime: &mut ShareRuntime, username: &str) -> ShareOwnerAuth {
    let participant_id = runtime.owner_participant_id.clone();
    let participant_token = new_participant_token();
    let now = now_iso();
    runtime.participants.insert(
        participant_id.clone(),
        ShareParticipantState {
            participant_id: participant_id.clone(),
            username: normalize_share_username(username),
            auth_token: participant_token.clone(),
            last_seen_at: now,
            last_seen_unix: Utc::now().timestamp(),
            last_action: Some("editing".to_string()),
        },
    );
    ShareOwnerAuth {
        participant_id,
        participant_token,
    }
}

pub(super) fn participant_public_list(runtime: &ShareRuntime) -> Vec<ShareParticipantInfo> {
    let mut participants: Vec<ShareParticipantInfo> = runtime
        .participants
        .values()
        .map(|item| ShareParticipantInfo {
            participant_id: item.participant_id.clone(),
            username: item.username.clone(),
            last_seen_at: item.last_seen_at.clone(),
            last_action: item.last_action.clone(),
        })
        .collect();
    participants.sort_by(|a, b| b.last_seen_at.cmp(&a.last_seen_at));
    participants
}
