use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use chrono::Utc;
use keyring::Entry;
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
use ring::rand::{SecureRandom, SystemRandom};
use rusqlite::{params, Connection, OptionalExtension};
use std::fs;
use std::path::{Path, PathBuf};

const SERVICE_NAME: &str = "latotex.desktop";
const MASTER_KEY_ACCOUNT: &str = "secure:master-key:v1";
const MASTER_KEY_FILE_DIR: &str = "secure";
const MASTER_KEY_FILE_NAME: &str = "master-key.bin";
const NONCE_LEN: usize = 12;
const MASTER_KEY_LEN: usize = 32;

#[derive(Clone, Debug)]
pub struct SecureStorageContext {
    pub db_path: PathBuf,
    pub runtime_root: PathBuf,
}

#[derive(Clone, Debug)]
pub struct SecureStoreOutcome {
    pub backend: String,
    pub diagnostic_code: Option<String>,
}

#[derive(Clone, Debug)]
pub struct SecureGetResult {
    pub api_key: Option<String>,
    pub source: String,
    pub diagnostic_code: Option<String>,
}

fn model_entry_name(model_id: &str) -> String {
    format!("model:{model_id}")
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

fn ensure_secret_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS secure_model_secrets (
            model_id TEXT PRIMARY KEY,
            nonce_b64 TEXT NOT NULL,
            ciphertext_b64 TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        ",
    )
    .map_err(|e| e.to_string())
}

fn model_keyring_get(model_id: &str) -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE_NAME, &model_entry_name(model_id)).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(value) => {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                Ok(Some(trimmed))
            }
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn model_keyring_set(model_id: &str, api_key: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &model_entry_name(model_id)).map_err(|e| e.to_string())?;
    entry.set_password(api_key).map_err(|e| e.to_string())
}

fn model_keyring_clear(model_id: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &model_entry_name(model_id)).map_err(|e| e.to_string())?;
    entry.set_password("").map_err(|e| e.to_string())
}

fn master_key_file_path(runtime_root: &Path) -> PathBuf {
    runtime_root
        .join(MASTER_KEY_FILE_DIR)
        .join(MASTER_KEY_FILE_NAME)
}

fn ensure_file_master_key(runtime_root: &Path) -> Result<([u8; MASTER_KEY_LEN], bool), String> {
    let key_path = master_key_file_path(runtime_root);
    let parent = key_path
        .parent()
        .ok_or_else(|| "failed to resolve master key folder".to_string())?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    if key_path.exists() {
        let raw = fs::read(&key_path).map_err(|e| e.to_string())?;
        if raw.len() == MASTER_KEY_LEN {
            let mut key = [0_u8; MASTER_KEY_LEN];
            key.copy_from_slice(&raw);
            return Ok((key, false));
        }
    }

    let rng = SystemRandom::new();
    let mut generated = [0_u8; MASTER_KEY_LEN];
    rng.fill(&mut generated)
        .map_err(|_| "failed to generate master key".to_string())?;
    fs::write(&key_path, generated).map_err(|e| e.to_string())?;
    Ok((generated, true))
}

fn read_keyring_master_key() -> Result<Option<[u8; MASTER_KEY_LEN]>, String> {
    let entry = Entry::new(SERVICE_NAME, MASTER_KEY_ACCOUNT).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(encoded) => {
            let decoded = BASE64
                .decode(encoded.as_bytes())
                .map_err(|e| format!("decode master key failed: {e}"))?;
            if decoded.len() != MASTER_KEY_LEN {
                return Err("invalid keyring master key length".to_string());
            }
            let mut key = [0_u8; MASTER_KEY_LEN];
            key.copy_from_slice(&decoded);
            Ok(Some(key))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn write_keyring_master_key(master_key: &[u8; MASTER_KEY_LEN]) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, MASTER_KEY_ACCOUNT).map_err(|e| e.to_string())?;
    entry
        .set_password(&BASE64.encode(master_key))
        .map_err(|e| e.to_string())
}

