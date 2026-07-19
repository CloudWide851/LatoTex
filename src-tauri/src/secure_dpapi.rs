use super::{MASTER_KEY_FILE_DIR, MASTER_KEY_LEN};
use std::fs;
use std::path::{Path, PathBuf};

const MASTER_KEY_FILE_NAME: &str = "master-key.dpapi";
pub(super) const FILE_MAGIC: &[u8] = b"LATOTEX-DPAPI-V1\0";
const ENTROPY: &[u8] = b"latotex.desktop.master-key.v1";

pub(super) fn master_key_file_path(runtime_root: &Path) -> PathBuf {
    runtime_root
        .join(MASTER_KEY_FILE_DIR)
        .join(MASTER_KEY_FILE_NAME)
}

fn transform(input: &[u8], protect: bool) -> Result<Vec<u8>, String> {
    use std::ptr::{null, null_mut};
    use std::slice;
    use windows_sys::Win32::Foundation::{GetLastError, LocalFree};
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let input_blob = CRYPT_INTEGER_BLOB {
        cbData: input
            .len()
            .try_into()
            .map_err(|_| "DPAPI input is too large".to_string())?,
        pbData: input.as_ptr() as *mut u8,
    };
    let entropy_blob = CRYPT_INTEGER_BLOB {
        cbData: ENTROPY.len() as u32,
        pbData: ENTROPY.as_ptr() as *mut u8,
    };
    let mut output_blob = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };
    let mut description = null_mut();
    let ok = unsafe {
        if protect {
            CryptProtectData(
                &input_blob,
                null(),
                &entropy_blob,
                null(),
                null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output_blob,
            )
        } else {
            CryptUnprotectData(
                &input_blob,
                &mut description,
                &entropy_blob,
                null(),
                null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output_blob,
            )
        }
    };
    if ok == 0 {
        let code = unsafe { GetLastError() };
        return Err(format!("DPAPI operation failed: win32={code}"));
    }
    let output =
        unsafe { slice::from_raw_parts(output_blob.pbData, output_blob.cbData as usize).to_vec() };
    unsafe {
        if !output_blob.pbData.is_null() {
            LocalFree(output_blob.pbData as _);
        }
        if !description.is_null() {
            LocalFree(description as _);
        }
    }
    Ok(output)
}

pub(super) fn write_master_key(path: &Path, key: &[u8; MASTER_KEY_LEN]) -> Result<(), String> {
    let protected = transform(key, true)?;
    let mut encoded = Vec::with_capacity(FILE_MAGIC.len() + protected.len());
    encoded.extend_from_slice(FILE_MAGIC);
    encoded.extend_from_slice(&protected);
    fs::write(path, encoded).map_err(|e| e.to_string())
}

pub(super) fn read_master_key(path: &Path) -> Result<[u8; MASTER_KEY_LEN], String> {
    let encoded = fs::read(path).map_err(|e| e.to_string())?;
    let protected = encoded
        .strip_prefix(FILE_MAGIC)
        .ok_or_else(|| "invalid DPAPI master key header".to_string())?;
    if protected.is_empty() {
        return Err("empty DPAPI master key payload".to_string());
    }
    let raw = transform(protected, false)?;
    if raw.len() != MASTER_KEY_LEN {
        return Err("invalid DPAPI master key length".to_string());
    }
    let mut key = [0_u8; MASTER_KEY_LEN];
    key.copy_from_slice(&raw);
    Ok(key)
}
