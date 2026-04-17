fn copy_recursively(source: &Path, target: &Path) -> Result<(), String> {
    if source.is_dir() {
        fs::create_dir_all(target).map_err(|e| e.to_string())?;
        for item in fs::read_dir(source).map_err(|e| e.to_string())? {
            let item = item.map_err(|e| e.to_string())?;
            let from = item.path();
            let to = target.join(item.file_name());
            copy_recursively(&from, &to)?;
        }
        return Ok(());
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(source, target).map_err(|e| e.to_string())?;
    Ok(())
}
fn move_recursively(source: &Path, target: &Path) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    match fs::rename(source, target) {
        Ok(_) => Ok(()),
        Err(error) => {
            if error.kind() == io::ErrorKind::CrossesDevices {
                copy_recursively(source, target)?;
                if source.is_dir() {
                    fs::remove_dir_all(source).map_err(|e| e.to_string())?;
                } else {
                    fs::remove_file(source).map_err(|e| e.to_string())?;
                }
                Ok(())
            } else {
                Err(error.to_string())
            }
        }
    }
}

fn scope_root(project_root: &Path, scope: &str) -> Result<PathBuf, String> {
    match scope {
        "workspace" => Ok(project_root.to_path_buf()),
        "library" => {
            let root = library_root(project_root);
            fs::create_dir_all(&root).map_err(|e| e.to_string())?;
            Ok(root)
        }
        _ => Err("Unsupported scope".to_string()),
    }
}

fn is_library_bib_relative_path(relative_path: &str) -> bool {
    Path::new(relative_path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("bib"))
        .unwrap_or(false)
}

fn sibling_library_pdf_path(bib_path: &Path) -> PathBuf {
    bib_path.with_extension("pdf")
}

fn to_library_annotation_relative_path(relative_path: &str) -> String {
    let normalized = relative_path.trim().to_lowercase();
    let mut safe = String::new();
    let mut last_was_underscore = false;
    for ch in normalized.chars() {
        let normalized_ch = if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
            ch
        } else {
            '_'
        };
        if normalized_ch == '_' {
            if last_was_underscore {
                continue;
            }
            last_was_underscore = true;
            safe.push('_');
        } else {
            last_was_underscore = false;
            safe.push(normalized_ch);
        }
    }
    let safe = safe.trim_matches('_');
    let safe = if safe.is_empty() { "library" } else { safe };

    let mut hash = 2166136261_u32;
    for byte in normalized.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(16777619);
    }
    format!(
        ".annotations/{}-{:08x}.json",
        safe.chars().take(96).collect::<String>(),
        hash
    )
}

#[derive(Debug, Clone)]
struct LibraryBibMetadataTransfer {
    source_relative: String,
    target_relative: Option<String>,
}

fn normalize_relative_path(relative_path: &str) -> String {
    relative_path.trim().replace('\\', "/").trim_matches('/').to_string()
}

fn join_relative_path(base: &str, suffix: &str) -> String {
    let normalized_base = normalize_relative_path(base);
    let normalized_suffix = normalize_relative_path(suffix);
    if normalized_base.is_empty() {
        normalized_suffix
    } else if normalized_suffix.is_empty() {
        normalized_base
    } else {
        format!("{normalized_base}/{normalized_suffix}")
    }
}

fn collect_library_bib_relative_paths(
    source_path: &Path,
    source_relative: &str,
) -> Result<Vec<String>, String> {
    let normalized_source = normalize_relative_path(source_relative);
    if normalized_source.is_empty() || !source_path.exists() {
        return Ok(Vec::new());
    }
    if source_path.is_file() {
        return Ok(if is_library_bib_relative_path(&normalized_source) {
            vec![normalized_source]
        } else {
            Vec::new()
        });
    }

    let mut pending = vec![(source_path.to_path_buf(), normalized_source.clone())];
    let mut collected = Vec::new();
    while let Some((current_path, current_relative)) = pending.pop() {
        for entry in fs::read_dir(&current_path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let entry_path = entry.path();
            let entry_name = entry.file_name().to_string_lossy().to_string();
            let entry_relative = join_relative_path(&current_relative, &entry_name);
            if entry_path.is_dir() {
                pending.push((entry_path, entry_relative));
                continue;
            }
            if is_library_bib_relative_path(&entry_relative) {
                collected.push(entry_relative);
            }
        }
    }
    collected.sort();
    Ok(collected)
}

fn collect_library_bib_metadata_transfers(
    source_path: &Path,
    source_relative: &str,
    target_relative: Option<&str>,
) -> Result<Vec<LibraryBibMetadataTransfer>, String> {
    let normalized_source = normalize_relative_path(source_relative);
    let normalized_target = target_relative.map(normalize_relative_path);
    let bib_paths = collect_library_bib_relative_paths(source_path, &normalized_source)?;

    let mut transfers = Vec::with_capacity(bib_paths.len());
    for bib_relative in bib_paths {
        let target_bib_relative = normalized_target.as_ref().and_then(|target_root| {
            if normalized_source == bib_relative {
                return Some(target_root.clone());
            }
            let suffix = Path::new(&bib_relative)
                .strip_prefix(Path::new(&normalized_source))
                .ok()?
                .to_string_lossy()
                .replace('\\', "/");
            Some(join_relative_path(target_root, &suffix))
        });
        transfers.push(LibraryBibMetadataTransfer {
            source_relative: bib_relative,
            target_relative: target_bib_relative,
        });
    }
    Ok(transfers)
}

