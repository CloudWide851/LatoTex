fn locale_prefers_cn_source(locale: &str) -> bool {
    locale
        .trim()
        .replace('_', "-")
        .to_ascii_lowercase()
        .starts_with("zh")
}

#[cfg(target_os = "windows")]
fn system_locale_name() -> Option<String> {
    use windows_sys::Win32::Globalization::GetUserDefaultLocaleName;

    let mut buffer = [0u16; 85];
    let length = unsafe { GetUserDefaultLocaleName(buffer.as_mut_ptr(), buffer.len() as i32) };
    if length <= 1 {
        return None;
    }
    String::from_utf16(&buffer[..length as usize - 1]).ok()
}

#[cfg(not(target_os = "windows"))]
fn system_locale_name() -> Option<String> {
    None
}

pub(crate) fn prefer_cn_source() -> bool {
    let explicit_locale = std::env::var("LC_ALL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            std::env::var("LANG")
                .ok()
                .filter(|value| !value.trim().is_empty())
        });
    explicit_locale
        .or_else(system_locale_name)
        .is_some_and(|locale| locale_prefers_cn_source(&locale))
}

#[cfg(test)]
mod tests {
    use super::locale_prefers_cn_source;

    #[test]
    fn normalizes_chinese_locale_variants() {
        assert!(locale_prefers_cn_source("zh-CN"));
        assert!(locale_prefers_cn_source("zh_Hans_CN"));
        assert!(locale_prefers_cn_source("zh_CN.UTF-8"));
        assert!(!locale_prefers_cn_source("en-US"));
    }
}
