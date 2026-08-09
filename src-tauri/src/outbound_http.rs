use reqwest::redirect::Policy;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OutboundProxyMode {
    System,
    Manual(String),
    Direct,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProxyResolution {
    pub proxy_url: Option<String>,
    pub source: String,
    pub use_environment: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutboundFailure {
    pub code: String,
    pub stage: String,
    pub retryable: bool,
    pub proxy_source: String,
}

fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(value) => {
            !(value.is_private()
                || value.is_loopback()
                || value.is_link_local()
                || value.is_broadcast()
                || value.is_documentation()
                || value.is_multicast()
                || value.is_unspecified())
        }
        IpAddr::V6(value) => {
            let segments = value.segments();
            !(value.is_loopback()
                || value.is_unspecified()
                || value.is_multicast()
                || (segments[0] & 0xfe00) == 0xfc00
                || (segments[0] & 0xffc0) == 0xfe80)
                && value
                    .to_ipv4()
                    .map(|mapped| public_ip(IpAddr::V4(mapped)))
                    .unwrap_or(true)
        }
    }
}

fn resolve_public_https_target(raw: &str) -> Result<(reqwest::Url, Vec<SocketAddr>), String> {
    let mut url =
        reqwest::Url::parse(raw.trim()).map_err(|_| "network.target.invalid".to_string())?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.host_str().is_none()
    {
        return Err("network.target.invalid".to_string());
    }
    if url.port().is_some_and(|port| port != 443) {
        return Err("network.target.port_invalid".to_string());
    }
    url.set_fragment(None);
    let host = url
        .host_str()
        .ok_or_else(|| "network.target.invalid".to_string())?;
    let normalized_host = host.trim_end_matches('.').to_ascii_lowercase();
    if normalized_host == "localhost"
        || normalized_host.ends_with(".localhost")
        || normalized_host.ends_with(".local")
    {
        return Err("network.target.private".to_string());
    }
    let port = url.port_or_known_default().unwrap_or(443);
    let addresses = (host, port)
        .to_socket_addrs()
        .map_err(|_| "network.target.resolve_failed".to_string())?
        .collect::<Vec<_>>();
    if addresses.is_empty() || addresses.iter().any(|address| !public_ip(address.ip())) {
        return Err("network.target.private".to_string());
    }
    Ok((url, addresses))
}

#[cfg(test)]
pub fn validate_public_https_url(raw: &str) -> Result<reqwest::Url, String> {
    resolve_public_https_target(raw).map(|(url, _)| url)
}

fn normalize_proxy_url(raw: &str) -> Result<String, String> {
    let candidate = raw.trim();
    if candidate.is_empty() {
        return Err("network.proxy.manual_invalid".to_string());
    }
    let with_scheme = if candidate.contains("://") {
        candidate.to_string()
    } else {
        format!("http://{candidate}")
    };
    let (scheme, authority) = with_scheme
        .split_once("://")
        .ok_or_else(|| "network.proxy.manual_invalid".to_string())?;
    let scheme = scheme.to_ascii_lowercase();
    if !matches!(scheme.as_str(), "http" | "https" | "socks5" | "socks5h") {
        return Err("network.proxy.manual_invalid".to_string());
    }
    // `url` treats unknown/non-special schemes as opaque URLs. Validate SOCKS
    // authorities through an HTTP surrogate, then restore the accepted scheme.
    let validation_url = if matches!(scheme.as_str(), "socks5" | "socks5h") {
        format!("http://{authority}")
    } else {
        with_scheme.clone()
    };
    let parsed = reqwest::Url::parse(&validation_url)
        .map_err(|_| "network.proxy.manual_invalid".to_string())?;
    if parsed.host_str().is_none()
        || parsed.port_or_known_default().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.path() != "/"
    {
        return Err("network.proxy.manual_invalid".to_string());
    }
    if matches!(scheme.as_str(), "socks5" | "socks5h") {
        let host = parsed
            .host_str()
            .ok_or_else(|| "network.proxy.manual_invalid".to_string())?;
        let host = if host.contains(':') {
            format!("[{host}]")
        } else {
            host.to_string()
        };
        let port = parsed
            .port()
            .ok_or_else(|| "network.proxy.manual_invalid".to_string())?;
        Ok(format!("{scheme}://{host}:{port}"))
    } else {
        Ok(parsed.to_string().trim_end_matches('/').to_string())
    }
}

