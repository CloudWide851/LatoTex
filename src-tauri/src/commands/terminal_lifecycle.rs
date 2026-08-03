use super::*;

pub(super) fn prepare_terminal(
    shell_spec: TerminalShellSpec,
    directory: PathBuf,
    size: PtySize,
    cancel_flag: Arc<AtomicBool>,
) -> Result<PreparedTerminal, TerminalInternalFailure> {
    if cancel_flag.load(Ordering::Relaxed) {
        return Err(internal_failure(
            "terminal.failure.start_cancelled",
            "queued",
            true,
            "cancelled before PTY creation",
        ));
    }
    let pty_system = native_pty_system();
    let pair = pty_system.openpty(size).map_err(|error| {
        internal_failure(
            "terminal.failure.pty_unavailable",
            "pty",
            true,
            error.to_string(),
        )
    })?;
    if cancel_flag.load(Ordering::Relaxed) {
        return Err(internal_failure(
            "terminal.failure.start_cancelled",
            "pty",
            true,
            "cancelled after PTY creation",
        ));
    }
    let reader = pair.master.try_clone_reader().map_err(|error| {
        internal_failure(
            "terminal.failure.pty_unavailable",
            "pty",
            true,
            error.to_string(),
        )
    })?;
    let writer = pair.master.take_writer().map_err(|error| {
        internal_failure(
            "terminal.failure.pty_unavailable",
            "pty",
            true,
            error.to_string(),
        )
    })?;
    let mut command = CommandBuilder::new(&shell_spec.shell);
    command.args(&shell_spec.args);
    command.cwd(PathBuf::from(runtime_path_text(&directory)));
    for (key, value) in terminal_env_pairs() {
        command.env(key, value);
    }
    for (key, value) in &shell_spec.env {
        command.env(key, value);
    }
    let mut child = pair.slave.spawn_command(command).map_err(|error| {
        internal_failure(
            "terminal.failure.shell_start_failed",
            "shell",
            true,
            error.to_string(),
        )
    })?;
    drop(pair.slave);
    if cancel_flag.load(Ordering::Relaxed) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(internal_failure(
            "terminal.failure.start_cancelled",
            "shell",
            true,
            "cancelled after shell spawn",
        ));
    }
    Ok(PreparedTerminal {
        shell: shell_spec.shell,
        directory,
        master: pair.master,
        child,
        writer,
        reader,
        launch_kind: shell_spec.launch_kind,
        resource_lease: shell_spec.resource_lease,
    })
}