fn encrypt_secret(
    plain_text: &str,
    master_key: &[u8; MASTER_KEY_LEN],
) -> Result<(String, String), String> {
    let rng = SystemRandom::new();
    let mut nonce = [0_u8; NONCE_LEN];
    rng.fill(&mut nonce)
        .map_err(|_| "failed to generate nonce".to_string())?;
    let unbound =
        UnboundKey::new(&AES_256_GCM, master_key).map_err(|_| "invalid master key".to_string())?;
    let cipher = LessSafeKey::new(unbound);
    let nonce_value = Nonce::assume_unique_for_key(nonce);
    let mut encrypted = plain_text.as_bytes().to_vec();
    cipher
        .seal_in_place_append_tag(nonce_value, Aad::empty(), &mut encrypted)
        .map_err(|_| "encrypt failed".to_string())?;
    Ok((BASE64.encode(nonce), BASE64.encode(encrypted)))
}

fn decrypt_secret(
    nonce_b64: &str,
    ciphertext_b64: &str,
    master_key: &[u8; MASTER_KEY_LEN],
) -> Result<String, String> {
    let nonce = BASE64
        .decode(nonce_b64.as_bytes())
        .map_err(|e| e.to_string())?;
    let encrypted = BASE64
        .decode(ciphertext_b64.as_bytes())
        .map_err(|e| e.to_string())?;
    if nonce.len() != NONCE_LEN {
        return Err("invalid nonce length".to_string());
    }
    let mut nonce_bytes = [0_u8; NONCE_LEN];
    nonce_bytes.copy_from_slice(&nonce);
    let unbound =
        UnboundKey::new(&AES_256_GCM, master_key).map_err(|_| "invalid master key".to_string())?;
    let cipher = LessSafeKey::new(unbound);
    let mut in_out = encrypted;
    let decrypted = cipher
        .open_in_place(
            Nonce::assume_unique_for_key(nonce_bytes),
            Aad::empty(),
            &mut in_out,
        )
        .map_err(|_| "decrypt failed".to_string())?;
    let plain = String::from_utf8(decrypted.to_vec()).map_err(|e| e.to_string())?;
    let trimmed = plain.trim().to_string();
    if trimmed.is_empty() {
        Ok(String::new())
    } else {
        Ok(trimmed)
    }
}