fn select_windows_proxy(raw: &str, target: &reqwest::Url) -> Option<String> {
    let entries = raw
        .split(';')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .collect::<Vec<_>>();
    let target_scheme = target.scheme();
    let preferred = entries
        .iter()
        .filter_map(|entry| entry.split_once('='))
        .find(|(scheme, _)| scheme.trim().eq_ignore_ascii_case(target_scheme))
        .map(|(_, value)| value.trim())
        .or_else(|| {
            entries
                .iter()
                .filter_map(|entry| entry.split_once('='))
                .find(|(scheme, _)| scheme.trim().eq_ignore_ascii_case("http"))
                .map(|(_, value)| value.trim())
        })
        .or_else(|| entries.iter().find(|entry| !entry.contains('=')).copied())?;
    normalize_proxy_url(preferred).ok()
}

fn wildcard_matches(pattern: &str, value: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    let pattern = pattern.to_ascii_lowercase();
    let value = value.to_ascii_lowercase();
    if let Some(suffix) = pattern.strip_prefix('*') {
        return value.ends_with(suffix);
    }
    if let Some(prefix) = pattern.strip_suffix('*') {
        return value.starts_with(prefix);
    }
    pattern == value
}

fn windows_bypass_matches(raw: &str, target: &reqwest::Url) -> bool {
    let Some(host) = target.host_str() else {
        return false;
    };
    raw.split([';', ','])
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .any(|entry| {
            (entry.eq_ignore_ascii_case("<local>") && !host.contains('.'))
                || wildcard_matches(entry, host)
        })
}

fn environment_proxy_configured(target: &reqwest::Url) -> bool {
    let scheme = target.scheme().to_ascii_uppercase();
    [
        format!("{scheme}_PROXY"),
        format!("{scheme}_proxy"),
        "ALL_PROXY".to_string(),
        "all_proxy".to_string(),
    ]
    .iter()
    .any(|key| {
        std::env::var(key)
            .ok()
            .is_some_and(|value| !value.trim().is_empty())
    })
}

#[cfg(windows)]
mod windows_proxy {
    use super::{select_windows_proxy, windows_bypass_matches, ProxyResolution};
    use std::ptr::{null, null_mut};
    use windows_sys::core::PWSTR;
    use windows_sys::Win32::Foundation::{GlobalFree, HGLOBAL};
    use windows_sys::Win32::Networking::WinHttp::{
        WinHttpCloseHandle, WinHttpGetIEProxyConfigForCurrentUser, WinHttpGetProxyForUrl,
        WinHttpOpen, WINHTTP_ACCESS_TYPE_NO_PROXY, WINHTTP_AUTOPROXY_AUTO_DETECT,
        WINHTTP_AUTOPROXY_CONFIG_URL, WINHTTP_AUTOPROXY_OPTIONS, WINHTTP_AUTO_DETECT_TYPE_DHCP,
        WINHTTP_AUTO_DETECT_TYPE_DNS_A, WINHTTP_CURRENT_USER_IE_PROXY_CONFIG, WINHTTP_PROXY_INFO,
    };

    #[derive(Default)]
    struct IeProxyConfig {
        auto_detect: bool,
        auto_config_url: Option<String>,
        proxy: Option<String>,
        bypass: Option<String>,
    }

