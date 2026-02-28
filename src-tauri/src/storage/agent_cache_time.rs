pub fn load_agent_cache(db_path: &Path, cache_key: &str) -> Result<Option<String>, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let row = conn
        .query_row(
            "SELECT response, expires_at, hit_count FROM agent_cache WHERE cache_key = ?1",
            params![cache_key],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let Some((response, expires_at, hit_count)) = row else {
        return Ok(None);
    };
    let expires_at_time = chrono::DateTime::parse_from_rfc3339(&expires_at)
        .map_err(|e| e.to_string())?
        .with_timezone(&Utc);
    if Utc::now() > expires_at_time {
        conn.execute("DELETE FROM agent_cache WHERE cache_key = ?1", params![cache_key])
            .map_err(|e| e.to_string())?;
        return Ok(None);
    }

    conn.execute(
        "UPDATE agent_cache SET hit_count = ?2 WHERE cache_key = ?1",
        params![cache_key, hit_count.saturating_add(1)],
    )
    .map_err(|e| e.to_string())?;

    Ok(Some(response))
}

pub fn store_agent_cache(
    db_path: &Path,
    cache_key: &str,
    protocol_id: &str,
    model_name: &str,
    response: &str,
    ttl_seconds: i64,
) -> Result<(), String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let created_at = Utc::now();
    let expires_at = created_at + chrono::TimeDelta::seconds(ttl_seconds.max(1));
    conn.execute(
        "INSERT INTO agent_cache (cache_key, protocol_id, model_name, response, created_at, expires_at, hit_count)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)
         ON CONFLICT(cache_key) DO UPDATE SET
           protocol_id = excluded.protocol_id,
           model_name = excluded.model_name,
           response = excluded.response,
           created_at = excluded.created_at,
           expires_at = excluded.expires_at",
        params![
            cache_key,
            protocol_id,
            model_name,
            response,
            created_at.to_rfc3339(),
            expires_at.to_rfc3339()
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn now_iso() -> String {
    Utc::now().to_rfc3339()
}
