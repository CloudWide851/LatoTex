use std::sync::atomic::{AtomicBool, Ordering};

fn knowledge_search_runs(
) -> &'static std::sync::Mutex<std::collections::HashMap<String, Vec<std::sync::Arc<AtomicBool>>>> {
    static RUNS: std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashMap<String, Vec<std::sync::Arc<AtomicBool>>>>,
    > = std::sync::OnceLock::new();
    RUNS.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

pub(crate) fn knowledge_search_run_id(requested: Option<&str>) -> Result<String, String> {
    let run_id = requested
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    if run_id.len() > 128
        || !run_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("knowledge.search.run_id_invalid".to_string());
    }
    Ok(run_id)
}

pub(crate) struct KnowledgeSearchRunGuard {
    run_id: String,
    cancelled: std::sync::Arc<AtomicBool>,
}

impl KnowledgeSearchRunGuard {
    pub(crate) fn register(run_id: String) -> Result<Self, String> {
        let cancelled = std::sync::Arc::new(AtomicBool::new(false));
        knowledge_search_runs()
            .lock()
            .map_err(|_| "knowledge.search.failed".to_string())?
            .entry(run_id.clone())
            .or_default()
            .push(cancelled.clone());
        Ok(Self { run_id, cancelled })
    }

    pub(crate) fn ensure_active(&self) -> Result<(), String> {
        if self.cancelled.load(Ordering::Relaxed) {
            Err("knowledge.search.cancelled".to_string())
        } else {
            Ok(())
        }
    }

    pub(crate) fn run_id(&self) -> &str {
        &self.run_id
    }
}

impl Drop for KnowledgeSearchRunGuard {
    fn drop(&mut self) {
        let Ok(mut runs) = knowledge_search_runs().lock() else {
            return;
        };
        if let Some(flags) = runs.get_mut(&self.run_id) {
            flags.retain(|flag| !std::sync::Arc::ptr_eq(flag, &self.cancelled));
            if flags.is_empty() {
                runs.remove(&self.run_id);
            }
        }
    }
}

pub fn cancel_knowledge_search_run(run_id: &str) -> Result<Ack, String> {
    let run_id = knowledge_search_run_id(Some(run_id))?;
    let runs = knowledge_search_runs()
        .lock()
        .map_err(|_| "knowledge.search.failed".to_string())?;
    if let Some(flags) = runs.get(&run_id) {
        for flag in flags {
            flag.store(true, Ordering::Relaxed);
        }
    }
    Ok(Ack {
        ok: true,
        message: "knowledge.search.cancelled".to_string(),
    })
}

#[cfg(test)]
mod knowledge_search_control_tests {
    use super::*;

    #[test]
    fn cancellation_marks_every_worker_for_the_same_run() {
        let run_id = format!("knowledge-test-{}", Uuid::new_v4().simple());
        let first = KnowledgeSearchRunGuard::register(run_id.clone()).unwrap();
        let second = KnowledgeSearchRunGuard::register(run_id.clone()).unwrap();
        cancel_knowledge_search_run(&run_id).unwrap();
        assert_eq!(
            first.ensure_active().unwrap_err(),
            "knowledge.search.cancelled"
        );
        assert_eq!(
            second.ensure_active().unwrap_err(),
            "knowledge.search.cancelled"
        );
    }

    #[test]
    fn rejects_unbounded_or_structured_run_ids() {
        assert_eq!(
            knowledge_search_run_id(Some("../escape")).unwrap_err(),
            "knowledge.search.run_id_invalid"
        );
        assert_eq!(
            knowledge_search_run_id(Some(&"a".repeat(129))).unwrap_err(),
            "knowledge.search.run_id_invalid"
        );
    }
}