    unsafe fn pwstr_value(value: PWSTR) -> Option<String> {
        if value.is_null() {
            return None;
        }
        let mut len = 0usize;
        while unsafe { *value.add(len) } != 0 {
            len += 1;
        }
        let result = String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(value, len) });
        unsafe {
            let _ = GlobalFree(value as HGLOBAL);
        }
        (!result.trim().is_empty()).then(|| result.trim().to_string())
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn current_user_config() -> Option<IeProxyConfig> {
        let mut raw = WINHTTP_CURRENT_USER_IE_PROXY_CONFIG {
            fAutoDetect: 0,
            lpszAutoConfigUrl: null_mut(),
            lpszProxy: null_mut(),
            lpszProxyBypass: null_mut(),
        };
        let ok = unsafe { WinHttpGetIEProxyConfigForCurrentUser(&mut raw) };
        if ok == 0 {
            return None;
        }
        Some(IeProxyConfig {
            auto_detect: raw.fAutoDetect != 0,
            auto_config_url: unsafe { pwstr_value(raw.lpszAutoConfigUrl) },
            proxy: unsafe { pwstr_value(raw.lpszProxy) },
            bypass: unsafe { pwstr_value(raw.lpszProxyBypass) },
        })
    }

    fn auto_proxy(target_url: &str, config: &IeProxyConfig) -> Result<Option<String>, String> {
        if !config.auto_detect && config.auto_config_url.is_none() {
            return Ok(None);
        }
        let agent = wide("LatoTex/0.1");
        let session = unsafe {
            WinHttpOpen(
                agent.as_ptr(),
                WINHTTP_ACCESS_TYPE_NO_PROXY,
                null(),
                null(),
                0,
            )
        };
        if session.is_null() {
            return Err("network.proxy.pac_failed".to_string());
        }
        let target = wide(target_url);
        let auto_url = config.auto_config_url.as_deref().map(wide);
        let mut options = WINHTTP_AUTOPROXY_OPTIONS {
            dwFlags: if auto_url.is_some() {
                WINHTTP_AUTOPROXY_CONFIG_URL
            } else {
                WINHTTP_AUTOPROXY_AUTO_DETECT
            },
            dwAutoDetectFlags: WINHTTP_AUTO_DETECT_TYPE_DHCP | WINHTTP_AUTO_DETECT_TYPE_DNS_A,
            lpszAutoConfigUrl: auto_url.as_ref().map_or(null(), |value| value.as_ptr()),
            lpvReserved: null_mut(),
            dwReserved: 0,
            fAutoLogonIfChallenged: 1,
        };
        let mut info = WINHTTP_PROXY_INFO {
            dwAccessType: WINHTTP_ACCESS_TYPE_NO_PROXY,
            lpszProxy: null_mut(),
            lpszProxyBypass: null_mut(),
        };
        let ok =
            unsafe { WinHttpGetProxyForUrl(session, target.as_ptr(), &mut options, &mut info) };
        unsafe {
            WinHttpCloseHandle(session);
        }
        if ok == 0 {
            return Err("network.proxy.pac_failed".to_string());
        }
        let proxy = unsafe { pwstr_value(info.lpszProxy) };
        let bypass = unsafe { pwstr_value(info.lpszProxyBypass) };
        let parsed_target =
            reqwest::Url::parse(target_url).map_err(|_| "network.target.invalid".to_string())?;
        if bypass
            .as_deref()
            .is_some_and(|value| windows_bypass_matches(value, &parsed_target))
        {
            return Ok(None);
        }
        Ok(proxy.and_then(|value| select_windows_proxy(&value, &parsed_target)))
    }

    pub(super) fn resolve(target: &reqwest::Url) -> Result<Option<ProxyResolution>, String> {
        let Some(config) = current_user_config() else {
            return Ok(None);
        };
        let windows_configured =
            config.proxy.is_some() || config.auto_config_url.is_some() || config.auto_detect;
        if let Some(bypass) = config.bypass.as_deref() {
            if windows_bypass_matches(bypass, target) {
                return Ok(Some(ProxyResolution {
                    proxy_url: None,
                    source: "wininet_bypass".to_string(),
                    use_environment: false,
                }));
            }
        }
        if let Some(proxy) = config
            .proxy
            .as_deref()
            .and_then(|value| select_windows_proxy(value, target))
        {
            return Ok(Some(ProxyResolution {
                proxy_url: Some(proxy),
                source: "wininet".to_string(),
                use_environment: false,
            }));
        }
        if config.auto_config_url.is_some() || config.auto_detect {
            let proxy = auto_proxy(target.as_str(), &config)?;
            return Ok(Some(ProxyResolution {
                proxy_url: proxy,
                source: "winhttp_auto".to_string(),
                use_environment: false,
            }));
        }
        if windows_configured {
            return Ok(Some(ProxyResolution {
                proxy_url: None,
                source: "wininet_direct".to_string(),
                use_environment: false,
            }));
        }
        Ok(None)
    }
}

pub fn resolve_proxy(
    target_url: &str,
    mode: &OutboundProxyMode,
) -> Result<ProxyResolution, String> {
    let target =
        reqwest::Url::parse(target_url).map_err(|_| "network.target.invalid".to_string())?;
    match mode {
        OutboundProxyMode::Direct => Ok(ProxyResolution {
            proxy_url: None,
            source: "direct".to_string(),
            use_environment: false,
        }),
        OutboundProxyMode::Manual(raw) => Ok(ProxyResolution {
            proxy_url: Some(normalize_proxy_url(raw)?),
            source: "manual".to_string(),
            use_environment: false,
        }),
        OutboundProxyMode::System => {
            #[cfg(windows)]
            if let Some(resolution) = windows_proxy::resolve(&target)? {
                return Ok(resolution);
            }
            if environment_proxy_configured(&target) {
                Ok(ProxyResolution {
                    proxy_url: None,
                    source: "environment".to_string(),
                    use_environment: true,
                })
            } else {
                Ok(ProxyResolution {
                    proxy_url: None,
                    source: "direct".to_string(),
                    use_environment: false,
                })
            }
        }
    }
}

fn apply_async_proxy(
    mut builder: reqwest::ClientBuilder,
    resolution: &ProxyResolution,
) -> Result<reqwest::ClientBuilder, String> {
    if resolution.use_environment {
        return Ok(builder);
    }
    builder = builder.no_proxy();
    if let Some(proxy_url) = resolution.proxy_url.as_deref() {
        builder = builder.proxy(
            reqwest::Proxy::all(proxy_url)
                .map_err(|_| "network.proxy.manual_invalid".to_string())?,
        );
    }
    Ok(builder)
}

