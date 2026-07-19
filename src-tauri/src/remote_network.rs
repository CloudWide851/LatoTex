use reqwest::blocking::Response;
use reqwest::redirect::Policy;
use reqwest::Url;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs};
use std::time::Duration;

const MAX_REDIRECTS: usize = 3;

struct ResolvedRemoteUrl {
    url: Url,
    host: String,
    addresses: Vec<SocketAddr>,
}

fn ipv4_is_public(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    if ip.is_unspecified()
        || ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_multicast()
    {
        return false;
    }
    if octets[0] == 0 || octets[0] >= 240 {
        return false;
    }
    if octets[0] == 100 && (64..=127).contains(&octets[1]) {
        return false;
    }
    if octets[0] == 192 && octets[1] == 0 && octets[2] == 0 {
        return false;
    }
    if octets[0] == 192 && octets[1] == 88 && octets[2] == 99 {
        return false;
    }
    if octets[0] == 198 && (18..=19).contains(&octets[1]) {
        return false;
    }
    true
}

fn ipv6_is_public(ip: Ipv6Addr) -> bool {
    if let Some(mapped) = ip.to_ipv4_mapped() {
        return ipv4_is_public(mapped);
    }
    let segments = ip.segments();
    if ip.is_unspecified() || ip.is_loopback() || ip.is_multicast() {
        return false;
    }
    if (segments[0] & 0xfe00) == 0xfc00 || (segments[0] & 0xffc0) == 0xfe80 {
        return false;
    }
    if (segments[0] & 0xffc0) == 0xfec0 {
        return false;
    }
    if segments[0] == 0x2001 && segments[1] == 0x0db8 {
        return false;
    }
    true
}

pub(crate) fn ip_is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(value) => ipv4_is_public(value),
        IpAddr::V6(value) => ipv6_is_public(value),
    }
}

fn resolve_remote_url(input: &str, allow_http_once: bool) -> Result<ResolvedRemoteUrl, String> {
    let url = Url::parse(input.trim()).map_err(|_| "remote.invalid_url".to_string())?;
    match url.scheme() {
        "https" => {}
        "http" if allow_http_once => {}
        "http" => return Err("remote.http_approval_required".to_string()),
        _ => return Err("remote.unsupported_scheme".to_string()),
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("remote.credentials_not_allowed".to_string());
    }
    let host = url
        .host_str()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "remote.host_missing".to_string())?
        .to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".localhost") {
        return Err("remote.private_address_blocked".to_string());
    }
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "remote.port_missing".to_string())?;
    let mut addresses = (host.as_str(), port)
        .to_socket_addrs()
        .map_err(|_| "remote.dns_failed".to_string())?
        .collect::<Vec<_>>();
    addresses.sort_unstable();
    addresses.dedup();
    if addresses.is_empty() {
        return Err("remote.dns_empty".to_string());
    }
    if addresses.iter().any(|address| !ip_is_public(address.ip())) {
        return Err("remote.private_address_blocked".to_string());
    }
    Ok(ResolvedRemoteUrl {
        url,
        host,
        addresses,
    })
}

pub(crate) fn blocking_get_with_policy(
    input: &str,
    allow_http_once: bool,
    connect_timeout: Duration,
    request_timeout: Duration,
    user_agent: &str,
) -> Result<Response, String> {
    let mut next_url = Url::parse(input.trim()).map_err(|_| "remote.invalid_url".to_string())?;
    for redirect_count in 0..=MAX_REDIRECTS {
        let resolved = resolve_remote_url(next_url.as_str(), allow_http_once)?;
        let response = reqwest::blocking::Client::builder()
            .connect_timeout(connect_timeout)
            .timeout(request_timeout)
            .redirect(Policy::none())
            .resolve_to_addrs(&resolved.host, &resolved.addresses)
            .user_agent(user_agent)
            .build()
            .map_err(|_| "remote.client_build_failed".to_string())?
            .get(resolved.url.clone())
            .send()
            .map_err(|error| format!("remote.request_failed:{error}"))?;
        if !response.status().is_redirection() {
            return Ok(response);
        }
        if redirect_count == MAX_REDIRECTS {
            return Err("remote.redirect_limit_exceeded".to_string());
        }
        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .ok_or_else(|| "remote.redirect_location_missing".to_string())?
            .to_str()
            .map_err(|_| "remote.redirect_location_invalid".to_string())?;
        next_url = resolved
            .url
            .join(location)
            .map_err(|_| "remote.redirect_url_invalid".to_string())?;
    }
    Err("remote.redirect_limit_exceeded".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_public_ipv4_ranges() {
        for input in [
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.1.1",
            "100.64.0.1",
            "198.18.0.1",
            "224.0.0.1",
        ] {
            assert!(!ip_is_public(input.parse().unwrap()), "{input}");
        }
        assert!(ip_is_public("1.1.1.1".parse().unwrap()));
    }

    #[test]
    fn rejects_non_public_ipv6_ranges() {
        for input in [
            "::1",
            "fe80::1",
            "fc00::1",
            "2001:db8::1",
            "::ffff:127.0.0.1",
        ] {
            assert!(!ip_is_public(input.parse().unwrap()), "{input}");
        }
        assert!(ip_is_public("2606:4700:4700::1111".parse().unwrap()));
    }

    #[test]
    fn http_requires_explicit_one_time_approval_before_dns() {
        let error = resolve_remote_url("http://localhost/document.pdf", false)
            .err()
            .expect("http should require approval");
        assert_eq!(error, "remote.http_approval_required");
    }

    #[test]
    fn blocks_direct_private_targets() {
        let error = resolve_remote_url("https://127.0.0.1/document.pdf", false)
            .err()
            .expect("private target should fail");
        assert_eq!(error, "remote.private_address_blocked");
    }
}
