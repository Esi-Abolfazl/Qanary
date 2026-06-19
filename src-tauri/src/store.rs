//! Loading and saving the persisted `Config` as JSON.
//!
//! The path comes from Tauri's per-app config dir (see `lib.rs`); on macOS that's
//! `~/Library/Application Support/Qanary/config.json`. On a missing or corrupt file we fall back
//! to `Config::default()` so the app always starts with the seeded lists.

use crate::models::{Config, Endpoint};
use std::fs;
use std::path::Path;

/// Read config from `path`, or return the seeded default if it's missing/unreadable/corrupt.
/// Automatically upgrades old single-endpoint configs to the `endpoints` shape.
pub fn load(path: &Path) -> Config {
    match fs::read_to_string(path) {
        Ok(contents) => {
            let mut cfg: Config = serde_json::from_str(&contents).unwrap_or_else(|err| {
                eprintln!("qanary: config at {path:?} is invalid ({err}); using defaults");
                Config::default()
            });
            migrate_legacy(&mut cfg);
            cfg
        }
        Err(_) => Config::default(),
    }
}

/// Fold legacy `{host, port}` fields into `endpoints` for services that predate the
/// multi-endpoint model. Called once on load; the next save writes the new shape.
fn migrate_legacy(cfg: &mut Config) {
    for list in cfg.lists.iter_mut() {
        for svc in list.services.iter_mut() {
            if svc.endpoints.is_empty() {
                if let Some(host) = svc.host.take() {
                    let port = svc.port.take().unwrap_or(443);
                    svc.endpoints.push(Endpoint::new(&host, port));
                }
            } else {
                // endpoints already present — just clear any stale legacy fields
                svc.host = None;
                svc.port = None;
            }
        }
    }
}

/// Write config to `path`, creating parent dirs as needed. Pretty-printed for hand-editing.
pub fn save(path: &Path, config: &Config) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(config).expect("config serializes");
    fs::write(path, json)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Saving then loading yields an equivalent config.
    #[test]
    fn round_trip() {
        let dir = std::env::temp_dir().join(format!("qanary-test-{}", uuid::Uuid::new_v4()));
        let path = dir.join("config.json");

        let original = Config::default();
        save(&path, &original).expect("save");
        let loaded = load(&path);

        assert_eq!(loaded.lists.len(), original.lists.len());
        assert_eq!(loaded.probe_interval_secs, original.probe_interval_secs);
        assert_eq!(loaded.lists[0].services.len(), original.lists[0].services.len());
        // Every service must survive round-trip with at least one endpoint.
        for svc in &loaded.lists[0].services {
            assert!(!svc.endpoints.is_empty());
        }
        assert_eq!(loaded.ip_providers.len(), original.ip_providers.len());

        fs::remove_dir_all(&dir).ok();
    }

    /// Legacy `{host, port}` JSON is migrated to `endpoints` on load.
    #[test]
    fn migrate_legacy_host_port() {
        let dir = std::env::temp_dir().join(format!("qanary-migrate-{}", uuid::Uuid::new_v4()));
        let path = dir.join("config.json");

        // Write old-style JSON with `host` and `port` at the service level, no `endpoints`.
        let legacy_json = r#"{
            "lists": [{
                "id": "l1",
                "name": "Test",
                "icon": "",
                "collapsed": false,
                "services": [{
                    "id": "s1",
                    "label": "Example",
                    "host": "example.com",
                    "port": 443,
                    "enabled": true
                }]
            }],
            "probe_interval_secs": 30,
            "timeout_ms": 3000,
            "ip_providers": []
        }"#;
        fs::create_dir_all(&dir).unwrap();
        fs::write(&path, legacy_json).unwrap();

        let cfg = load(&path);
        let svc = &cfg.lists[0].services[0];
        assert_eq!(svc.label, "Example");
        assert_eq!(svc.endpoints.len(), 1, "legacy host should be folded into one endpoint");
        assert_eq!(svc.endpoints[0].host, "example.com");
        assert_eq!(svc.endpoints[0].port, 443);

        fs::remove_dir_all(&dir).ok();
    }

    /// Missing file → seeded defaults (two lists: Global + Iran).
    #[test]
    fn missing_file_seeds_defaults() {
        let path = std::env::temp_dir().join("qanary-does-not-exist-xyz/config.json");
        let cfg = load(&path);
        assert_eq!(cfg.lists.len(), 2);
        assert_eq!(cfg.lists[0].name, "Global");
        assert_eq!(cfg.lists[1].name, "Iran");
    }
}