fn apply_blocking_proxy(
    mut builder: reqwest::blocking::ClientBuilder,
    resolution: &ProxyResolution,
) -> Result<reqwest::blocking::ClientBuilder, String> {
    if resolution.use_environment {
        return Ok(builder);
    }
    builder = builder.no_proxy();
    if let Some(proxy_url) = resolution.proxy_url.as_deref() {
        builder = builder.proxy(
            reqwest::Proxy::all(proxy_url)
                .map_err(|_| "network.proxy.manual_invalid".to_string())?,
        );
    }
    Ok(builder)
}

pub fn build_async_client(
    target_url: &str,
    mode: &OutboundProxyMode,
    timeout: Duration,
) -> Result<(reqwest::Client, ProxyResolution), String> {
    let resolution = resolve_proxy(target_url, mode)?;
    let builder = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(timeout)
        .redirect(Policy::none());
    let client = apply_async_proxy(builder, &resolution)?
        .build()
        .map_err(|_| "network.client.build_failed".to_string())?;
    Ok((client, resolution))
}

pub fn build_blocking_client(
    target_url: &str,
    mode: &OutboundProxyMode,
    timeout: Duration,
) -> Result<(reqwest::blocking::Client, ProxyResolution), String> {
    let resolution = resolve_proxy(target_url, mode)?;
    let builder = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(timeout)
        .redirect(Policy::none());
    let client = apply_blocking_proxy(builder, &resolution)?
        .build()
        .map_err(|_| "network.client.build_failed".to_string())?;
    Ok((client, resolution))
}

pub fn build_public_blocking_client(
    target_url: &str,
    mode: &OutboundProxyMode,
    timeout: Duration,
) -> Result<(reqwest::blocking::Client, reqwest::Url, ProxyResolution), String> {
    let (url, addresses) = resolve_public_https_target(target_url)?;
    let host = url
        .host_str()
        .ok_or_else(|| "network.target.invalid".to_string())?
        .to_string();
    let resolution = resolve_proxy(url.as_str(), mode)?;
    let builder = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(timeout)
        .redirect(Policy::none())
        .resolve_to_addrs(&host, &addresses);
    let client = apply_blocking_proxy(builder, &resolution)?
        .build()
        .map_err(|_| "network.client.build_failed".to_string())?;
    Ok((client, url, resolution))
}

pub fn classify_transport_failure(error: &reqwest::Error, proxy_source: &str) -> OutboundFailure {
    let detail = error.to_string().to_ascii_lowercase();
    let (code, stage, retryable) = if error.is_timeout() {
        ("network.timeout", "http", true)
    } else if detail.contains("certificate") || detail.contains("tls") {
        ("network.tls", "tls", false)
    } else if detail.contains("dns") || detail.contains("name resolution") {
        ("network.dns", "dns", true)
    } else if error.is_connect() && proxy_source != "direct" {
        ("network.proxy_connect", "proxyConnect", true)
    } else {
        ("network.connect", "http", error.is_connect())
    };
    OutboundFailure {
        code: code.to_string(),
        stage: stage.to_string(),
        retryable,
        proxy_source: proxy_source.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_proxy_url, select_windows_proxy, validate_public_https_url,
        windows_bypass_matches,
    };

    #[test]
    fn validates_manual_proxy_without_credentials_or_query() {
        assert_eq!(
            normalize_proxy_url("127.0.0.1:10808").unwrap(),
            "http://127.0.0.1:10808"
        );
        assert!(normalize_proxy_url("http://user:pass@127.0.0.1:9").is_err());
        assert!(normalize_proxy_url("http://127.0.0.1:9?token=x").is_err());
        assert!(normalize_proxy_url("socks5://127.0.0.1:1080").is_ok());
    }

    #[test]
    fn selects_target_scheme_and_honors_windows_bypass() {
        let target = reqwest::Url::parse("https://api.telegram.org").unwrap();
        assert_eq!(
            select_windows_proxy("http=127.0.0.1:8080;https=127.0.0.1:10808", &target).as_deref(),
            Some("http://127.0.0.1:10808")
        );
        assert!(windows_bypass_matches(
            "<local>;*.example.org",
            &reqwest::Url::parse("https://api.example.org").unwrap()
        ));
    }

    #[test]
    fn rejects_private_or_credentialed_research_targets() {
        assert!(validate_public_https_url("https://127.0.0.1/paper").is_err());
        assert!(validate_public_https_url("https://[::1]/paper").is_err());
        assert!(validate_public_https_url("http://example.org/paper").is_err());
        assert!(validate_public_https_url("https://user:pass@example.org/paper").is_err());
        assert_eq!(
            validate_public_https_url("https://example.org:8443/paper").unwrap_err(),
            "network.target.port_invalid"
        );
    }
}
