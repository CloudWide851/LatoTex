fn execution_context(
    state: &AppState,
    project_id: &str,
    lease_owner_id: String,
    lease_token: String,
) -> ResearchExecutionContext {
    ResearchExecutionContext {
        db_path: state.db_path.clone(),
        runtime_root: state.runtime_root.clone(),
        app_data_dir: state.app_data_dir.clone(),
        project_id: project_id.to_string(),
        lease_owner_id,
        lease_token,
        lease_lost: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
    }
}

fn claim_execution_context(
    state: &AppState,
    project_id: &str,
    run_id: &str,
    worker_key: &str,
) -> Result<Option<ResearchExecutionContext>, String> {
    if !claim_research_worker(worker_key)? {
        return Ok(None);
    }
    let owner_id = worker::research_process_owner_id();
    let token =
        match storage::claim_research_run_lease(&state.db_path, project_id, run_id, &owner_id) {
            Ok(Some(token)) => token,
            Ok(None) => {
                worker::release_research_worker(worker_key);
                return Ok(None);
            }
            Err(error) => {
                worker::release_research_worker(worker_key);
                return Err(error);
            }
        };
    Ok(Some(execution_context(state, project_id, owner_id, token)))
}

fn claim_execution_context_after_handoff(
    state: &AppState,
    project_id: &str,
    run_id: &str,
    worker_key: &str,
) -> Result<Option<ResearchExecutionContext>, String> {
    for attempt in 0..=40 {
        if let Some(context) = claim_execution_context(state, project_id, run_id, worker_key)? {
            return Ok(Some(context));
        }
        if attempt < 40 {
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
    }
    Ok(None)
}

fn release_execution_context(
    state: &AppState,
    context: &ResearchExecutionContext,
    run_id: &str,
    worker_key: &str,
) {
    let _ = storage::release_research_run_lease(
        &state.db_path,
        &context.project_id,
        run_id,
        &context.lease_owner_id,
        &context.lease_token,
    );
    worker::release_research_worker(worker_key);
}

pub fn start_plan_execution(
    state: &AppState,
    project_id: &str,
    task_id: &str,
    version: i64,
) -> Result<ResearchPlanExecutionAccepted, String> {
    let (run, plan) = storage::create_research_plan_run(
        &state.db_path,
        &state.runtime_root,
        project_id,
        task_id,
        version,
    )?;
    let run_id = run.run_id.clone();
    let worker_key = research_worker_key(project_id, &run_id);
    let context = claim_execution_context(state, project_id, &run_id, &worker_key)?
        .ok_or_else(|| "research.run.already_active".to_string())?;
    if let Err(error) = spawn_claimed_plan_worker(
        context.clone(),
        run_id.clone(),
        plan,
        format!("latotex-research-{}", &run_id[..run_id.len().min(28)]),
        worker_key.clone(),
    ) {
        release_execution_context(state, &context, &run_id, &worker_key);
        let _ = storage::update_research_run_progress(
            &state.db_path,
            &state.runtime_root,
            project_id,
            &run_id,
            "failed",
            None,
            0,
            Some("Worker start failed"),
            Some(&error),
        );
        return Err(error);
    }
    Ok(ResearchPlanExecutionAccepted {
        run_id,
        status: "running".to_string(),
    })
}

pub fn resume_plan_execution(
    state: &AppState,
    project_id: &str,
    run_id: &str,
) -> Result<ResearchPlanExecutionAccepted, String> {
    let run =
        storage::get_research_plan_run(&state.db_path, &state.runtime_root, project_id, run_id)?;
    if matches!(run.status.as_str(), "completed" | "failed" | "cancelled") {
        return Err("research.run.terminal".to_string());
    }
    let plan = storage::load_research_plan_version(
        &state.db_path,
        &state.runtime_root,
        project_id,
        &run.task_id,
        run.plan_version,
    )?;
    let worker_key = research_worker_key(project_id, run_id);
    let Some(context) =
        claim_execution_context_after_handoff(state, project_id, run_id, &worker_key)?
    else {
        return Ok(ResearchPlanExecutionAccepted {
            run_id: run_id.to_string(),
            status: run.status,
        });
    };
    if let Err(error) = storage::update_research_run_progress(
        &state.db_path,
        &state.runtime_root,
        project_id,
        run_id,
        "running",
        run.current_step_id.as_deref(),
        run.completed_steps,
        run.last_operation.as_deref(),
        None,
    ) {
        release_execution_context(state, &context, run_id, &worker_key);
        return Err(error);
    }
    if let Err(error) = spawn_claimed_plan_worker(
        context.clone(),
        run_id.to_string(),
        plan,
        "latotex-research-resume".to_string(),
        worker_key.clone(),
    ) {
        release_execution_context(state, &context, run_id, &worker_key);
        let _ = storage::update_research_run_progress(
            &state.db_path,
            &state.runtime_root,
            project_id,
            run_id,
            &run.status,
            run.current_step_id.as_deref(),
            run.completed_steps,
            run.last_operation.as_deref(),
            run.diagnostic_code.as_deref(),
        );
        return Err(error);
    }
    Ok(ResearchPlanExecutionAccepted {
        run_id: run_id.to_string(),
        status: "running".to_string(),
    })
}

fn capability_allows_automatic_replay(
    descriptor: &crate::models::ResearchCapabilityDescriptor,
) -> bool {
    descriptor.risk_level == "read"
        && descriptor.execution_target == "backend"
        && descriptor.idempotency == "safe_replay"
        && descriptor.egress_category == "none"
}

fn research_run_can_replay(
    state: &AppState,
    project_id: &str,
    run: &crate::models::ResearchAgentRun,
) -> Result<bool, String> {
    if run.status == "validating" {
        return Ok(true);
    }
    if run.status != "running" {
        return Ok(false);
    }
    let plan = storage::load_research_plan_version(
        &state.db_path,
        &state.runtime_root,
        project_id,
        &run.task_id,
        run.plan_version,
    )?;
    for step in ordered_execution_steps(&plan)? {
        if storage::research_step_is_completed(&state.db_path, project_id, &run.run_id, &step.id)? {
            continue;
        }
        let descriptor = crate::research_agent::capability_descriptor(&step.capability)?;
        return Ok(capability_allows_automatic_replay(&descriptor));
    }
    Ok(true)
}

pub fn recover_plan_executions(
    state: &AppState,
    project_id: &str,
) -> Result<crate::models::ResearchRunRecoveryResponse, String> {
    let cleaned_lease_count =
        storage::cleanup_expired_research_run_leases(&state.db_path, project_id)?;
    let cleaned_lock_count =
        storage::cleanup_expired_research_resource_locks(&state.db_path, project_id)?;
    let runs =
        storage::list_research_plan_runs(&state.db_path, &state.runtime_root, project_id, false)?;
    let mut response = crate::models::ResearchRunRecoveryResponse {
        resumed_run_ids: Vec::new(),
        preserved_run_ids: Vec::new(),
        review_required_run_ids: Vec::new(),
        cleaned_lease_count,
        cleaned_lock_count,
    };
    for run in runs {
        if matches!(
            run.status.as_str(),
            "waiting_ui" | "waiting_approval" | "paused"
        ) {
            response.preserved_run_ids.push(run.run_id);
            continue;
        }
        if run.status == "recovery_required" || !research_run_can_replay(state, project_id, &run)? {
            storage::update_research_run_progress(
                &state.db_path,
                &state.runtime_root,
                project_id,
                &run.run_id,
                "recovery_required",
                run.current_step_id.as_deref(),
                run.completed_steps,
                run.last_operation.as_deref(),
                Some("research.run.recovery_review_required"),
            )?;
            response.review_required_run_ids.push(run.run_id);
            continue;
        }
        resume_plan_execution(state, project_id, &run.run_id)?;
        response.resumed_run_ids.push(run.run_id);
    }
    Ok(response)
}
