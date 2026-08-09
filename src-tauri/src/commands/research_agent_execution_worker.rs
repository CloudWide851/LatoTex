use super::{execute_plan, ResearchExecutionContext};
use crate::models::ResearchPlanVersion;
use crate::storage;
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

static ACTIVE_RESEARCH_WORKERS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static RESEARCH_PROCESS_OWNER_ID: OnceLock<String> = OnceLock::new();

pub(super) fn research_process_owner_id() -> String {
    RESEARCH_PROCESS_OWNER_ID
        .get_or_init(|| format!("instance-{}", uuid::Uuid::new_v4().simple()))
        .clone()
}

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
            let (stop_sender, stop_receiver) = std::sync::mpsc::channel::<()>();
            let heartbeat_context = context.clone();
            let heartbeat_run_id = run_id.clone();
            let heartbeat = std::thread::Builder::new()
                .name("latotex-research-run-lease".to_string())
                .spawn(move || loop {
                    match stop_receiver.recv_timeout(std::time::Duration::from_secs(30)) {
                        Ok(_) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                            if storage::heartbeat_research_run_lease(
                                &heartbeat_context.db_path,
                                &heartbeat_context.project_id,
                                &heartbeat_run_id,
                                &heartbeat_context.lease_owner_id,
                                &heartbeat_context.lease_token,
                            )
                            .is_err()
                            {
                                heartbeat_context
                                    .lease_lost
                                    .store(true, std::sync::atomic::Ordering::Release);
                                break;
                            }
                        }
                    }
                });
            let Ok(heartbeat) = heartbeat else {
                let _ = storage::update_research_run_progress(
                    &context.db_path,
                    &context.runtime_root,
                    &context.project_id,
                    &run_id,
                    "failed",
                    None,
                    0,
                    Some("Lease heartbeat failed"),
                    Some("research.run.lease_heartbeat_spawn_failed"),
                );
                let _ = storage::release_research_run_lease(
                    &context.db_path,
                    &context.project_id,
                    &run_id,
                    &context.lease_owner_id,
                    &context.lease_token,
                );
                release_research_worker(&release_key);
                return;
            };
            execute_plan(&context, &run_id, plan);
            let _ = stop_sender.send(());
            let _ = heartbeat.join();
            let _ = storage::release_research_run_lease(
                &context.db_path,
                &context.project_id,
                &run_id,
                &context.lease_owner_id,
                &context.lease_token,
            );
            release_research_worker(&release_key);
        })
        .map(|_| ())
        .map_err(|_| {
            release_research_worker(&worker_key);
            "research.run.spawn_failed".to_string()
        })
}
