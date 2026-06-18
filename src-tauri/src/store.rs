//! Loading and saving the persisted `Config` as JSON.
//!
//! The path comes from Tauri's per-app config dir (see `lib.rs`); on macOS that's
//! `~/Library/Application Support/Qanary/config.json`. On a missing or corrupt file we fall back
//! to `Config::default()` so the app always starts with the seeded lists.

use crate::models::Config;
use std::fs;
use std::path::Path;

/// Read config from `path`, or return the seeded default if it's missing/unreadable/corrupt.
pub fn load(path: &Path) -> Config {
    match fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_else(|err| {
            eprintln!("qanary: config at {path:?} is invalid ({err}); using defaults");
            Config::default()
        }),
        Err(_) => Config::default(),
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
        assert_eq!(loaded.ip_providers.len(), original.ip_providers.len());

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
