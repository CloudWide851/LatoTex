use super::{execute_plan, ResearchExecutionContext};
use crate::models::ResearchPlanVersion;
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

static ACTIVE_RESEARCH_WORKERS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

pub(super) fn research_worker_key(project_id: &str, run_id: &str) -> String {
    format!("{project_id}:{run_id}")
}

pub(super) fn claim_research_worker(worker_key: &str) -> Result<bool, String> {
    let mut workers = ACTIVE_RESEARCH_WORKERS
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
        .map_err(|_| "research.run.worker_registry_failed".to_string())?;
    Ok(workers.insert(worker_key.to_string()))
}

pub(super) fn release_research_worker(worker_key: &str) {
    if let Ok(mut workers) = ACTIVE_RESEARCH_WORKERS
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
    {
        workers.remove(worker_key);
    }
}

pub(super) fn spawn_claimed_plan_worker(
    context: ResearchExecutionContext,
    run_id: String,
    plan: ResearchPlanVersion,
    thread_name: String,
    worker_key: String,
) -> Result<(), String> {
    let release_key = worker_key.clone();
    std::thread::Builder::new()
        .name(thread_name)
        .spawn(move || {
            execute_plan(context, run_id, plan);
            release_research_worker(&release_key);
        })
        .map(|_| ())
        .map_err(|_| {
            release_research_worker(&worker_key);
            "research.run.spawn_failed".to_string()
        })
}
