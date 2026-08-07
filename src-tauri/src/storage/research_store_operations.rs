pub fn research_workspace_snapshot(
    db_path: &Path,
    runtime_root: &Path,
    project_id: &str,
) -> Result<ResearchWorkspaceSnapshot, String> {
    let conn = open_research_database(db_path, project_id)?;
    Ok(ResearchWorkspaceSnapshot {
        tasks: load_research_tasks_from(&conn, runtime_root, project_id)?,
        plans: load_research_plans_from(&conn, runtime_root, project_id)?,
        chat_store: load_chat_store_from(&conn, runtime_root, project_id)?,
    })
}

pub fn load_research_plan_version(
    db_path: &Path,
    runtime_root: &Path,
    project_id: &str,
    task_id: &str,
    version: i64,
) -> Result<ResearchPlanVersion, String> {
    let conn = open_research_database(db_path, project_id)?;
    load_research_plans_from(&conn, runtime_root, project_id)?
        .into_iter()
        .find(|plan| plan.task_id == task_id && plan.version == version)
        .ok_or_else(|| "research.plan.not_found".to_string())
}

pub fn create_research_task(
    db_path: &Path,
    runtime_root: &Path,
    input: ResearchTaskCreateInput,
) -> Result<ResearchTask, String> {
    let goal = input.goal.trim();
    if goal.is_empty() || goal.len() > MAX_TASK_GOAL_BYTES {
        return Err("research.task.goal_invalid".to_string());
    }
    let conn = open_research_database(db_path, &input.project_id)?;
    let id = format!("task-{}", Uuid::new_v4().simple());
    let now = now_iso();
    let encrypted_goal =
        seal_research_json(runtime_root, &input.project_id, "task", &id, "goal", &goal)?;
    conn.execute(
        "INSERT INTO research_tasks
         (id, goal_envelope, status, current_plan_version, run_ids_json, created_at, updated_at)
         VALUES (?1, ?2, 'discussion', NULL, '[]', ?3, ?3)",
        params![id, encrypted_goal, now],
    )
    .map_err(|_| "research.storage.write_failed".to_string())?;
    Ok(ResearchTask {
        id,
        project_id: input.project_id,
        goal: goal.to_string(),
        status: "discussion".to_string(),
        current_plan_version: None,
        run_ids: Vec::new(),
        created_at: now.clone(),
        updated_at: now,
    })
}

fn validate_authorized_projects(
    db_path: &Path,
    project_id: &str,
    requested: &[String],
) -> Result<Vec<String>, String> {
    let mut projects = vec![project_id.to_string()];
    for candidate in requested {
        let candidate = validate_research_id(candidate)?.to_string();
        if !projects.contains(&candidate) {
            projects.push(candidate);
        }
    }
    if projects.len() > 4 {
        return Err("research.plan.project_scope_limit".to_string());
    }
    let conn = Connection::open(db_path).map_err(|_| "research.storage.open_failed".to_string())?;
    for candidate in &projects {
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1)",
                params![candidate],
                |row| row.get(0),
            )
            .map_err(|_| "research.storage.query_failed".to_string())?;
        if !exists {
            return Err("research.plan.project_scope_invalid".to_string());
        }
    }
    Ok(projects)
}

