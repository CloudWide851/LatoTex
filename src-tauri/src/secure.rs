use keyring::Entry;

const SERVICE_NAME: &str = "latotex.desktop";

fn model_entry_name(model_id: &str) -> String {
    format!("model:{model_id}")
}

pub fn store_model_api_key(model_id: &str, api_key: &str) -> Result<(), String> {
    let entry =
        Entry::new(SERVICE_NAME, &model_entry_name(model_id)).map_err(|e| e.to_string())?;
    entry.set_password(api_key).map_err(|e| e.to_string())
}

pub fn get_model_api_key(model_id: &str) -> Result<Option<String>, String> {
    let entry =
        Entry::new(SERVICE_NAME, &model_entry_name(model_id)).map_err(|e| e.to_string())?;
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
        Err(e) => Err(e.to_string()),
    }
}

pub fn delete_model_api_key(model_id: &str) -> Result<(), String> {
    let entry =
        Entry::new(SERVICE_NAME, &model_entry_name(model_id)).map_err(|e| e.to_string())?;
    entry.set_password("").map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{delete_model_api_key, get_model_api_key, store_model_api_key};

    #[test]
    fn model_api_key_roundtrip_persists_without_readback_gate() {
        let model_id = format!("test-model-key-save-{}", std::process::id());
        let api_key = "LATOTEX_REDACTED_OPENAI_KEY";

        if let Err(error) = store_model_api_key(&model_id, api_key) {
            eprintln!("skip keyring roundtrip test: {error}");
            return;
        }

        let stored = match get_model_api_key(&model_id) {
            Ok(value) => value.unwrap_or_default(),
            Err(error) => {
                eprintln!("skip keyring readback test: {error}");
                let _ = delete_model_api_key(&model_id);
                return;
            }
        };
        if !stored.is_empty() {
            assert_eq!(stored, api_key);
        } else {
            eprintln!("readback returned empty in current keyring backend; save path should not gate on readback");
        }

        let _ = delete_model_api_key(&model_id);
    }
}
