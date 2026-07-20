use crate::models::AnalysisEnvStatusResponse;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Condvar, Mutex, OnceLock};

#[derive(Default)]
struct PrepareState {
    running: bool,
    result: Option<AnalysisEnvStatusResponse>,
    failure: Option<String>,
}

#[derive(Default)]
struct PrepareSlot {
    state: Mutex<PrepareState>,
    wake: Condvar,
}

fn slots() -> &'static Mutex<HashMap<String, Arc<PrepareSlot>>> {
    static SLOTS: OnceLock<Mutex<HashMap<String, Arc<PrepareSlot>>>> = OnceLock::new();
    SLOTS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn slot_for(env_key: &str) -> Result<Arc<PrepareSlot>, String> {
    let mut guard = slots()
        .lock()
        .map_err(|_| "python.env.coordinator_lock_failed".to_string())?;
    Ok(guard
        .entry(env_key.to_string())
        .or_insert_with(|| Arc::new(PrepareSlot::default()))
        .clone())
}

fn cached_result_is_usable(result: &AnalysisEnvStatusResponse) -> bool {
    result.ready
        && result
            .python_path
            .as_deref()
            .is_some_and(|path| Path::new(path).is_file())
}

pub(super) fn coordinate_analysis_env_prepare<F>(
    env_key: &str,
    explicit_retry: bool,
    work: F,
) -> Result<AnalysisEnvStatusResponse, String>
where
    F: FnOnce() -> Result<AnalysisEnvStatusResponse, String>,
{
    let slot = slot_for(env_key)?;
    let mut state = slot
        .state
        .lock()
        .map_err(|_| "python.env.coordinator_lock_failed".to_string())?;
    loop {
        if state.running {
            state = slot
                .wake
                .wait(state)
                .map_err(|_| "python.env.coordinator_lock_failed".to_string())?;
            continue;
        }
        if let Some(result) = state.result.as_ref() {
            if cached_result_is_usable(result) {
                return Ok(result.clone());
            }
            state.result = None;
        }
        if let Some(error) = state.failure.as_ref() {
            if !explicit_retry {
                return Err(error.clone());
            }
            state.failure = None;
        }
        state.running = true;
        break;
    }
    drop(state);

    let outcome = work();
    let mut state = slot
        .state
        .lock()
        .map_err(|_| "python.env.coordinator_lock_failed".to_string())?;
    state.running = false;
    match &outcome {
        Ok(result) => {
            state.result = Some(result.clone());
            state.failure = None;
        }
        Err(error) => {
            state.result = None;
            state.failure = Some(error.clone());
        }
    }
    slot.wake.notify_all();
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::thread;
    use uuid::Uuid;

    fn status(key: &str) -> AnalysisEnvStatusResponse {
        AnalysisEnvStatusResponse {
            ready: true,
            exists: true,
            env_key: key.to_string(),
            managed_root: String::new(),
            uv_path: None,
            uv_version: None,
            uv_source: None,
            python_path: Some(
                std::env::current_exe()
                    .unwrap()
                    .to_string_lossy()
                    .to_string(),
            ),
            python_version: None,
            pdf_math_translate_version: None,
            venv_path: String::new(),
            runtime_root: String::new(),
            last_error: None,
            failure: None,
        }
    }

    #[test]
    fn concurrent_prepare_executes_mutation_once() {
        let key = format!("env-{}", Uuid::new_v4());
        let count = Arc::new(AtomicUsize::new(0));
        let mut handles = Vec::new();
        for _ in 0..2 {
            let key = key.clone();
            let count = count.clone();
            handles.push(thread::spawn(move || {
                coordinate_analysis_env_prepare(&key, false, || {
                    count.fetch_add(1, Ordering::SeqCst);
                    thread::sleep(std::time::Duration::from_millis(40));
                    Ok(status(&key))
                })
                .unwrap()
            }));
        }
        for handle in handles {
            assert!(handle.join().unwrap().ready);
        }
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn failed_prepare_requires_explicit_retry() {
        let key = format!("env-{}", Uuid::new_v4());
        assert_eq!(
            coordinate_analysis_env_prepare(&key, false, || Err("python.env.failed".to_string()))
                .unwrap_err(),
            "python.env.failed"
        );
        assert_eq!(
            coordinate_analysis_env_prepare(&key, false, || Ok(status(&key))).unwrap_err(),
            "python.env.failed"
        );
        assert!(
            coordinate_analysis_env_prepare(&key, true, || Ok(status(&key)))
                .unwrap()
                .ready
        );
    }
}
