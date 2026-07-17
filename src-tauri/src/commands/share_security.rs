use latotex_workspace::resolve_workspace_target_path;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub(super) const SHARE_TARGET_ERROR: &str = "share.invalid_target";
pub(super) const JOIN_MAX_FAILURES: u32 = 8;
pub(super) const JOIN_WINDOW_SECS: i64 = 5 * 60;
pub(super) const JOIN_LOCKOUT_SECS: i64 = 60;
const JOIN_ATTEMPT_MAP_CAP: usize = 1_024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum JoinAuthDecision {
    Authorized,
    Unauthorized,
    RateLimited { retry_after_secs: u64 },
}

#[derive(Debug, Clone)]
struct JoinAttemptState {
    window_started_unix: i64,
    last_attempt_unix: i64,
    failures: u32,
    locked_until_unix: i64,
}

#[derive(Debug, Default)]
pub(super) struct JoinAttemptLimiter {
    attempts: HashMap<String, JoinAttemptState>,
}

impl JoinAttemptLimiter {
    pub(super) fn new() -> Self {
        Self::default()
    }

    pub(super) fn verify(
        &mut self,
        client_key: &str,
        now_unix: i64,
        expected_sid: &str,
        expected_password: &str,
        supplied_sid: &str,
        supplied_password: &str,
    ) -> JoinAuthDecision {
        self.prune(now_unix);
        let key = normalize_client_key(client_key);
        if let Some(state) = self.attempts.get(&key) {
            if state.locked_until_unix > now_unix {
                return JoinAuthDecision::RateLimited {
                    retry_after_secs: (state.locked_until_unix - now_unix).max(1) as u64,
                };
            }
        }

        if secrets_equal(expected_sid, supplied_sid)
            && secrets_equal(expected_password, supplied_password)
        {
            self.attempts.remove(&key);
            return JoinAuthDecision::Authorized;
        }

        if !self.attempts.contains_key(&key) && self.attempts.len() >= JOIN_ATTEMPT_MAP_CAP {
            if let Some(oldest_key) = self
                .attempts
                .iter()
                .min_by_key(|(_, state)| state.last_attempt_unix)
                .map(|(key, _)| key.clone())
            {
                self.attempts.remove(&oldest_key);
            }
        }

        let state = self.attempts.entry(key).or_insert(JoinAttemptState {
            window_started_unix: now_unix,
            last_attempt_unix: now_unix,
            failures: 0,
            locked_until_unix: 0,
        });
        if now_unix.saturating_sub(state.window_started_unix) >= JOIN_WINDOW_SECS {
            state.window_started_unix = now_unix;
            state.failures = 0;
            state.locked_until_unix = 0;
        }
        state.last_attempt_unix = now_unix;
        state.failures = state.failures.saturating_add(1);
        if state.failures >= JOIN_MAX_FAILURES {
            state.locked_until_unix = now_unix.saturating_add(JOIN_LOCKOUT_SECS);
            return JoinAuthDecision::RateLimited {
                retry_after_secs: JOIN_LOCKOUT_SECS as u64,
            };
        }
        JoinAuthDecision::Unauthorized
    }

    fn prune(&mut self, now_unix: i64) {
        self.attempts.retain(|_, state| {
            if state.locked_until_unix > now_unix {
                return true;
            }
            if state.locked_until_unix > 0 {
                return false;
            }
            now_unix.saturating_sub(state.last_attempt_unix) < JOIN_WINDOW_SECS
        });
    }
}

fn normalize_client_key(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        "unknown".to_string()
    } else {
        trimmed.chars().take(96).collect()
    }
}

pub(super) fn secrets_equal(expected: &str, supplied: &str) -> bool {
    let expected = expected.as_bytes();
    let supplied = supplied.as_bytes();
    let max_len = expected.len().max(supplied.len());
    let mut difference = expected.len() ^ supplied.len();
    for index in 0..max_len {
        let left = expected.get(index).copied().unwrap_or_default();
        let right = supplied.get(index).copied().unwrap_or_default();
        difference |= usize::from(left ^ right);
    }
    difference == 0
}

pub(super) fn new_share_password() -> String {
    Uuid::new_v4().simple().to_string()
}

