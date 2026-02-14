use keyring::Entry;

const SERVICE_NAME: &str = "latotex.desktop";

fn entry_name(provider: &str) -> String {
    format!("provider:{provider}")
}

pub fn store_api_key(provider: &str, api_key: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &entry_name(provider)).map_err(|e| e.to_string())?;
    entry.set_password(api_key).map_err(|e| e.to_string())
}

pub fn has_api_key(provider: &str) -> Result<bool, String> {
    let entry = Entry::new(SERVICE_NAME, &entry_name(provider)).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(value) => Ok(!value.trim().is_empty()),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}
