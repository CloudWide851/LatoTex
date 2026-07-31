#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KnowledgePreferenceSnapshot {
    pub background_index_enabled: bool,
    pub semantic_model_reminder_enabled: bool,
}

impl Default for KnowledgePreferenceSnapshot {
    fn default() -> Self {
        Self {
            background_index_enabled: true,
            semantic_model_reminder_enabled: true,
        }
    }
}

pub fn knowledge_preference_snapshot(
    db_path: &Path,
) -> Result<KnowledgePreferenceSnapshot, String> {
    let conn =
        Connection::open(db_path).map_err(|_| "knowledge.settings.unavailable".to_string())?;
    let raw = conn
        .query_row(
            "SELECT ui_prefs_json FROM app_settings WHERE id = 1",
            [],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|_| "knowledge.settings.unavailable".to_string())?
        .flatten();
    let prefs = raw
        .as_deref()
        .and_then(|value| serde_json::from_str::<UiPrefs>(value).ok());
    Ok(KnowledgePreferenceSnapshot {
        background_index_enabled: prefs
            .as_ref()
            .and_then(|value| value.knowledge_background_index_enabled)
            .unwrap_or(true),
        semantic_model_reminder_enabled: prefs
            .as_ref()
            .and_then(|value| value.knowledge_semantic_model_reminder_enabled)
            .unwrap_or(true),
    })
}

#[cfg(test)]
mod knowledge_preference_tests {
    use super::*;

    fn create_test_database(label: &str) -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "latotex-knowledge-preferences-{label}-{}",
            Uuid::new_v4()
        ));
        fs::create_dir_all(&root).expect("create temp root");
        let db_path = root.join("latotex.sqlite3");
        initialize_database(&db_path).expect("initialize database");
        (root, db_path)
    }

    #[test]
    fn defaults_enable_background_index_and_semantic_reminder() {
        let (root, db_path) = create_test_database("defaults");

        assert_eq!(
            knowledge_preference_snapshot(&db_path).expect("load preferences"),
            KnowledgePreferenceSnapshot::default()
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn persisted_knowledge_preferences_control_automatic_work() {
        let (root, db_path) = create_test_database("persisted");
        let conn = Connection::open(&db_path).expect("open database");
        conn.execute(
            "UPDATE app_settings SET ui_prefs_json = ?1 WHERE id = 1",
            params![serde_json::json!({
                "knowledgeBackgroundIndexEnabled": false,
                "knowledgeSemanticModelReminderEnabled": false
            })
            .to_string()],
        )
        .expect("persist preferences");

        assert_eq!(
            knowledge_preference_snapshot(&db_path).expect("load preferences"),
            KnowledgePreferenceSnapshot {
                background_index_enabled: false,
                semantic_model_reminder_enabled: false,
            }
        );
        drop(conn);
        let _ = fs::remove_dir_all(root);
    }
}