fn apply_library_bib_metadata_transfer(
    papers_root: &Path,
    transfer: &LibraryBibMetadataTransfer,
    action: &str,
) -> Result<(), String> {
    let annotation_source = safe_join(
        papers_root,
        &to_library_annotation_relative_path(&transfer.source_relative),
    )?;
    let binding_source =
        remote_pdf_cache_binding_path_for_relative_path(papers_root, &transfer.source_relative)?;
    let annotation_target = transfer.target_relative.as_ref().map(|target_relative| {
        safe_join(
            papers_root,
            &to_library_annotation_relative_path(target_relative),
        )
    }).transpose()?;
    let binding_target = transfer.target_relative.as_ref().map(|target_relative| {
        remote_pdf_cache_binding_path_for_relative_path(papers_root, target_relative)
    }).transpose()?;

    match action {
        "rename" | "move" => {
            if let Some(annotation_target) = annotation_target.as_ref() {
                if annotation_source.exists() && annotation_source.is_file() {
                    move_recursively(&annotation_source, annotation_target)?;
                }
            }
            if let Some(binding_target) = binding_target.as_ref() {
                if binding_source.exists() && binding_source.is_file() {
                    move_recursively(&binding_source, binding_target)?;
                }
            }
        }
        "copy" => {
            if let Some(annotation_target) = annotation_target.as_ref() {
                if annotation_source.exists() && annotation_source.is_file() {
                    copy_recursively(&annotation_source, annotation_target)?;
                }
            }
            if let Some(binding_target) = binding_target.as_ref() {
                if binding_source.exists() && binding_source.is_file() {
                    copy_recursively(&binding_source, binding_target)?;
                }
            }
        }
        "delete" => {
            if annotation_source.exists() {
                trash::delete(&annotation_source).map_err(|e| e.to_string())?;
            }
            if binding_source.exists() {
                trash::delete(&binding_source).map_err(|e| e.to_string())?;
            }
        }
        _ => {}
    }

    Ok(())
}

pub fn fs_operation(db_path: &Path, input: FsOperationInput) -> Result<FsOperationResult, String> {
    let project_root = load_project_root(db_path, &input.project_id)?;
    let scope = input.scope.trim().to_string();
    let root = scope_root(&project_root, &scope)?;
    let path = safe_join(&root, &input.path)?;
    let target_relative = input.target_path.clone();
    let is_library_bib = scope == "library" && is_library_bib_relative_path(&input.path);
    let library_bib_metadata_transfers = if scope == "library" {
        collect_library_bib_metadata_transfers(&path, &input.path, target_relative.as_deref())?
    } else {
        Vec::new()
    };
    let companion_pdf_path = if is_library_bib {
        Some(sibling_library_pdf_path(&path))
    } else {
        None
    };

    match input.action.as_str() {
        "create_file" => {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::write(&path, input.content.unwrap_or_default()).map_err(|e| e.to_string())?;
        }
        "create_folder" => {
            fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        }
        "rename" | "move" => {
            let target_relative = target_relative
                .ok_or_else(|| "targetPath is required".to_string())?;
            let target = safe_join(&root, &target_relative)?;
            move_recursively(&path, &target)?;
            if let Some(companion) = companion_pdf_path.as_ref() {
                if companion.exists() && companion.is_file() {
                    move_recursively(companion, &sibling_library_pdf_path(&target))?;
                }
            }
            for transfer in &library_bib_metadata_transfers {
                apply_library_bib_metadata_transfer(&root, transfer, input.action.as_str())?;
            }
        }
        "copy" => {
            let target_relative = target_relative
                .ok_or_else(|| "targetPath is required".to_string())?;
            let target = safe_join(&root, &target_relative)?;
            copy_recursively(&path, &target)?;
            if let Some(companion) = companion_pdf_path.as_ref() {
                if companion.exists() && companion.is_file() {
                    copy_recursively(companion, &sibling_library_pdf_path(&target))?;
                }
            }
            for transfer in &library_bib_metadata_transfers {
                apply_library_bib_metadata_transfer(&root, transfer, input.action.as_str())?;
            }
        }
        "delete" => {
            if path.exists() {
                trash::delete(&path).map_err(|e| e.to_string())?;
            }
            if let Some(companion) = companion_pdf_path.as_ref() {
                if companion.exists() {
                    trash::delete(companion).map_err(|e| e.to_string())?;
                }
            }
            for transfer in &library_bib_metadata_transfers {
                apply_library_bib_metadata_transfer(&root, transfer, input.action.as_str())?;
            }
        }
        _ => return Err("Unsupported file action".to_string()),
    }

    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE projects SET updated_at = ?1 WHERE id = ?2",
        params![now_iso(), input.project_id],
    )
    .map_err(|e| e.to_string())?;

    match scope.as_str() {
        "workspace" => refresh_workspace_index(&project_root)?,
        "library" => refresh_library_index(&project_root)?,
        _ => {}
    }

    Ok(FsOperationResult {
        ok: true,
        message: "Operation completed".to_string(),
    })
}
pub fn record_compile(db_path: &Path, input: CompileRecordInput) -> Result<CompileRecord, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let record_id = Uuid::new_v4().to_string();
    let now = now_iso();
    let diagnostics_json = serde_json::to_string(&input.diagnostics).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO compile_jobs (id, project_id, main_file, status, diagnostics, duration_ms, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            record_id,
            input.project_id,
            input.main_file,
            input.status,
            diagnostics_json,
            input.duration_ms as i64,
            now
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(CompileRecord {
        id: record_id,
        project_id: input.project_id,
        main_file: input.main_file,
        status: input.status,
        diagnostics: input.diagnostics,
        duration_ms: input.duration_ms,
        created_at: now,
    })
}