pub(super) fn resolve_share_target_path(
    project_root: &Path,
    target_path: &str,
) -> Result<(String, PathBuf), String> {
    let normalized = target_path.trim().replace('\\', "/");
    if normalized.is_empty() || !normalized.to_ascii_lowercase().ends_with(".tex") {
        return Err(SHARE_TARGET_ERROR.to_string());
    }
    let resolved = resolve_workspace_target_path(project_root, Some(&normalized))
        .map_err(|_| SHARE_TARGET_ERROR.to_string())?;
    if !resolved.is_file()
        || resolved
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| !value.eq_ignore_ascii_case("tex"))
            .unwrap_or(true)
    {
        return Err(SHARE_TARGET_ERROR.to_string());
    }
    let canonical_root = project_root
        .canonicalize()
        .map_err(|_| SHARE_TARGET_ERROR.to_string())?;
    let relative = resolved
        .strip_prefix(&canonical_root)
        .map_err(|_| SHARE_TARGET_ERROR.to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    Ok((relative, resolved))
}

pub(super) fn read_share_target(project_root: &Path, target_path: &str) -> Result<String, String> {
    let (_, resolved) = resolve_share_target_path(project_root, target_path)?;
    fs::read_to_string(resolved).map_err(|_| "share.target_unreadable".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct ShareTargetFixture {
        root: PathBuf,
        parent: PathBuf,
    }

    impl ShareTargetFixture {
        fn new() -> Self {
            let unique = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock after epoch")
                .as_nanos();
            let parent = std::env::temp_dir().join(format!("latotex-share-target-{unique}"));
            let root = parent.join("project");
            fs::create_dir_all(&root).expect("create project root");
            Self { root, parent }
        }
    }

    impl Drop for ShareTargetFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.parent);
        }
    }

    #[test]
    fn share_password_has_full_uuid_entropy_shape() {
        let password = new_share_password();
        assert_eq!(password.len(), 32);
        assert!(password
            .chars()
            .all(|character| character.is_ascii_hexdigit()));
    }

    #[test]
    fn share_target_requires_an_existing_safe_tex_file() {
        let fixture = ShareTargetFixture::new();
        fs::write(fixture.root.join("paper.tex"), b"content").expect("write tex target");
        fs::write(fixture.root.join("notes.txt"), b"content").expect("write non-tex target");
        fs::write(fixture.parent.join("escape.tex"), b"content").expect("write outside target");

        let (relative, resolved) = resolve_share_target_path(&fixture.root, ".\\paper.tex")
            .expect("safe tex target resolves");
        assert_eq!(relative, "paper.tex");
        assert_eq!(
            resolved,
            fixture
                .root
                .join("paper.tex")
                .canonicalize()
                .expect("canonical tex target")
        );
        assert_eq!(
            resolve_share_target_path(&fixture.root, "notes.txt").unwrap_err(),
            SHARE_TARGET_ERROR
        );
        assert_eq!(
            resolve_share_target_path(&fixture.root, "missing.tex").unwrap_err(),
            SHARE_TARGET_ERROR
        );
        assert_eq!(
            resolve_share_target_path(&fixture.root, "../escape.tex").unwrap_err(),
            SHARE_TARGET_ERROR
        );
    }

    #[test]
    fn join_limiter_locks_at_threshold_and_resets_after_timeout() {
        let mut limiter = JoinAttemptLimiter::new();
        for attempt in 0..(JOIN_MAX_FAILURES - 1) {
            assert_eq!(
                limiter.verify(
                    "127.0.0.1",
                    i64::from(attempt),
                    "sid",
                    "secret",
                    "sid",
                    "wrong"
                ),
                JoinAuthDecision::Unauthorized
            );
        }
        assert_eq!(
            limiter.verify("127.0.0.1", 7, "sid", "secret", "sid", "wrong"),
            JoinAuthDecision::RateLimited {
                retry_after_secs: JOIN_LOCKOUT_SECS as u64,
            }
        );
        assert!(matches!(
            limiter.verify("127.0.0.1", 8, "sid", "secret", "sid", "secret"),
            JoinAuthDecision::RateLimited { .. }
        ));
        assert_eq!(
            limiter.verify("127.0.0.1", 68, "sid", "secret", "sid", "wrong"),
            JoinAuthDecision::Unauthorized
        );
    }

    #[test]
    fn successful_join_clears_failure_state_without_revealing_bad_field() {
        let mut limiter = JoinAttemptLimiter::new();
        assert_eq!(
            limiter.verify("client", 1, "sid", "secret", "wrong", "secret"),
            JoinAuthDecision::Unauthorized
        );
        assert_eq!(
            limiter.verify("client", 2, "sid", "secret", "sid", "wrong"),
            JoinAuthDecision::Unauthorized
        );
        assert_eq!(
            limiter.verify("client", 3, "sid", "secret", "sid", "secret"),
            JoinAuthDecision::Authorized
        );
        assert_eq!(
            limiter.verify("client", 4, "sid", "secret", "sid", "wrong"),
            JoinAuthDecision::Unauthorized
        );
    }
}
