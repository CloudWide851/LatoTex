#[cfg(test)]
mod search_index_tests {
    use super::*;

    fn unique_temp_file(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "latotex-search-index-{name}-{}.sqlite3",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn initialize_search_index_schema_rebuilds_legacy_documents_before_creating_indices() {
        let db_path = unique_temp_file("legacy-schema");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "
            CREATE TABLE search_meta (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              schema_version INTEGER NOT NULL,
              dirty INTEGER NOT NULL,
              last_indexed_at TEXT
            );
            INSERT INTO search_meta (id, schema_version, dirty, last_indexed_at)
            VALUES (1, 1, 0, NULL);
            CREATE TABLE search_documents (
              relative_path TEXT PRIMARY KEY,
              file_name TEXT NOT NULL,
              size_bytes INTEGER NOT NULL,
              modified_epoch_sec INTEGER NOT NULL,
              searchable INTEGER NOT NULL,
              content_text TEXT,
              content_lower TEXT
            );
            ",
        )
        .unwrap();

        initialize_search_index_schema(&conn).unwrap();

        let columns = search_documents_columns(&conn).unwrap();
        for column in SEARCH_DOCUMENT_REQUIRED_COLUMNS {
            assert!(columns.contains(*column), "missing column: {column}");
        }
        let schema_version = conn
            .query_row(
                "SELECT schema_version FROM search_meta WHERE id = 1",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap();
        assert_eq!(schema_version, SEARCH_INDEX_SCHEMA_VERSION);

        let _ = std::fs::remove_file(db_path);
    }
}