pub fn save_research_plan(
    db_path: &Path,
    runtime_root: &Path,
    input: ResearchPlanSaveInput,
) -> Result<ResearchPlanVersion, String> {
    validate_research_id(&input.task_id)?;
    if input.steps.is_empty() || input.steps.len() > MAX_PLAN_STEPS {
        return Err("research.plan.steps_invalid".to_string());
    }
    let authorized =
        validate_authorized_projects(db_path, &input.project_id, &input.authorized_project_ids)?;
    let mut conn = open_research_database(db_path, &input.project_id)?;
    let transaction = conn
        .transaction()
        .map_err(|_| "research.storage.transaction_failed".to_string())?;
    let task_exists: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM research_tasks WHERE id = ?1)",
            params![input.task_id],
            |row| row.get(0),
        )
        .map_err(|_| "research.storage.query_failed".to_string())?;
    if !task_exists {
        return Err("research.task.not_found".to_string());
    }
    let version: i64 = transaction
        .query_row(
            "SELECT COALESCE(MAX(version), 0) + 1 FROM research_plan_versions WHERE task_id = ?1",
            params![input.task_id],
            |row| row.get(0),
        )
        .map_err(|_| "research.storage.query_failed".to_string())?;
    let plan_id = format!("plan-{}", Uuid::new_v4().simple());
    let created_at = now_iso();
    let source_message = seal_research_json(
        runtime_root,
        &input.project_id,
        "plan",
        &plan_id,
        "source-message",
        &input.source_message,
    )?;
    let authorized_envelope = seal_research_json(
        runtime_root,
        &input.project_id,
        "plan",
        &plan_id,
        "authorized-projects",
        &authorized,
    )?;
    transaction
        .execute(
            "INSERT INTO research_plan_versions
             (id, task_id, version, source_message_envelope, approval_status,
              authorized_projects_envelope, created_at)
             VALUES (?1, ?2, ?3, ?4, 'draft', ?5, ?6)",
            params![
                plan_id,
                input.task_id,
                version,
                source_message,
                authorized_envelope,
                created_at,
            ],
        )
        .map_err(|_| "research.storage.write_failed".to_string())?;
    let mut steps = Vec::new();
    for (order, draft) in input.steps.into_iter().enumerate() {
        let step_id = draft
            .id
            .as_deref()
            .map(validate_research_id)
            .transpose()?
            .map(str::to_string)
            .unwrap_or_else(|| format!("step-{}", Uuid::new_v4().simple()));
        if steps
            .iter()
            .any(|step: &ResearchPlanStep| step.id == step_id)
        {
            return Err("research.plan.step_duplicate".to_string());
        }
        if draft.capability.trim().is_empty() || draft.capability.len() > 128 {
            return Err("research.plan.capability_invalid".to_string());
        }
        // Consume but never trust the model-supplied risk; the registry is authoritative.
        let _requested_risk_level = draft.risk_level.as_str();
        let descriptor = crate::research_agent::capability_descriptor(&draft.capability)?;
        crate::research_agent::parse_app_command(&draft.capability, &draft.input)?;
        let input_envelope = seal_research_json(
            runtime_root,
            &input.project_id,
            "plan-step",
            &format!("{plan_id}:{step_id}"),
            "input",
            &draft.input,
        )?;
        let dependencies_json = serde_json::to_string(&draft.dependencies)
            .map_err(|_| "research.storage.serialize_failed".to_string())?;
        transaction
            .execute(
                "INSERT INTO research_plan_steps
                 (id, plan_version_id, step_order, enabled, dependencies_json, capability,
                  input_envelope, risk_level, status)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending')",
                params![
                    step_id,
                    plan_id,
                    order as i64,
                    draft.enabled,
                    dependencies_json,
                    draft.capability,
                    input_envelope,
                    descriptor.risk_level,
                ],
            )
            .map_err(|_| "research.storage.write_failed".to_string())?;
        steps.push(ResearchPlanStep {
            id: step_id,
            order: order as i64,
            enabled: draft.enabled,
            dependencies: draft.dependencies,
            capability: draft.capability,
            input: draft.input,
            risk_level: descriptor.risk_level,
            status: "pending".to_string(),
            run_id: None,
        });
    }
    crate::research_agent::validate_plan_steps(&steps)?;
    transaction
        .execute(
            "UPDATE research_tasks SET current_plan_version = ?1, status = 'plan_pending', updated_at = ?2
             WHERE id = ?3",
            params![version, created_at, input.task_id],
        )
        .map_err(|_| "research.storage.write_failed".to_string())?;
    transaction
        .commit()
        .map_err(|_| "research.storage.commit_failed".to_string())?;
    Ok(ResearchPlanVersion {
        id: plan_id,
        task_id: input.task_id,
        version,
        source_message: input.source_message,
        approval_status: "draft".to_string(),
        authorized_project_ids: authorized,
        steps,
        created_at,
        approved_at: None,
    })
}

