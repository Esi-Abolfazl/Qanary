//! WAN IP + geolocation lookup for the header.
//!
//! Uses free, key-less endpoints: `ip-api.com/json` first, falling back to `ipinfo.io/json`.
//! The flag is computed from the ISO country code (no image assets — Unicode regional indicators).

use crate::models::WanInfo;
use serde::Deserialize;

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

/// Shape of an `ip-api.com/json` success response (only the fields we use).
#[derive(Deserialize)]
struct IpApiResponse {
    status: String,
    query: String,
    country: String,
    #[serde(rename = "countryCode")]
    country_code: String,
}

/// Shape of an `ipinfo.io/json` response. `country` is an ISO code; there's no country name.
#[derive(Deserialize)]
struct IpInfoResponse {
    ip: String,
    #[serde(default)]
    country: String,
}

/// Look up the current WAN IP + location, trying the primary then the fallback provider.
/// Returns `None` only if both fail (e.g. fully offline).
pub async fn fetch_wan(client: &reqwest::Client) -> Option<WanInfo> {
    if let Some(info) = fetch_ip_api(client).await {
        return Some(info);
    }
    fetch_ipinfo(client).await
}

async fn fetch_ip_api(client: &reqwest::Client) -> Option<WanInfo> {
    let resp: IpApiResponse = client
        .get("http://ip-api.com/json/?fields=status,query,country,countryCode")
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    if resp.status != "success" {
        return None;
    }
    Some(WanInfo {
        flag_emoji: flag_emoji(&resp.country_code),
        ip: resp.query,
        country_name: resp.country,
        country_code: resp.country_code,
    })
}

async fn fetch_ipinfo(client: &reqwest::Client) -> Option<WanInfo> {
    let resp: IpInfoResponse = client
        .get("https://ipinfo.io/json")
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    Some(WanInfo {
        flag_emoji: flag_emoji(&resp.country),
        ip: resp.ip,
        // ipinfo only gives the code; reuse it as the display name.
        country_name: resp.country.clone(),
        country_code: resp.country,
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
}
