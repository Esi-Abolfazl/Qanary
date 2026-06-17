//! WAN IP + geolocation lookup for the header.
//!
//! Strategy: try each provider URL in order, GET as plain text, validate with
//! `IpAddr::from_str`. First valid IP wins. Then geolocate that IP via ipwho.is
//! for country/flag (egress-independent — the IP is explicit in the URL).

use crate::models::WanInfo;
use serde::Deserialize;
use std::net::IpAddr;
use std::time::Duration;

/// Per-provider request timeout. Keeps total WAN resolution fast even when
/// one provider hangs: 3 providers × 4 s = 12 s worst case instead of 15 s+.
const PROVIDER_TIMEOUT: Duration = Duration::from_secs(4);

/// Convert a 2-letter ISO country code into its flag emoji (e.g. "IR" → 🇮🇷).
/// Returns an empty string for anything that isn't two ASCII letters.
pub fn flag_emoji(country_code: &str) -> String {
    let cc = country_code.trim().to_uppercase();
    if cc.len() != 2 || !cc.chars().all(|c| c.is_ascii_alphabetic()) {
        return String::new();
    }
    // 'A' maps to the regional indicator symbol U+1F1E6, 'B' to the next, and so on.
    const BASE: u32 = 0x1F1E6 - ('A' as u32);
    cc.chars()
        .filter_map(|c| char::from_u32(BASE + c as u32))
        .collect()
}

#[derive(Deserialize)]
struct IpWhoResponse {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    country: String,
    #[serde(default)]
    country_code: String,
}

/// Look up WAN IP by trying providers in order, then geolocate the resolved IP.
/// Returns `None` only if every provider fails (e.g. fully offline).
pub async fn fetch_wan(client: &reqwest::Client, providers: &[String]) -> Option<WanInfo> {
    let ip = resolve_ip(client, providers).await?;
    Some(geolocate(client, &ip).await.unwrap_or(WanInfo {
        ip: ip.clone(),
        country_code: String::new(),
        country_name: String::new(),
        flag_emoji: String::new(),
    }))
}

/// Try each provider in order. Providers are stored without scheme; prepend https://.
async fn resolve_ip(client: &reqwest::Client, providers: &[String]) -> Option<String> {
    for host_path in providers {
        let url = format!("https://{host_path}");
        if let Some(ip) = try_provider(client, &url).await {
            return Some(ip);
        }
    }
    None
}

async fn try_provider(client: &reqwest::Client, url: &str) -> Option<String> {
    let text = client.get(url).timeout(PROVIDER_TIMEOUT).send().await.ok()?.text().await.ok()?;
    let trimmed = text.trim();
    // Validate: only accept if it parses as an IP address.
    trimmed.parse::<IpAddr>().ok()?;
    Some(trimmed.to_string())
}

async fn geolocate(client: &reqwest::Client, ip: &str) -> Option<WanInfo> {
    let url = format!("https://ipwho.is/{ip}");
    let resp: IpWhoResponse = client.get(&url).send().await.ok()?.json().await.ok()?;
    if !resp.success {
        return None;
    }
    Some(WanInfo {
        flag_emoji: flag_emoji(&resp.country_code),
        ip: ip.to_string(),
        country_name: resp.country,
        country_code: resp.country_code,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flag_for_valid_code() {
        assert_eq!(flag_emoji("IR"), "🇮🇷");
        assert_eq!(flag_emoji("us"), "🇺🇸"); // case-insensitive
    }

    #[test]
    fn flag_for_invalid_code_is_empty() {
        assert_eq!(flag_emoji(""), "");
        assert_eq!(flag_emoji("USA"), "");
        assert_eq!(flag_emoji("1!"), "");
    }

    #[test]
    fn ip_parse_guard_accepts_valid_rejects_garbage() {
        assert!("1.2.3.4".parse::<IpAddr>().is_ok());
        assert!("2001:db8::1".parse::<IpAddr>().is_ok());
        assert!("<html>".parse::<IpAddr>().is_err());
        assert!("not-an-ip".parse::<IpAddr>().is_err());
        assert!("{\"ip\":\"1.2.3.4\"}".parse::<IpAddr>().is_err());
    }
}
