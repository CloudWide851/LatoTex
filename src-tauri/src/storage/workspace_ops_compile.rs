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

pub fn fs_operation(db_path: &Path, input: FsOperationInput) -> Result<FsOperationResult, String> {
    let project_root = load_project_root(db_path, &input.project_id)?;
    let scope = input.scope.trim().to_string();
    let root = scope_root(&project_root, &scope)?;
    let path = safe_join(&root, &input.path)?;
    let is_library_bib = scope == "library" && is_library_bib_relative_path(&input.path);
    let companion_pdf_path = if is_library_bib {
        Some(sibling_library_pdf_path(&path))
    } else {
        None
    };
    let annotation_path = if is_library_bib {
        Some(safe_join(
            &root,
            &to_library_annotation_relative_path(&input.path),
        )?)
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
            let target_relative = input
                .target_path
                .ok_or_else(|| "targetPath is required".to_string())?;
            let target = safe_join(&root, &target_relative)?;
            move_recursively(&path, &target)?;
            if let Some(companion) = companion_pdf_path.as_ref() {
                if companion.exists() && companion.is_file() {
                    move_recursively(companion, &sibling_library_pdf_path(&target))?;
                }
            }
            if let Some(annotation_source) = annotation_path.as_ref() {
                if annotation_source.exists() && annotation_source.is_file() {
                    let annotation_target = safe_join(
                        &root,
                        &to_library_annotation_relative_path(&target_relative),
                    )?;
                    move_recursively(annotation_source, &annotation_target)?;
                }
            }
        }
        "copy" => {
            let target_relative = input
                .target_path
                .ok_or_else(|| "targetPath is required".to_string())?;
            let target = safe_join(&root, &target_relative)?;
            copy_recursively(&path, &target)?;
            if let Some(companion) = companion_pdf_path.as_ref() {
                if companion.exists() && companion.is_file() {
                    copy_recursively(companion, &sibling_library_pdf_path(&target))?;
                }
            }
            if let Some(annotation_source) = annotation_path.as_ref() {
                if annotation_source.exists() && annotation_source.is_file() {
                    let annotation_target = safe_join(
                        &root,
                        &to_library_annotation_relative_path(&target_relative),
                    )?;
                    copy_recursively(annotation_source, &annotation_target)?;
                }
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
            if let Some(annotation_source) = annotation_path.as_ref() {
                if annotation_source.exists() {
                    trash::delete(annotation_source).map_err(|e| e.to_string())?;
                }
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

#[cfg(test)]
mod workspace_ops_compile_tests {
    use super::{fs_operation, to_library_annotation_relative_path};
    use crate::models::FsOperationInput;
    use crate::storage;
    use std::fs;
    use std::path::PathBuf;

    fn unique_temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "latotex-workspace-op-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn create_project_fixture(name: &str) -> (PathBuf, String, PathBuf, PathBuf) {
        let temp_root = unique_temp_dir(name);
        let runtime_root = temp_root.join("runtime");
        let projects_dir = runtime_root.join("projects");
        let db_path = runtime_root.join("latotex.db");

        fs::create_dir_all(&projects_dir).unwrap();
        storage::initialize_database(&db_path).unwrap();
        let snapshot = storage::create_project(&db_path, &projects_dir, "Workspace Op Test").unwrap();
        let project_id = snapshot.summary.id;
        let project_root = PathBuf::from(snapshot.summary.root_path);
        (temp_root, project_id, project_root, db_path)
    }

    #[test]
    fn library_bib_rename_moves_companion_pdf_and_annotation() {
        let (temp_root, project_id, project_root, db_path) = create_project_fixture("library-bundle");
        let papers_root = project_root.join(".latotex").join("papers");
        fs::create_dir_all(&papers_root).unwrap();

        let source_bib = papers_root.join("demo.bib");
        let source_pdf = papers_root.join("demo.pdf");
        fs::write(&source_bib, "@article{demo}").unwrap();
        fs::write(&source_pdf, b"%PDF-demo").unwrap();

        let annotation_relative = to_library_annotation_relative_path("demo.bib");
        let annotation_path = papers_root.join(annotation_relative.replace('/', "\\"));
        fs::create_dir_all(annotation_path.parent().unwrap()).unwrap();
        fs::write(&annotation_path, "{\"version\":4}").unwrap();

        fs_operation(
            &db_path,
            FsOperationInput {
                project_id: project_id.clone(),
                scope: "library".to_string(),
                action: "rename".to_string(),
                path: "demo.bib".to_string(),
                target_path: Some("grouped/demo-renamed.bib".to_string()),
                content: None,
            },
        )
        .unwrap();

        assert!(papers_root.join("grouped").join("demo-renamed.bib").exists());
        assert!(papers_root.join("grouped").join("demo-renamed.pdf").exists());
        let next_annotation = papers_root.join(
            to_library_annotation_relative_path("grouped/demo-renamed.bib").replace('/', "\\"),
        );
        assert!(next_annotation.exists());
        assert!(!source_bib.exists());
        assert!(!source_pdf.exists());
        assert!(!annotation_path.exists());

        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn library_bib_delete_removes_companion_pdf_and_annotation() {
        let (temp_root, project_id, project_root, db_path) = create_project_fixture("library-bundle-delete");
        let papers_root = project_root.join(".latotex").join("papers");
        fs::create_dir_all(&papers_root).unwrap();

        let source_bib = papers_root.join("demo.bib");
        let source_pdf = papers_root.join("demo.pdf");
        fs::write(&source_bib, "@article{demo}").unwrap();
        fs::write(&source_pdf, b"%PDF-demo").unwrap();

        let annotation_relative = to_library_annotation_relative_path("demo.bib");
        let annotation_path = papers_root.join(annotation_relative.replace('/', "\\"));
        fs::create_dir_all(annotation_path.parent().unwrap()).unwrap();
        fs::write(&annotation_path, "{\"version\":4}").unwrap();

        fs_operation(
            &db_path,
            FsOperationInput {
                project_id,
                scope: "library".to_string(),
                action: "delete".to_string(),
                path: "demo.bib".to_string(),
                target_path: None,
                content: None,
            },
        )
        .unwrap();

        assert!(!source_bib.exists());
        assert!(!source_pdf.exists());
        assert!(!annotation_path.exists());

        let _ = fs::remove_dir_all(temp_root);
    }
}

