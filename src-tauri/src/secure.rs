use keyring::Entry;

const SERVICE_NAME: &str = "latotex.desktop";

fn protocol_entry_name(protocol_id: &str) -> String {
    format!("protocol:{protocol_id}")
}

fn legacy_entry_names(protocol_id: &str) -> Vec<String> {
    match protocol_id {
        "openai-compatible" => vec!["provider:openai".to_string()],
        "anthropic" => vec!["provider:anthropic".to_string()],
        "gemini" => vec!["provider:gemini".to_string()],
        _ => Vec::new(),
    }
}

pub fn store_api_key(protocol_id: &str, api_key: &str) -> Result<(), String> {
    let entry =
        Entry::new(SERVICE_NAME, &protocol_entry_name(protocol_id)).map_err(|e| e.to_string())?;
    entry.set_password(api_key).map_err(|e| e.to_string())
}

pub fn has_api_key(protocol_id: &str) -> Result<bool, String> {
    let entry =
        Entry::new(SERVICE_NAME, &protocol_entry_name(protocol_id)).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(value) => Ok(!value.trim().is_empty()),
        Err(keyring::Error::NoEntry) => {
            for legacy_name in legacy_entry_names(protocol_id) {
                let legacy_entry =
                    Entry::new(SERVICE_NAME, &legacy_name).map_err(|e| e.to_string())?;
                match legacy_entry.get_password() {
                    Ok(value) if !value.trim().is_empty() => return Ok(true),
                    Ok(_) | Err(keyring::Error::NoEntry) => continue,
                    Err(e) => return Err(e.to_string()),
                }
            }
            Ok(false)
        }
        Err(e) => Err(e.to_string()),
    }
}
