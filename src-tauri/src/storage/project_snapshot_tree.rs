pub fn initialize_project_from_folder(
    db_path: &Path,
    folder_path: &Path,
) -> Result<ProjectSnapshot, String> {
    if !folder_path.exists() || !folder_path.is_dir() {
        return Err("Selected folder is not accessible".to_string());
    }

    let canonical_root = folder_path.canonicalize().map_err(|e| e.to_string())?;
    ensure_workspace_bootstrap_files(&canonical_root)?;
    let root_str = canonical_root.to_string_lossy().to_string();
    let folder_name = canonical_root
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "Workspace".to_string());

    let now = now_iso();
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let existing_id: Result<String, _> = conn.query_row(
        "SELECT id FROM projects WHERE root_path = ?1",
        params![root_str],
        |row| row.get(0),
    );

    let project_id = match existing_id {
        Ok(id) => {
            conn.execute(
                "UPDATE projects SET name = ?1, updated_at = ?2 WHERE id = ?3",
                params![folder_name, now, id],
            )
            .map_err(|e| e.to_string())?;
            id
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            let new_id = Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO projects (id, name, root_path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![new_id, folder_name, root_str, now, now],
            )
            .map_err(|e| e.to_string())?;
            new_id
        }
        Err(error) => return Err(error.to_string()),
    };

    conn.execute(
        "UPDATE app_settings SET active_project_id = ?1 WHERE id = 1",
        params![project_id],
    )
    .map_err(|e| e.to_string())?;

    project_snapshot(db_path, &project_id)
}

