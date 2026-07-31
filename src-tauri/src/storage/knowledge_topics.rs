fn normalize_knowledge_topic_label(label: &str) -> Result<(String, String), String> {
    let label = label.split_whitespace().collect::<Vec<_>>().join(" ");
    if !(2..=120).contains(&label.chars().count())
        || label.chars().any(|character| character.is_control())
    {
        return Err("knowledge.topic.label_invalid".to_string());
    }
    Ok((label.clone(), label.to_lowercase()))
}

fn knowledge_topic_id(normalized_label: &str) -> String {
    format!(
        "topic:{}",
        &knowledge_hex_sha256(normalized_label.as_bytes())[..16]
    )
}

fn knowledge_auto_topic_labels(chunks: &[KnowledgeChunkDraft]) -> Vec<String> {
    let mut labels = std::collections::BTreeMap::<String, String>::new();
    let tag_pattern =
        regex::Regex::new(r"(?m)(?:^|\s)#([\p{L}\p{N}_-]{2,64})").expect("topic regex");
    for chunk in chunks {
        if let Some(heading) = chunk.anchor.heading.as_deref() {
            if let Ok((label, normalized)) = normalize_knowledge_topic_label(heading) {
                labels.entry(normalized).or_insert(label);
            }
        }
        for capture in tag_pattern.captures_iter(&chunk.text) {
            let Some(value) = capture.get(1) else {
                continue;
            };
            if let Ok((label, normalized)) = normalize_knowledge_topic_label(value.as_str()) {
                labels.entry(normalized).or_insert(label);
            }
        }
    }
    labels.into_values().take(64).collect()
}

fn replace_knowledge_auto_topics(
    conn: &Connection,
    item_id: &str,
    chunks: &[KnowledgeChunkDraft],
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM knowledge_topic_links WHERE item_id = ?1 AND source = 'auto'",
        params![item_id],
    )
    .map_err(|_| "knowledge.topic.failed".to_string())?;
    for label in knowledge_auto_topic_labels(chunks) {
        let (label, normalized) = normalize_knowledge_topic_label(&label)?;
        let topic_id = knowledge_topic_id(&normalized);
        conn.execute(
            "INSERT INTO knowledge_topics
             (topic_id, label, normalized_label, source, confidence, hidden, manual, updated_at)
             VALUES (?1, ?2, ?3, 'auto', 0.75, 0, 0, ?4)
             ON CONFLICT(normalized_label) DO UPDATE SET
               confidence = max(knowledge_topics.confidence, excluded.confidence),
               updated_at = excluded.updated_at",
            params![topic_id, label, normalized, now_iso()],
        )
        .map_err(|_| "knowledge.topic.failed".to_string())?;
        conn.execute(
            "INSERT INTO knowledge_topic_links (item_id, topic_id, confidence, source)
             VALUES (?1, ?2, 0.75, 'auto')
             ON CONFLICT(item_id, topic_id) DO UPDATE SET
               confidence=max(knowledge_topic_links.confidence, excluded.confidence)",
            params![item_id, topic_id],
        )
        .map_err(|_| "knowledge.topic.failed".to_string())?;
    }
    conn.execute(
        "DELETE FROM knowledge_topics
         WHERE manual = 0
           AND topic_id NOT IN (SELECT topic_id FROM knowledge_topic_links)",
        [],
    )
    .map_err(|_| "knowledge.topic.failed".to_string())?;
    Ok(())
}

fn remove_knowledge_topic_links(conn: &Connection, item_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM knowledge_topic_links WHERE item_id = ?1",
        params![item_id],
    )
    .map_err(|_| "knowledge.topic.failed".to_string())?;
    conn.execute(
        "DELETE FROM knowledge_topics
         WHERE manual = 0
           AND topic_id NOT IN (SELECT topic_id FROM knowledge_topic_links)",
        [],
    )
    .map_err(|_| "knowledge.topic.failed".to_string())?;
    Ok(())
}

