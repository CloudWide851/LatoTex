use crate::models::NativeRuntimeFailure;

fn stable_error_code(error: &str) -> String {
    let candidate = error.split([':', '|']).next().unwrap_or_default().trim();
    if candidate.starts_with("python.env.") || candidate.starts_with("analysis.env.") {
        candidate.to_string()
    } else {
        "python.env.prepare_failed".to_string()
    }
}

pub(super) fn native_runtime_failure(error: &str, stage: &str) -> NativeRuntimeFailure {
    let code = stable_error_code(error);
    let retryable = !matches!(
        code.as_str(),
        "python.env.runtime_resource_missing"
            | "python.env.path_invalid"
            | "python.env.coordinator_lock_failed"
    );
    NativeRuntimeFailure {
        code,
        stage: stage.to_string(),
        retryable,
        diagnostics: vec![crate::logging::sanitize_log_message_with_limit(error, 320)],
    }
}

pub(super) fn public_native_runtime_error(error: &str) -> String {
    stable_error_code(error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failure_keeps_stable_code_and_redacts_detail() {
        let failure = native_runtime_failure(
            "python.env.install_failed: Bearer secret-token https://host/path?token=raw",
            "installing_runtime",
        );
        assert_eq!(failure.code, "python.env.install_failed");
        assert_eq!(failure.stage, "installing_runtime");
        assert!(!failure.diagnostics.join(" ").contains("secret-token"));
        assert!(!failure.diagnostics.join(" ").contains("token=raw"));
    }
}
