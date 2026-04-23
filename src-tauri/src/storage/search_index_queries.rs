fn normalize_search_scopes(raw: Option<Vec<String>>) -> HashSet<String> {
    let mut scopes = HashSet::new();
    for value in raw.unwrap_or_default() {
        let normalized = value.trim().to_lowercase();
        if matches!(normalized.as_str(), "file_name" | "file_content") {
            scopes.insert(normalized);
        }
    }
    if scopes.is_empty() {
        scopes.insert("file_name".to_string());
        scopes.insert("file_content".to_string());
    }
    scopes
}

fn encode_search_cursor(relative_path: &str, line_number: u32) -> String {
    format!("{relative_path}\t{line_number}")
}

fn decode_search_cursor(raw: Option<String>) -> (String, u32) {
    let Some(value) = raw.map(|item| item.trim().to_string()).filter(|item| !item.is_empty()) else {
        return (String::new(), 0);
    };
    let mut parts = value.splitn(2, '\t');
    let relative_path = parts.next().unwrap_or("").trim().to_string();
    let line_number = parts
        .next()
        .and_then(|item| item.trim().parse::<u32>().ok())
        .unwrap_or(0);
    (relative_path, line_number)
}

pub fn search_project_content(
    db_path: &Path,
    input: ProjectSearchInput,
) -> Result<Vec<ProjectSearchHit>, String> {
    let query = input.query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let limit = input.limit.unwrap_or(200).clamp(1, 500) as usize;
    let root = load_project_root(db_path, &input.project_id)?;
    let conn = open_search_index(&root)?;
    let query_lower = query.to_lowercase();
    let scopes = normalize_search_scopes(input.scopes);
    let mut hits = Vec::new();

    if scopes.contains("file_name") {
        let mut stmt = conn
            .prepare(
                "
                SELECT relative_path
                FROM search_documents
                WHERE instr(file_name_lower, ?1) > 0
                ORDER BY relative_path COLLATE NOCASE
                LIMIT ?2
                ",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![query_lower, limit as i64], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            hits.push(ProjectSearchHit {
                relative_path: Some(row.map_err(|e| e.to_string())?),
                line_number: None,
                match_kind: "file_name".to_string(),
                snippet: "File name match".to_string(),
                session_id: None,
                title: None,
            });
        }
    }

    if scopes.contains("file_content") && hits.len() < limit {
        let remaining = limit - hits.len();
        let mut stmt = conn
            .prepare(
                "
                SELECT relative_path, content_text, content_lower
                FROM search_documents
                WHERE searchable = 1 AND instr(content_lower, ?1) > 0
                ORDER BY relative_path COLLATE NOCASE
                ",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![query_lower], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (relative_path, content_text, content_lower) = row.map_err(|e| e.to_string())?;
            for (index, (line, line_lower)) in content_text.lines().zip(content_lower.lines()).enumerate() {
                if !line_lower.contains(&query_lower) {
                    continue;
                }
                hits.push(ProjectSearchHit {
                    relative_path: Some(relative_path.clone()),
                    line_number: Some((index + 1) as u32),
                    match_kind: "file_content".to_string(),
                    snippet: truncate_chars(line.trim(), 220),
                    session_id: None,
                    title: None,
                });
                if hits.len() >= limit || hits.iter().filter(|hit| hit.match_kind == "file_content").count() >= remaining
                {
                    break;
                }
            }
            if hits.len() >= limit {
                break;
            }
        }
    }

    hits.sort_by(|a, b| {
        let a_rank = if a.match_kind == "file_name" { 0_u8 } else { 1_u8 };
        let b_rank = if b.match_kind == "file_name" { 0_u8 } else { 1_u8 };
        a_rank
            .cmp(&b_rank)
            .then_with(|| a.relative_path.cmp(&b.relative_path))
            .then_with(|| a.line_number.unwrap_or(0).cmp(&b.line_number.unwrap_or(0)))
    });
    hits.truncate(limit);
    Ok(hits)
}

pub fn search_project_content_incremental(
    db_path: &Path,
    input: ProjectSearchIncrementalInput,
) -> Result<ProjectSearchBatch, String> {
    let query = input.query.trim();
    if query.is_empty() {
        return Ok(ProjectSearchBatch {
            hits: Vec::new(),
            next_cursor: None,
            done: true,
            scope: None,
        });
    }
    let scope = normalize_search_scopes(input.scopes)
        .into_iter()
        .find(|item| item == "file_name" || item == "file_content")
        .unwrap_or_else(|| "file_content".to_string());
    let limit = input.limit.unwrap_or(40).clamp(1, 120) as usize;
    let root = load_project_root(db_path, &input.project_id)?;
    let conn = open_search_index(&root)?;
    let query_lower = query.to_lowercase();
    let (after_path, after_line_number) = decode_search_cursor(input.cursor);
    let mut hits = Vec::new();

    if scope == "file_name" {
        let mut stmt = conn
            .prepare(
                "
                SELECT relative_path
                FROM search_documents
                WHERE instr(file_name_lower, ?1) > 0
                  AND (?2 = '' OR relative_path > ?2)
                ORDER BY relative_path COLLATE NOCASE
                LIMIT ?3
                ",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![query_lower, after_path, (limit + 1) as i64], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|e| e.to_string())?;
        let mut matched_paths = Vec::new();
        for row in rows {
            matched_paths.push(row.map_err(|e| e.to_string())?);
        }
        let done = matched_paths.len() <= limit;
        let next_cursor = if done {
            None
        } else {
            matched_paths.get(limit - 1).map(|item| encode_search_cursor(item, 0))
        };
        for relative_path in matched_paths.into_iter().take(limit) {
            hits.push(ProjectSearchHit {
                relative_path: Some(relative_path),
                line_number: None,
                match_kind: "file_name".to_string(),
                snippet: "File name match".to_string(),
                session_id: None,
                title: None,
            });
        }
        return Ok(ProjectSearchBatch {
            hits,
            next_cursor,
            done,
            scope: Some(scope),
        });
    }

    let mut stmt = conn
        .prepare(
            "
            SELECT relative_path, content_text, content_lower
            FROM search_documents
            WHERE searchable = 1
              AND instr(content_lower, ?1) > 0
              AND (?2 = '' OR relative_path >= ?2)
            ORDER BY relative_path COLLATE NOCASE
            ",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![query_lower, after_path], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            ))
        })
        .map_err(|e| e.to_string())?;

    for row in rows {
        let (relative_path, content_text, content_lower) = row.map_err(|e| e.to_string())?;
        let skip_until_line = if !after_path.is_empty() && relative_path == after_path {
            after_line_number
        } else {
            0
        };
        for (index, (line, line_lower)) in content_text.lines().zip(content_lower.lines()).enumerate() {
            let line_number = (index + 1) as u32;
            if line_number <= skip_until_line || !line_lower.contains(&query_lower) {
                continue;
            }
            hits.push(ProjectSearchHit {
                relative_path: Some(relative_path.clone()),
                line_number: Some(line_number),
                match_kind: "file_content".to_string(),
                snippet: truncate_chars(line.trim(), 220),
                session_id: None,
                title: None,
            });
            if hits.len() >= limit {
                return Ok(ProjectSearchBatch {
                    hits,
                    next_cursor: Some(encode_search_cursor(&relative_path, line_number)),
                    done: false,
                    scope: Some(scope),
                });
            }
        }
    }

    Ok(ProjectSearchBatch {
        hits,
        next_cursor: None,
        done: true,
        scope: Some(scope),
    })
}