pub fn list_knowledge_topics(
    db_path: &Path,
    input: &crate::models::KnowledgeTopicListInput,
) -> Result<Vec<crate::models::KnowledgeTopic>, String> {
    let project_root = load_project_root(db_path, &input.project_id)?;
    let conn = open_knowledge_index(&project_root)?;
    let mut stmt = conn
        .prepare(
            "SELECT t.topic_id, t.label, t.source, t.confidence, t.hidden, t.manual,
                    count(l.item_id)
             FROM knowledge_topics t
             LEFT JOIN knowledge_topic_links l ON l.topic_id = t.topic_id
             GROUP BY t.topic_id
             ORDER BY t.hidden, t.manual DESC, t.label COLLATE NOCASE",
        )
        .map_err(|_| "knowledge.topic.failed".to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(crate::models::KnowledgeTopic {
                topic_id: row.get(0)?,
                label: row.get(1)?,
                source: row.get(2)?,
                confidence: row.get(3)?,
                hidden: row.get::<_, i64>(4)? != 0,
                manual: row.get::<_, i64>(5)? != 0,
                link_count: row.get::<_, i64>(6)?.max(0) as u32,
            })
        })
        .map_err(|_| "knowledge.topic.failed".to_string())?;
    rows.map(|row| row.map_err(|_| "knowledge.topic.failed".to_string()))
        .collect()
}