fn upsert_model_secret(
    conn: &Connection,
    model_id: &str,
    nonce_b64: &str,
    ciphertext_b64: &str,
) -> Result<(), String> {
    conn.execute(
        "
        INSERT INTO secure_model_secrets (model_id, nonce_b64, ciphertext_b64, updated_at)
        VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(model_id) DO UPDATE SET
            nonce_b64 = excluded.nonce_b64,
            ciphertext_b64 = excluded.ciphertext_b64,
            updated_at = excluded.updated_at
        ",
        params![model_id, nonce_b64, ciphertext_b64, now_iso()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn store_model_api_key_fallback(
    context: &SecureStorageContext,
    model_id: &str,
    api_key: &str,
) -> Result<Option<String>, String> {
    let conn = Connection::open(&context.db_path).map_err(|e| e.to_string())?;
    ensure_secret_schema(&conn)?;

    let (file_master_key, regenerated) = ensure_file_master_key(&context.runtime_root)?;
    let (nonce_b64, ciphertext_b64) = encrypt_secret(api_key, &file_master_key)?;
    upsert_model_secret(&conn, model_id, &nonce_b64, &ciphertext_b64)?;

    let keyring_sync = write_keyring_master_key(&file_master_key);
    if keyring_sync.is_err() {
        return Ok(Some("MASTER_KEY_KEYRING_SYNC_FAILED".to_string()));
    }
    if regenerated {
        return Ok(Some("MASTER_KEY_FILE_REGENERATED".to_string()));
    }
    Ok(None)
}

fn load_model_api_key_fallback(
    context: &SecureStorageContext,
    model_id: &str,
) -> Result<(Option<String>, Option<String>), String> {
    let conn = Connection::open(&context.db_path).map_err(|e| e.to_string())?;
    ensure_secret_schema(&conn)?;
    let encrypted: Option<(String, String)> = conn
        .query_row(
            "SELECT nonce_b64, ciphertext_b64 FROM secure_model_secrets WHERE model_id = ?1",
            params![model_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((nonce_b64, ciphertext_b64)) = encrypted else {
        return Ok((None, None));
    };

    let (file_master_key, file_key_regenerated) = ensure_file_master_key(&context.runtime_root)?;
    if let Ok(value) = decrypt_secret(&nonce_b64, &ciphertext_b64, &file_master_key) {
        if value.trim().is_empty() {
            return Ok((None, None));
        }
        let mut diagnostic = None;
        if write_keyring_master_key(&file_master_key).is_err() {
            diagnostic = Some("MASTER_KEY_KEYRING_SYNC_FAILED".to_string());
        } else if file_key_regenerated {
            diagnostic = Some("MASTER_KEY_FILE_REGENERATED".to_string());
        }
        return Ok((Some(value), diagnostic));
    }

    let keyring_master_key = match read_keyring_master_key() {
        Ok(value) => value,
        Err(_) => return Ok((None, Some("MASTER_KEY_KEYRING_READ_FAILED".to_string()))),
    };
    let Some(keyring_master_key) = keyring_master_key else {
        return Ok((
            None,
            Some("FALLBACK_DB_DECRYPT_FAILED_FILE_KEY".to_string()),
        ));
    };

    let recovered = match decrypt_secret(&nonce_b64, &ciphertext_b64, &keyring_master_key) {
        Ok(value) if !value.trim().is_empty() => value,
        _ => return Ok((None, Some("FALLBACK_DB_DECRYPT_FAILED".to_string()))),
    };

    let (new_nonce_b64, new_ciphertext_b64) = encrypt_secret(&recovered, &file_master_key)?;
    if upsert_model_secret(&conn, model_id, &new_nonce_b64, &new_ciphertext_b64).is_err() {
        return Ok((
            Some(recovered),
            Some("MASTER_KEY_MISMATCH_RECOVER_WRITE_FAILED".to_string()),
        ));
    }
    let _ = write_keyring_master_key(&file_master_key);
    Ok((
        Some(recovered),
        Some("MASTER_KEY_MISMATCH_RECOVERED".to_string()),
    ))
}

fn delete_model_api_key_fallback(
    context: &SecureStorageContext,
    model_id: &str,
) -> Result<(), String> {
    let conn = Connection::open(&context.db_path).map_err(|e| e.to_string())?;
    ensure_secret_schema(&conn)?;
    conn.execute(
        "DELETE FROM secure_model_secrets WHERE model_id = ?1",
        params![model_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn store_model_api_key(
    context: &SecureStorageContext,
    model_id: &str,
    api_key: &str,
) -> Result<SecureStoreOutcome, String> {
    let keyring_status = model_keyring_set(model_id, api_key);
    let fallback_status = store_model_api_key_fallback(context, model_id, api_key);
    let keyring_ok = keyring_status.is_ok();
    let fallback_ok = fallback_status.is_ok();

    if keyring_ok && fallback_ok {
        return Ok(SecureStoreOutcome {
            backend: "hybrid".to_string(),
            diagnostic_code: fallback_status.ok().flatten(),
        });
    }
    if keyring_ok {
        return Ok(SecureStoreOutcome {
            backend: "keyring".to_string(),
            diagnostic_code: Some("FALLBACK_DB_WRITE_FAILED_KEYRING_ONLY".to_string()),
        });
    }
    if fallback_ok {
        return Ok(SecureStoreOutcome {
            backend: "fallback_db".to_string(),
            diagnostic_code: Some("KEYRING_WRITE_FAILED_FALLBACK_DB".to_string()),
        });
    }
    let keyring_error = keyring_status
        .err()
        .unwrap_or_else(|| "unknown keyring error".to_string());
    let fallback_error = fallback_status
        .err()
        .unwrap_or_else(|| "unknown fallback error".to_string());
    Err(format!(
        "secure store failed (keyring={keyring_error}; fallback={fallback_error})"
    ))
}

pub fn get_model_api_key(
    context: &SecureStorageContext,
    model_id: &str,
) -> Result<SecureGetResult, String> {
    match model_keyring_get(model_id) {
        Ok(Some(value)) => {
            return Ok(SecureGetResult {
                api_key: Some(value),
                source: "keyring".to_string(),
                diagnostic_code: None,
            });
        }
        Ok(None) => {}
        Err(_) => {
            let (fallback, fallback_diag) = load_model_api_key_fallback(context, model_id)?;
            if fallback.is_some() {
                return Ok(SecureGetResult {
                    api_key: fallback,
                    source: "fallback_db".to_string(),
                    diagnostic_code: fallback_diag
                        .or(Some("KEYRING_READ_FAILED_FALLBACK_DB".to_string())),
                });
            }
            return Ok(SecureGetResult {
                api_key: None,
                source: "none".to_string(),
                diagnostic_code: fallback_diag.or(Some("KEYRING_READ_FAILED".to_string())),
            });
        }
    }

    let (fallback, fallback_diag) = load_model_api_key_fallback(context, model_id)?;
    if fallback.is_some() {
        return Ok(SecureGetResult {
            api_key: fallback,
            source: "fallback_db".to_string(),
            diagnostic_code: fallback_diag.or(Some("KEYRING_EMPTY_FALLBACK_DB".to_string())),
        });
    }
    Ok(SecureGetResult {
        api_key: None,
        source: "none".to_string(),
        diagnostic_code: fallback_diag,
    })
}

pub fn delete_model_api_key(
    context: &SecureStorageContext,
    model_id: &str,
) -> Result<SecureStoreOutcome, String> {
    let keyring_status = model_keyring_clear(model_id);
    let fallback_status = delete_model_api_key_fallback(context, model_id);
    let keyring_ok = keyring_status.is_ok();
    let fallback_ok = fallback_status.is_ok();

    if keyring_ok && fallback_ok {
        return Ok(SecureStoreOutcome {
            backend: "hybrid".to_string(),
            diagnostic_code: None,
        });
    }
    if keyring_ok {
        return Ok(SecureStoreOutcome {
            backend: "keyring".to_string(),
            diagnostic_code: Some("FALLBACK_DB_CLEAR_FAILED_KEYRING_ONLY".to_string()),
        });
    }
    if fallback_ok {
        return Ok(SecureStoreOutcome {
            backend: "fallback_db".to_string(),
            diagnostic_code: Some("KEYRING_CLEAR_FAILED_FALLBACK_DB".to_string()),
        });
    }
    let keyring_error = keyring_status
        .err()
        .unwrap_or_else(|| "unknown keyring error".to_string());
    let fallback_error = fallback_status
        .err()
        .unwrap_or_else(|| "unknown fallback error".to_string());
    Err(format!(
        "secure clear failed (keyring={keyring_error}; fallback={fallback_error})"
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        delete_model_api_key, get_model_api_key, store_model_api_key, SecureStorageContext,
    };
    use uuid::Uuid;

    fn test_context() -> SecureStorageContext {
        let root = std::env::temp_dir().join(format!("latotex-secure-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create temp runtime root");
        SecureStorageContext {
            db_path: root.join("latotex.db"),
            runtime_root: root,
        }
    }

    #[test]
    fn model_api_key_roundtrip_supports_fallback() {
        let context = test_context();
        let model_id = format!("test-model-key-save-{}", std::process::id());
        let api_key = "LATOTEX_REDACTED_OPENAI_KEY";

        let save_result = store_model_api_key(&context, &model_id, api_key);
        if let Err(error) = save_result {
            eprintln!("skip secure roundtrip test: {error}");
            return;
        }

        let loaded = match get_model_api_key(&context, &model_id) {
            Ok(result) => result.api_key.unwrap_or_default(),
            Err(error) => {
                eprintln!("skip secure readback test: {error}");
                let _ = delete_model_api_key(&context, &model_id);
                return;
            }
        };
        if !loaded.is_empty() {
            assert_eq!(loaded, api_key);
        }

        let _ = delete_model_api_key(&context, &model_id);
    }
}