fn ensure_workspace_bootstrap_files(root: &Path) -> Result<(), String> {
    let latotex_dir = root.join(".latotex");
    fs::create_dir_all(&latotex_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(library_root(root)).map_err(|e| e.to_string())?;
    fs::create_dir_all(latotex_dir.join("index")).map_err(|e| e.to_string())?;

    let config_path = latotex_dir.join("config.json");
    if !config_path.exists() {
        let config = json!({
            "version": 1,
            "createdAt": now_iso(),
            "workspace": root
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| "Workspace".to_string())
        });
        fs::write(
            config_path,
            serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }

    let permissions_path = latotex_dir.join("permissions.json");
    if !permissions_path.exists() {
        let permissions = json!({
            "allowAgentWrite": true,
            "allowAgentRead": true,
            "allowShellExec": false
        });
        fs::write(
            permissions_path,
            serde_json::to_string_pretty(&permissions).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }

    let main_path = root.join("main.tex");
    if !main_path.exists() {
        let content = r#"% !TeX program = xelatex
% !TeX encoding = UTF-8 Unicode
% LatoTex starter template
\documentclass[11pt,a4paper]{article}
\usepackage{amsmath,amssymb}
\usepackage{booktabs}
\usepackage{hyperref}
\usepackage{xcolor}

\title{LatoTex Quick Start}
\author{LatoTex User}
\date{\today}

\begin{document}
\maketitle

\section{Welcome to LatoTex}
LatoTex provides \textbf{agent-assisted writing} and \textbf{native LaTeX compilation}.

\subsection{Equation example}
\begin{equation}
  \int_0^1 x^2\,dx = \frac{1}{3}
\end{equation}

\subsection{Table example}
\begin{table}[h]
  \centering
  \begin{tabular}{lcc}
    \toprule
    Metric & Value A & Value B \\
    \midrule
    Sample 1 & 12.3 & 45.6 \\
    Sample 2 & 78.9 & 10.1 \\
    \bottomrule
  \end{tabular}
  \caption{Default LatoTex template sample}
\end{table}

\subsection{Next steps}
Create new files from the explorer, then use the Agent panel to iterate on your document.

\end{document}
"#;
        fs::write(main_path, content).map_err(|e| e.to_string())?;
    }

    let readme_path = root.join("README.md");
    if !readme_path.exists() {
        let project_name = root
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "LatoTex Project".to_string());
        let content = format!(
            "# {project_name}\n\nManaged by LatoTex.\n\n## Structure\n\n- `main.tex`: default LaTeX entry file\n- `.latotex/`: workspace metadata\n"
        );
        fs::write(readme_path, content).map_err(|e| e.to_string())?;
    }

    let gitignore_path = root.join(".gitignore");
    if !gitignore_path.exists() {
        let content = [
            "# Build outputs",
            "dist/",
            "build/",
            "",
            "# Dependencies",
            "node_modules/",
            "",
            "# LatoTex cache/index",
            ".latotex/index/",
            "",
            "# Logs",
            "*.log",
        ]
        .join("\n");
        fs::write(gitignore_path, format!("{content}\n")).map_err(|e| e.to_string())?;
    }

    let editorconfig_path = root.join(".editorconfig");
    if !editorconfig_path.exists() {
        let content = [
            "root = true",
            "",
            "[*]",
            "charset = utf-8",
            "end_of_line = lf",
            "insert_final_newline = true",
            "indent_style = space",
            "indent_size = 2",
        ]
        .join("\n");
        fs::write(editorconfig_path, format!("{content}\n")).map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn collect_missing_required_paths(root: &Path) -> Vec<String> {
    let required = [
        ".latotex",
        ".latotex/config.json",
        ".latotex/permissions.json",
        ".latotex/index",
        ".editorconfig",
    ];
    required
        .iter()
        .filter_map(|relative| {
            let path = root.join(relative);
            if path.exists() {
                None
            } else {
                Some((*relative).to_string())
            }
        })
        .collect()
}

pub fn project_integrity_status(
    db_path: &Path,
    project_id: &str,
) -> Result<ProjectIntegrityStatus, String> {
    let root = load_project_root(db_path, project_id)?;
    Ok(ProjectIntegrityStatus {
        project_id: project_id.to_string(),
        missing_required: collect_missing_required_paths(&root),
    })
}

pub fn repair_project_integrity(
    db_path: &Path,
    project_id: &str,
) -> Result<ProjectIntegrityStatus, String> {
    let root = load_project_root(db_path, project_id)?;
    ensure_workspace_bootstrap_files(&root)?;
    Ok(ProjectIntegrityStatus {
        project_id: project_id.to_string(),
        missing_required: collect_missing_required_paths(&root),
    })
}

fn library_root(project_root: &Path) -> PathBuf {
    project_root.join(".latotex").join("papers")
}

fn workspace_index_path(project_root: &Path) -> PathBuf {
    project_root
        .join(".latotex")
        .join("index")
        .join("workspace-index.json")
}

fn library_index_path(project_root: &Path) -> PathBuf {
    project_root
        .join(".latotex")
        .join("index")
        .join("papers-index.json")
}

fn collect_file_index_entries(root: &Path, base: &Path, entries: &mut Vec<Value>) -> Result<(), String> {
    if !base.exists() {
        return Ok(());
    }
    for item in fs::read_dir(base).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let path = item.path();
        let name = item.file_name().to_string_lossy().to_string();
        if name == ".git" {
            continue;
        }

        let rel = path
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
        let modified = metadata
            .modified()
            .ok()
            .and_then(|ts| ts.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        entries.push(json!({
            "relativePath": rel,
            "name": name,
            "kind": if metadata.is_dir() { "directory" } else { "file" },
            "size": metadata.len(),
            "modifiedEpochSec": modified
        }));

        if metadata.is_dir() {
            collect_file_index_entries(root, &path, entries)?;
        }
    }
    Ok(())
}

fn refresh_workspace_index(project_root: &Path) -> Result<(), String> {
    let mut entries = Vec::new();
    collect_file_index_entries(project_root, project_root, &mut entries)?;
    let payload = json!({
        "updatedAt": now_iso(),
        "entries": entries
    });
    let index_path = workspace_index_path(project_root);
    if let Some(parent) = index_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(
        index_path,
        serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    mark_search_index_dirty(project_root)?;
    Ok(())
}

fn refresh_library_index(project_root: &Path) -> Result<(), String> {
    let papers_root = library_root(project_root);
    fs::create_dir_all(&papers_root).map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    collect_file_index_entries(project_root, &papers_root, &mut entries)?;
    let payload = json!({
        "updatedAt": now_iso(),
        "root": ".latotex/papers",
        "entries": entries
    });
    let index_path = library_index_path(project_root);
    if let Some(parent) = index_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(
        index_path,
        serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    mark_search_index_dirty(project_root)?;
    Ok(())
}

pub fn list_projects(db_path: &Path) -> Result<Vec<ProjectSummary>, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, root_path, updated_at FROM projects ORDER BY updated_at DESC, created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ProjectSummary {
                id: row.get(0)?,
                name: row.get(1)?,
                root_path: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut projects = Vec::new();
    for row in rows {
        projects.push(row.map_err(|e| e.to_string())?);
    }
    Ok(projects)
}

fn next_project_id(conn: &Connection) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT id FROM projects ORDER BY updated_at DESC, created_at DESC LIMIT 1",
        [],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn delete_project(
    db_path: &Path,
    project_id: &str,
    mode: &str,
) -> Result<ProjectDeleteResponse, String> {
    let trimmed_id = project_id.trim();
    if trimmed_id.is_empty() {
        return Err("project.delete.invalid_id".to_string());
    }
    if !matches!(mode, "unregister" | "trashRoot") {
        return Err("project.delete.invalid_mode".to_string());
    }

    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let root_path: String = conn
        .query_row(
            "SELECT root_path FROM projects WHERE id = ?1",
            params![trimmed_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let mut trashed_root = false;
    if mode == "trashRoot" {
        let root = PathBuf::from(&root_path);
        if root.exists() {
            let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
            if canonical_root.parent().is_none() || !canonical_root.join(".latotex").is_dir() {
                return Err("project.delete.root_unsafe".to_string());
            }
            trash::delete(&root).map_err(|e| e.to_string())?;
            trashed_root = true;
        }
    }

    conn.execute("DELETE FROM projects WHERE id = ?1", params![trimmed_id])
        .map_err(|e| e.to_string())?;
    let active_project_id: Option<String> = conn
        .query_row(
            "SELECT active_project_id FROM app_settings WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();
    let next_active_project_id = if active_project_id.as_deref() == Some(trimmed_id) {
        let next = next_project_id(&conn)?;
        conn.execute(
            "UPDATE app_settings SET active_project_id = ?1 WHERE id = 1",
            params![next],
        )
        .map_err(|e| e.to_string())?;
        next
    } else {
        active_project_id
    };

    Ok(ProjectDeleteResponse {
        deleted_project_id: trimmed_id.to_string(),
        root_path,
        trashed_root,
        next_active_project_id,
    })
}

pub fn project_snapshot(db_path: &Path, project_id: &str) -> Result<ProjectSnapshot, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, root_path, updated_at FROM projects WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    let summary = stmt
        .query_row(params![project_id], |row| {
            Ok(ProjectSummary {
                id: row.get(0)?,
                name: row.get(1)?,
                root_path: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let root_path = PathBuf::from(&summary.root_path);
    ensure_workspace_bootstrap_files(&root_path)?;
    let tree = list_workspace_tree(&root_path)?;
    Ok(ProjectSnapshot {
        summary,
        tree,
        main_file: "main.tex".to_string(),
    })
}

pub fn list_workspace_tree(root_path: &Path) -> Result<Vec<ResourceNode>, String> {
    if !root_path.exists() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    let read_dir = fs::read_dir(root_path).map_err(|e| e.to_string())?;
    for entry in read_dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if !should_show_workspace_entry(&path, &name, path.is_dir()) {
            continue;
        }
        entries.push(build_resource_node(root_path, &path)?);
    }
    entries.sort_by_key(node_sort_key);
    Ok(entries)
}

#[cfg(test)]
mod project_delete_tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "latotex-project-delete-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn unregister_project_preserves_files_and_repoints_active_project() {
        let root = temp_root("unregister");
        let db_path = root.join("latotex.db");
        let projects_dir = root.join("projects");
        fs::create_dir_all(&projects_dir).unwrap();
        initialize_database(&db_path).unwrap();
        let first = create_project(&db_path, &projects_dir, "First").unwrap();
        let second = create_project(&db_path, &projects_dir, "Second").unwrap();
        let second_root = PathBuf::from(&second.summary.root_path);

        let deleted = delete_project(&db_path, &second.summary.id, "unregister").unwrap();

        assert_eq!(deleted.deleted_project_id, second.summary.id);
        assert!(!deleted.trashed_root);
        assert!(second_root.exists());
        assert_eq!(deleted.next_active_project_id.as_deref(), Some(first.summary.id.as_str()));
        let projects = list_projects(&db_path).unwrap();
        assert!(!projects.iter().any(|project| project.id == second.summary.id));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn trash_missing_project_root_removes_registration_without_file_delete() {
        let root = temp_root("missing-trash");
        let db_path = root.join("latotex.db");
        let projects_dir = root.join("projects");
        let missing_root = root.join("already-gone");
        fs::create_dir_all(&projects_dir).unwrap();
        initialize_database(&db_path).unwrap();
        let conn = Connection::open(&db_path).unwrap();
        conn.execute(
            "INSERT INTO projects (id, name, root_path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["missing-project", "Missing", missing_root.to_string_lossy().to_string(), now_iso(), now_iso()],
        )
        .unwrap();
        conn.execute(
            "UPDATE app_settings SET active_project_id = ?1 WHERE id = 1",
            params!["missing-project"],
        )
        .unwrap();

        let deleted = delete_project(&db_path, "missing-project", "trashRoot").unwrap();

        assert_eq!(deleted.deleted_project_id, "missing-project");
        assert!(!deleted.trashed_root);
        assert!(deleted.next_active_project_id.is_none());
        let projects = list_projects(&db_path).unwrap();
        assert!(projects.is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn trash_project_rejects_root_without_latotex_marker() {
        let root = temp_root("unsafe-trash");
        let db_path = root.join("latotex.db");
        let unsafe_root = root.join("plain-folder");
        fs::create_dir_all(&unsafe_root).unwrap();
        initialize_database(&db_path).unwrap();
        let conn = Connection::open(&db_path).unwrap();
        conn.execute(
            "INSERT INTO projects (id, name, root_path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["unsafe-project", "Unsafe", unsafe_root.to_string_lossy().to_string(), now_iso(), now_iso()],
        )
        .unwrap();

        let error = delete_project(&db_path, "unsafe-project", "trashRoot").unwrap_err();

        assert_eq!(error, "project.delete.root_unsafe");
        assert!(unsafe_root.exists());
        let projects = list_projects(&db_path).unwrap();
        assert_eq!(projects.len(), 1);
        let _ = fs::remove_dir_all(root);
    }
}