fn terminal_start_blocking(
    state: AppState,
    input: TerminalStartInput,
    cancel_flag: Arc<AtomicBool>,
) -> Result<TerminalStartResponse, String> {
    let (project_root, requested_directory) =
        resolve_terminal_directory(&state, &input.project_id, input.relative_path.as_deref())
            .map_err(|error| {
                state.log(
                    "ERROR",
                    &format!(
                        "terminal_start.failed: request={}, stage=cwd, diagnostics={error}",
                        input.request_id
                    ),
                );
                public_failure_code("terminal.failure.cwd_unavailable", "cwd", false)
            })?;
    let (shell_spec, directory) = if input.launch_kind == TerminalLaunchKind::Shell {
        let shell_setting = terminal_shell_pref(&state);
        (terminal_shell_command(&shell_setting), requested_directory)
    } else {
        (
            external_runtime::external_terminal_spec(&state, &input, &project_root)?,
            project_root,
        )
    };
    let size = clamp_pty_size(input.cols, input.rows);
    let cols = size.cols;
    let rows = size.rows;
    let (tx, rx) = mpsc::sync_channel(1);
    let worker_cancel = cancel_flag.clone();
    let worker_directory = directory.clone();
    std::thread::spawn(move || {
        let _ = tx.send(prepare_terminal(
            shell_spec,
            worker_directory,
            size,
            worker_cancel,
        ));
    });

    let prepared = match rx.recv_timeout(TERMINAL_START_TIMEOUT) {
        Ok(Ok(prepared)) => prepared,
        Ok(Err(error)) => {
            state.log(
                "ERROR",
                &format!(
                    "terminal_start.failed: request={}, code={}, stage={}, diagnostics={}",
                    input.request_id, error.failure.code, error.failure.stage, error.diagnostics
                ),
            );
            return Err(public_failure(&error.failure));
        }
        Err(mpsc::RecvTimeoutError::Timeout) => {
            cancel_flag.store(true, Ordering::Relaxed);
            state.log(
                "ERROR",
                &format!(
                    "terminal_start.failed: request={}, code=terminal.failure.start_timeout, stage=shell",
                    input.request_id
                ),
            );
            return Err(public_failure_code(
                "terminal.failure.start_timeout",
                "shell",
                true,
            ));
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            state.log(
                "ERROR",
                &format!(
                    "terminal_start.failed: request={}, code=terminal.failure.start_interrupted, stage=shell",
                    input.request_id
                ),
            );
            return Err(public_failure_code(
                "terminal.failure.start_interrupted",
                "shell",
                true,
            ));
        }
    };
    if cancel_flag.load(Ordering::Relaxed) {
        let mut child = prepared.child;
        let _ = child.kill();
        let _ = child.wait();
        return Err(public_failure_code(
            "terminal.failure.start_cancelled",
            "register",
            true,
        ));
    }

    let session_id = Uuid::new_v4().to_string();
    let session = Arc::new(TerminalSession {
        cwd: runtime_path_text(&prepared.directory),
        shell: prepared.shell.clone(),
        venv_path: Mutex::new(None),
        env_source: Mutex::new(None),
        resource_lease: Mutex::new(prepared.resource_lease),
        master: Mutex::new(prepared.master),
        child: Mutex::new(prepared.child),
        writer: Mutex::new(prepared.writer),
        output: Mutex::new(Vec::new()),
        next_seq: AtomicU64::new(0),
        status: Mutex::new(TerminalStatus::Running),
        failure: Mutex::new(None),
        exit_code: Mutex::new(None),
    });
    let register_result = state
        .terminal_sessions
        .lock()
        .map_err(|_| ())
        .map(|mut sessions| {
            sessions.insert(session_id.clone(), session.clone());
        });
    if register_result.is_err() {
        if let Ok(mut child) = session.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
        return Err(public_failure_code(
            "terminal.failure.registry_unavailable",
            "register",
            true,
        ));
    }
    spawn_pty_reader(session.clone(), prepared.reader);
    state.log(
        "INFO",
        &format!(
            "terminal_start: project={}, request={}, session={}, cwd={}, shell={}, launch={:?}, cols={}, rows={}",
            input.project_id,
            input.request_id,
            session_id,
            session.cwd,
            prepared.shell,
            prepared.launch_kind,
            cols,
            rows,
        ),
    );
    Ok(TerminalStartResponse {
        session_id,
        cwd: session.cwd.clone(),
        shell: prepared.shell,
        launch_kind: prepared.launch_kind,
        venv_path: None,
        env_source: None,
        status: TerminalStatus::Running,
    })
}

#[tauri::command]
pub async fn terminal_start(
    state: State<'_, AppState>,
    input: TerminalStartInput,
) -> Result<TerminalStartResponse, String> {
    if input.request_id.trim().is_empty() {
        return Err(public_failure_code(
            "terminal.failure.request_invalid",
            "queued",
            false,
        ));
    }
    let request_id = input.request_id.clone();
    let cancel_flag = Arc::new(AtomicBool::new(false));
    state
        .terminal_start_cancels
        .lock()
        .map_err(|_| public_failure_code("terminal.failure.registry_unavailable", "queued", true))?
        .insert(request_id.clone(), cancel_flag.clone());
    let state_snapshot = state.inner().clone();
    let result = match tauri::async_runtime::spawn_blocking(move || {
        terminal_start_blocking(state_snapshot, input, cancel_flag)
    })
    .await
    {
        Ok(result) => result,
        Err(_) => Err(public_failure_code(
            "terminal.failure.start_interrupted",
            "shell",
            true,
        )),
    };
    if let Ok(mut cancels) = state.terminal_start_cancels.lock() {
        cancels.remove(&request_id);
    }
    result
}

