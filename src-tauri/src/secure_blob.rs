use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use std::path::Path;

use super::{ensure_file_master_key, NONCE_LEN};

const ENVELOPE_VERSION: u8 = 1;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SecureBlobEnvelope {
    version: u8,
    nonce_b64: String,
    ciphertext_b64: String,
}

fn validate_scope(scope: &str) -> Result<(), String> {
    if scope.trim().is_empty() || scope.len() > 512 {
        return Err("research.crypto.invalid_scope".to_string());
    }
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn seal_scoped_blob(
    runtime_root: &Path,
    scope: &str,
    plaintext: &[u8],
) -> Result<String, String> {
    validate_scope(scope)?;
    let (master_key, _) = ensure_file_master_key(runtime_root)
        .map_err(|_| "research.crypto.key_unavailable".to_string())?;
    let mut nonce = [0_u8; NONCE_LEN];
    SystemRandom::new()
        .fill(&mut nonce)
        .map_err(|_| "research.crypto.random_failed".to_string())?;
    let unbound = UnboundKey::new(&AES_256_GCM, &master_key)
        .map_err(|_| "research.crypto.key_invalid".to_string())?;
    let cipher = LessSafeKey::new(unbound);
    let mut ciphertext = plaintext.to_vec();
    cipher
        .seal_in_place_append_tag(
            Nonce::assume_unique_for_key(nonce),
            Aad::from(scope.as_bytes()),
            &mut ciphertext,
        )
        .map_err(|_| "research.crypto.encrypt_failed".to_string())?;
    serde_json::to_string(&SecureBlobEnvelope {
        version: ENVELOPE_VERSION,
        nonce_b64: BASE64.encode(nonce),
        ciphertext_b64: BASE64.encode(ciphertext),
    })
    .map_err(|_| "research.crypto.envelope_encode_failed".to_string())
}

#[cfg(not(target_os = "windows"))]
pub fn seal_scoped_blob(
    _runtime_root: &Path,
    scope: &str,
    _plaintext: &[u8],
) -> Result<String, String> {
    validate_scope(scope)?;
    Err("research.crypto.dpapi_unavailable".to_string())
}

#[cfg(target_os = "windows")]
pub fn open_scoped_blob(
    runtime_root: &Path,
    scope: &str,
    encoded: &str,
) -> Result<Vec<u8>, String> {
    validate_scope(scope)?;
    let envelope: SecureBlobEnvelope = serde_json::from_str(encoded)
        .map_err(|_| "research.crypto.envelope_invalid".to_string())?;
    if envelope.version != ENVELOPE_VERSION {
        return Err("research.crypto.version_unsupported".to_string());
    }
    let nonce = BASE64
        .decode(envelope.nonce_b64.as_bytes())
        .map_err(|_| "research.crypto.envelope_invalid".to_string())?;
    if nonce.len() != NONCE_LEN {
        return Err("research.crypto.envelope_invalid".to_string());
    }
    let mut nonce_bytes = [0_u8; NONCE_LEN];
    nonce_bytes.copy_from_slice(&nonce);
    let mut ciphertext = BASE64
        .decode(envelope.ciphertext_b64.as_bytes())
        .map_err(|_| "research.crypto.envelope_invalid".to_string())?;
    let (master_key, _) = ensure_file_master_key(runtime_root)
        .map_err(|_| "research.crypto.key_unavailable".to_string())?;
    let unbound = UnboundKey::new(&AES_256_GCM, &master_key)
        .map_err(|_| "research.crypto.key_invalid".to_string())?;
    let cipher = LessSafeKey::new(unbound);
    let plaintext = cipher
        .open_in_place(
            Nonce::assume_unique_for_key(nonce_bytes),
            Aad::from(scope.as_bytes()),
            &mut ciphertext,
        )
        .map_err(|_| "research.crypto.decrypt_failed".to_string())?;
    Ok(plaintext.to_vec())
}

#[cfg(not(target_os = "windows"))]
pub fn open_scoped_blob(
    _runtime_root: &Path,
    scope: &str,
    _encoded: &str,
) -> Result<Vec<u8>, String> {
    validate_scope(scope)?;
    Err("research.crypto.dpapi_unavailable".to_string())
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::{open_scoped_blob, seal_scoped_blob, SecureBlobEnvelope, BASE64};
    use base64::Engine;
    use uuid::Uuid;

    fn test_root() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("latotex-secure-blob-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn scoped_blob_roundtrip_rejects_scope_swapping_and_corruption() {
        let root = test_root();
        let sealed = seal_scoped_blob(&root, "project-a:task-1:goal", b"sensitive goal").unwrap();
        assert!(!sealed.contains("sensitive goal"));
        assert_eq!(
            open_scoped_blob(&root, "project-a:task-1:goal", &sealed).unwrap(),
            b"sensitive goal"
        );
        assert_eq!(
            open_scoped_blob(&root, "project-b:task-1:goal", &sealed).unwrap_err(),
            "research.crypto.decrypt_failed"
        );
        let mut envelope: SecureBlobEnvelope = serde_json::from_str(&sealed).unwrap();
        let mut ciphertext = BASE64.decode(envelope.ciphertext_b64.as_bytes()).unwrap();
        ciphertext[0] ^= 0x01;
        envelope.ciphertext_b64 = BASE64.encode(ciphertext);
        let corrupted = serde_json::to_string(&envelope).unwrap();
        assert_eq!(
            open_scoped_blob(&root, "project-a:task-1:goal", &corrupted).unwrap_err(),
            "research.crypto.decrypt_failed"
        );
    }
}