pub fn approve_research_plan(
    db_path: &Path,
    runtime_root: &Path,
    input: ResearchPlanApproveInput,
) -> Result<ResearchPlanVersion, String> {
    let mut conn = open_research_database(db_path, &input.project_id)?;
    let transaction = conn
        .transaction()
        .map_err(|_| "research.storage.transaction_failed".to_string())?;
    let plan_id: String = transaction
        .query_row(
            "SELECT id FROM research_plan_versions WHERE task_id = ?1 AND version = ?2",
            params![input.task_id, input.version],
            |row| row.get(0),
        )
        .map_err(|_| "research.plan.not_found".to_string())?;
    let current_version: Option<i64> = transaction
        .query_row(
            "SELECT current_plan_version FROM research_tasks WHERE id = ?1",
            params![input.task_id],
            |row| row.get(0),
        )
        .map_err(|_| "research.task.not_found".to_string())?;
    if current_version != Some(input.version) {
        return Err("research.plan.not_current".to_string());
    }
    let approved_at = now_iso();
    transaction
        .execute(
            "UPDATE research_plan_versions SET approval_status = 'superseded'
             WHERE task_id = ?1 AND approval_status = 'approved'",
            params![input.task_id],
        )
        .map_err(|_| "research.storage.write_failed".to_string())?;
    transaction
        .execute(
            "UPDATE research_plan_versions SET approval_status = 'approved', approved_at = ?1
             WHERE id = ?2",
            params![approved_at, plan_id],
        )
        .map_err(|_| "research.storage.write_failed".to_string())?;
    transaction
        .execute(
            "UPDATE research_tasks SET status = 'execution', updated_at = ?1 WHERE id = ?2",
            params![approved_at, input.task_id],
        )
        .map_err(|_| "research.storage.write_failed".to_string())?;
    transaction
        .commit()
        .map_err(|_| "research.storage.commit_failed".to_string())?;
    let plans = load_research_plans_from(&conn, runtime_root, &input.project_id)?;
    plans
        .into_iter()
        .find(|plan| plan.id == plan_id)
        .ok_or_else(|| "research.plan.not_found".to_string())
}

pub fn research_chat_store_get(
    db_path: &Path,
    runtime_root: &Path,
    project_id: &str,
) -> Result<ResearchChatStore, String> {
    let conn = open_research_database(db_path, project_id)?;
    load_chat_store_from(&conn, runtime_root, project_id)
}

pub fn research_chat_store_replace(
    db_path: &Path,
    runtime_root: &Path,
    input: ResearchChatStoreReplaceInput,
) -> Result<ResearchChatStore, String> {
    let mut conn = open_research_database(db_path, &input.project_id)?;
    let transaction = conn
        .transaction()
        .map_err(|_| "research.storage.transaction_failed".to_string())?;
    replace_chat_store_in(&transaction, runtime_root, &input.project_id, &input.store)?;
    transaction
        .commit()
        .map_err(|_| "research.storage.commit_failed".to_string())?;
    load_chat_store_from(&conn, runtime_root, &input.project_id)
}

pub fn research_chat_store_migrate(
    db_path: &Path,
    runtime_root: &Path,
    input: ResearchChatMigrationInput,
) -> Result<ResearchChatMigrationResult, String> {
    validate_research_id(&input.migration_id)?;
    let mut conn = open_research_database(db_path, &input.project_id)?;
    let already_migrated: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM research_migrations WHERE id = ?1)",
            params![input.migration_id],
            |row| row.get(0),
        )
        .map_err(|_| "research.storage.query_failed".to_string())?;
    if already_migrated {
        let store = load_chat_store_from(&conn, runtime_root, &input.project_id)?;
        return Ok(ResearchChatMigrationResult {
            migrated: false,
            verified: true,
            store,
            diagnostic_code: None,
        });
    }
    let transaction = conn
        .transaction()
        .map_err(|_| "research.storage.transaction_failed".to_string())?;
    replace_chat_store_in(&transaction, runtime_root, &input.project_id, &input.store)?;
    let verified_store = load_chat_store_from(&transaction, runtime_root, &input.project_id)?;
    if verified_store.sessions != input.store.sessions
        || verified_store.active_session_id != input.store.active_session_id
    {
        return Err("research.migration.verification_failed".to_string());
    }
    transaction
        .execute(
            "INSERT INTO research_migrations (id, completed_at) VALUES (?1, ?2)",
            params![input.migration_id, now_iso()],
        )
        .map_err(|_| "research.storage.write_failed".to_string())?;
    transaction
        .commit()
        .map_err(|_| "research.storage.commit_failed".to_string())?;
    let store = load_chat_store_from(&conn, runtime_root, &input.project_id)?;
    Ok(ResearchChatMigrationResult {
        migrated: true,
        verified: true,
        store,
        diagnostic_code: None,
    })
}