#[tauri::command]
pub fn terminal_cancel_start(
    state: State<'_, AppState>,
    input: TerminalCancelStartInput,
) -> Result<Ack, String> {
    let flag = state
        .terminal_start_cancels
        .lock()
        .map_err(|_| public_failure_code("terminal.failure.registry_unavailable", "cancel", true))?
        .get(&input.request_id)
        .cloned();
    if let Some(flag) = flag {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(Ack {
        ok: true,
        message: "terminal.cancel.ok".to_string(),
    })
}

#[tauri::command]
pub async fn terminal_activate_research_env(
    state: State<'_, AppState>,
    input: TerminalActivateInput,
) -> Result<TerminalActivateResponse, String> {
    let state_snapshot = state.inner().clone();
    let project_id = input.project_id.clone();
    let retry = input.retry.unwrap_or(true);
    let env_result = tauri::async_runtime::spawn_blocking(move || {
        let project_root =
            storage::load_project_root(&state_snapshot.db_path, &project_id).map_err(|error| {
                state_snapshot.log(
                    "ERROR",
                    &format!(
                        "terminal_activate_research_env.failed: project={}, stage=project, diagnostics={error}",
                        project_id
                    ),
                );
                public_failure_code("terminal.failure.env_unavailable", "project", false)
            })?;
        ensure_analysis_env_with_progress_blocking(
            &state_snapshot.db_path,
            &state_snapshot.runtime_root,
            &state_snapshot.app_data_dir,
            &project_id,
            &project_root,
            retry,
            |_percent, _stage, _current_item| {},
        )
        .map_err(|error| {
            state_snapshot.log(
                "ERROR",
                &format!(
                    "terminal_activate_research_env.failed: project={}, stage=environment, diagnostics={error}",
                    project_id
                ),
            );
            public_failure_code("terminal.failure.env_prepare_failed", "environment", true)
        })
    })
    .await
    .map_err(|_| {
        public_failure_code(
            "terminal.failure.env_prepare_interrupted",
            "environment",
            true,
        )
    })??;
    let venv_path = PathBuf::from(&env_result.venv_path);
    if !venv_path.is_dir() {
        return Err(public_failure_code(
            "terminal.failure.env_unavailable",
            "environment",
            true,
        ));
    }
    let session = state
        .terminal_sessions
        .lock()
        .map_err(|_| {
            public_failure_code("terminal.failure.registry_unavailable", "activate", true)
        })?
        .get(&input.session_id)
        .cloned()
        .ok_or_else(|| public_failure_code("terminal.failure.session_missing", "activate", true))?;
    let command = terminal_activation_command(&session.shell, &venv_path);
    {
        let mut writer = session
            .writer
            .lock()
            .map_err(|_| public_failure_code("terminal.failure.write_failed", "activate", true))?;
        writer.write_all(command.as_bytes()).map_err(|error| {
            state.log(
                "ERROR",
                &format!(
                    "terminal_activate_research_env.failed: session={}, stage=inject, diagnostics={error}",
                    input.session_id
                ),
            );
            public_failure_code("terminal.failure.write_failed", "inject", true)
        })?;
        writer.flush().map_err(|error| {
            state.log(
                "ERROR",
                &format!(
                    "terminal_activate_research_env.failed: session={}, stage=flush, diagnostics={error}",
                    input.session_id
                ),
            );
            public_failure_code("terminal.failure.write_failed", "inject", true)
        })?;
    }
    let venv_text = runtime_path_text(&venv_path);
    if let Ok(mut stored_path) = session.venv_path.lock() {
        *stored_path = Some(venv_text.clone());
    }
    if let Ok(mut source) = session.env_source.lock() {
        *source = Some("analysis".to_string());
    }
    if let Ok(mut status) = session.status.lock() {
        *status = TerminalStatus::Running;
    }
    if let Ok(mut failure) = session.failure.lock() {
        *failure = None;
    }
    state.log(
        "INFO",
        &format!(
            "terminal_activate_research_env: project={}, session={}, source=analysis",
            input.project_id, input.session_id
        ),
    );
    Ok(TerminalActivateResponse {
        session_id: input.session_id,
        venv_path: venv_text,
        env_source: "analysis".to_string(),
        status: TerminalStatus::Running,
    })
}