pub fn mutate_knowledge_topic(
    db_path: &Path,
    input: &crate::models::KnowledgeTopicMutationInput,
) -> Result<Ack, String> {
    let project_root = load_project_root(db_path, &input.project_id)?;
    let mut conn = open_knowledge_index(&project_root)?;
    let exists = conn
        .query_row(
            "SELECT 1 FROM knowledge_topics WHERE topic_id = ?1",
            params![input.topic_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(|_| "knowledge.topic.failed".to_string())?
        .is_some();
    if !exists {
        return Err("knowledge.topic.not_found".to_string());
    }
    match input.action.as_str() {
        "rename" => {
            let (label, normalized) = normalize_knowledge_topic_label(
                input
                    .label
                    .as_deref()
                    .ok_or_else(|| "knowledge.topic.label_invalid".to_string())?,
            )?;
            conn.execute(
                "UPDATE knowledge_topics
                 SET label=?1, normalized_label=?2, source='manual', manual=1,
                     confidence=1.0, updated_at=?3
                 WHERE topic_id=?4",
                params![label, normalized, now_iso(), input.topic_id],
            )
            .map_err(|error| {
                if error.to_string().contains("UNIQUE") {
                    "knowledge.topic.duplicate".to_string()
                } else {
                    "knowledge.topic.failed".to_string()
                }
            })?;
        }
        "hide" | "unhide" => {
            conn.execute(
                "UPDATE knowledge_topics SET hidden=?1, updated_at=?2 WHERE topic_id=?3",
                params![i64::from(input.action == "hide"), now_iso(), input.topic_id],
            )
            .map_err(|_| "knowledge.topic.failed".to_string())?;
        }
        "promote" => {
            conn.execute(
                "UPDATE knowledge_topics
                 SET source='manual', manual=1, confidence=1.0, updated_at=?1
                 WHERE topic_id=?2",
                params![now_iso(), input.topic_id],
            )
            .map_err(|_| "knowledge.topic.failed".to_string())?;
        }
        "merge" => {
            let target = input
                .target_topic_id
                .as_deref()
                .filter(|target| *target != input.topic_id)
                .ok_or_else(|| "knowledge.topic.merge_invalid".to_string())?;
            let target_exists = conn
                .query_row(
                    "SELECT 1 FROM knowledge_topics WHERE topic_id=?1",
                    params![target],
                    |_| Ok(()),
                )
                .optional()
                .map_err(|_| "knowledge.topic.failed".to_string())?
                .is_some();
            if !target_exists {
                return Err("knowledge.topic.merge_invalid".to_string());
            }
            let tx = conn
                .transaction()
                .map_err(|_| "knowledge.topic.failed".to_string())?;
            tx.execute(
                "INSERT INTO knowledge_topic_links (item_id, topic_id, confidence, source)
                 SELECT item_id, ?1, confidence, 'manual'
                 FROM knowledge_topic_links WHERE topic_id=?2
                 ON CONFLICT(item_id, topic_id) DO UPDATE SET
                   confidence=max(knowledge_topic_links.confidence, excluded.confidence),
                   source='manual'",
                params![target, input.topic_id],
            )
            .map_err(|_| "knowledge.topic.failed".to_string())?;
            tx.execute(
                "DELETE FROM knowledge_topic_links WHERE topic_id=?1",
                params![input.topic_id],
            )
            .map_err(|_| "knowledge.topic.failed".to_string())?;
            tx.execute(
                "DELETE FROM knowledge_topics WHERE topic_id=?1",
                params![input.topic_id],
            )
            .map_err(|_| "knowledge.topic.failed".to_string())?;
            tx.execute(
                "UPDATE knowledge_topics
                 SET source='manual', manual=1, confidence=1.0, updated_at=?1
                 WHERE topic_id=?2",
                params![now_iso(), target],
            )
            .map_err(|_| "knowledge.topic.failed".to_string())?;
            tx.commit()
                .map_err(|_| "knowledge.topic.failed".to_string())?;
        }
        _ => return Err("knowledge.topic.action_invalid".to_string()),
    }
    Ok(Ack {
        ok: true,
        message: "knowledge.topic.updated".to_string(),
    })
}

#[cfg(test)]
mod knowledge_topic_tests {
    use super::*;

    #[test]
    fn automatic_topics_can_be_promoted_hidden_renamed_and_merged() {
        let root = std::env::temp_dir().join(format!("latotex-topics-{}", Uuid::new_v4()));
        let db_path = root.join("runtime").join("latotex.db");
        let projects = root.join("projects");
        fs::create_dir_all(db_path.parent().unwrap()).unwrap();
        fs::create_dir_all(&projects).unwrap();
        initialize_database(&db_path).unwrap();
        let snapshot = create_project(&db_path, &projects, "Topics").unwrap();
        let project_id = snapshot.summary.id;
        let project_root = load_project_root(&db_path, &project_id).unwrap();
        fs::write(
            project_root.join("topics.md"),
            "# Reproducibility\n\nEvidence tagged with #statistics and #bootstrap.",
        )
        .unwrap();
        archive_knowledge_item(&db_path, &project_id, "topics.md", None).unwrap();
        let list_input = crate::models::KnowledgeTopicListInput {
            project_id: project_id.clone(),
        };
        let topics = list_knowledge_topics(&db_path, &list_input).unwrap();
        assert!(topics.len() >= 2);
        let source = topics[0].topic_id.clone();
        let target = topics[1].topic_id.clone();
        for (action, label) in [
            ("promote", None),
            ("rename", Some("Verified methods".to_string())),
            ("hide", None),
            ("unhide", None),
        ] {
            mutate_knowledge_topic(
                &db_path,
                &crate::models::KnowledgeTopicMutationInput {
                    project_id: project_id.clone(),
                    topic_id: source.clone(),
                    action: action.to_string(),
                    label,
                    target_topic_id: None,
                },
            )
            .unwrap();
        }
        mutate_knowledge_topic(
            &db_path,
            &crate::models::KnowledgeTopicMutationInput {
                project_id: project_id.clone(),
                topic_id: source,
                action: "merge".to_string(),
                label: None,
                target_topic_id: Some(target),
            },
        )
        .unwrap();
        let merged = list_knowledge_topics(&db_path, &list_input).unwrap();
        assert_eq!(merged.len(), topics.len() - 1);
        assert!(merged.iter().any(|topic| topic.manual));
        let _ = fs::remove_dir_all(root);
    }
}
