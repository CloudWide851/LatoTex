fn cache_key(spec: ProviderSpec, query: &str, limit: usize, contact_email: Option<&str>) -> String {
    let normalized_query = query
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    let email_scope = contact_email
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_default();
    let material = format!(
        "{}|{}|{}|{}",
        spec.name, limit, normalized_query, email_scope
    );
    ring::digest::digest(&ring::digest::SHA256, material.as_bytes())
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn provider_cache_connection(
    db_path: &std::path::Path,
) -> Result<rusqlite::Connection, rusqlite::Error> {
    let connection = rusqlite::Connection::open(db_path)?;
    connection.busy_timeout(Duration::from_secs(2))?;
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS academic_provider_cache (
           cache_key TEXT PRIMARY KEY,
           provider TEXT NOT NULL,
           category TEXT NOT NULL,
           result_json TEXT,
           failure_code TEXT,
           retryable INTEGER NOT NULL DEFAULT 0,
           stored_at_unix_seconds INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_academic_provider_cache_stored
           ON academic_provider_cache(stored_at_unix_seconds);",
    )?;
    Ok(connection)
}

fn provider_cache_now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

fn persist_provider_cache(
    db_path: &std::path::Path,
    key: &str,
    spec: ProviderSpec,
    result: &Result<Vec<ReferenceEvidence>, ProviderError>,
) {
    let Ok(connection) = provider_cache_connection(db_path) else {
        return;
    };
    let (result_json, failure_code, retryable) = match result {
        Ok(items) => (serde_json::to_string(items).ok(), None, 0_i64),
        Err(error) => (None, Some(error.code.as_str()), i64::from(error.retryable)),
    };
    let _ = connection.execute(
        "INSERT INTO academic_provider_cache
         (cache_key, provider, category, result_json, failure_code, retryable,
          stored_at_unix_seconds)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(cache_key) DO UPDATE SET
           provider=excluded.provider, category=excluded.category,
           result_json=excluded.result_json, failure_code=excluded.failure_code,
           retryable=excluded.retryable,
           stored_at_unix_seconds=excluded.stored_at_unix_seconds",
        rusqlite::params![
            key,
            spec.name,
            spec.category.as_str(),
            result_json,
            failure_code,
            retryable,
            provider_cache_now_seconds()
        ],
    );
}

fn load_provider_cache(db_path: &std::path::Path, key: &str) -> Option<CacheEntry> {
    use rusqlite::OptionalExtension;

    let connection = provider_cache_connection(db_path).ok()?;
    let row = connection
        .query_row(
            "SELECT result_json, failure_code, retryable, stored_at_unix_seconds
             FROM academic_provider_cache WHERE cache_key = ?1",
            rusqlite::params![key],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .optional()
        .ok()??;
    let result = if let Some(json) = row.0 {
        Ok(serde_json::from_str::<Vec<ReferenceEvidence>>(&json).ok()?)
    } else {
        Err(ProviderError {
            code: row.1?,
            retryable: row.2 != 0,
        })
    };
    let age = provider_cache_now_seconds().saturating_sub(row.3).max(0) as u64;
    Some(CacheEntry {
        stored_at: Instant::now()
            .checked_sub(Duration::from_secs(age))
            .unwrap_or_else(Instant::now),
        result,
    })
}
