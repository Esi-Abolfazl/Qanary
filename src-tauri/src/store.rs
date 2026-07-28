//! Loading and saving the persisted `Config` as JSON.
//!
//! The path comes from Tauri's per-app config dir (see `lib.rs`); on macOS that's
//! `~/Library/Application Support/Qanary/config.json`. On a missing or corrupt file we fall back
//! to `Config::default()` so the app always starts with the seeded lists.

use crate::models;
use crate::models::{Config, Endpoint, CURRENT_SCHEMA};
use std::fs;
use std::path::Path;

/// Read config from `path`, or return the seeded default if it's missing/unreadable/corrupt.
/// Runs `migrate` to bring any old config up to the current schema shape.
pub fn load(path: &Path) -> Config {
    match fs::read_to_string(path) {
        Ok(contents) => {
            let mut cfg: Config = serde_json::from_str(&contents).unwrap_or_else(|err| {
                eprintln!("qanary: config at {path:?} is invalid ({err}); using defaults");
                Config::default()
            });
            migrate(&mut cfg);
            normalize_alerts(&mut cfg);
            cfg
        }
        Err(_) => Config::default(),
    }
}

/// Run all pending schema migrations until `cfg.schema_version == CURRENT_SCHEMA`.
/// Called by `load()` and `import_config` so both paths share one upgrade chain.
///
/// Adding a new migration step:
///   1. Bump `CURRENT_SCHEMA` in `models.rs`.
///   2. Add a new `match` arm here for the old version number.
/// Additive fields with `#[serde(default)]` do NOT need a step — serde fills the default.
pub fn migrate(cfg: &mut Config) {
    while cfg.schema_version < CURRENT_SCHEMA {
        match cfg.schema_version {
            0 => {
                // Step 0→1: fold legacy {host, port} fields into the `endpoints` vec.
                // Configs written before the multi-endpoint model stored a single host+port
                // at the service level; this moves them into endpoints[0].
                for list in cfg.lists.iter_mut() {
                    for svc in list.services.iter_mut() {
                        if svc.endpoints.is_empty() {
                            if let Some(host) = svc.host.take() {
                                let port = svc.port.take().unwrap_or(443);
                                svc.endpoints.push(Endpoint::new(&host, port));
                            }
                        } else {
                            // endpoints already present — clear any stale legacy fields
                            svc.host = None;
                            svc.port = None;
                        }
                    }
                }
            }
            _ => break, // unknown future version — stop; import_config rejects these
        }
        cfg.schema_version += 1;
    }
}

/// Bring the alert settings into a legal shape: clamp `notify_volume` to `0..=100`, catching a
/// hand-edited or imported `101..=255`. Runs on load, on import, and on every settings write.
///
/// `notify_volume` and the three `*_sound` flags are **independent** (ADR-0028): volume `0` mutes
/// the audio and leaves the flags alone, so `{notify_volume: 0, blocked_sound: true}` is a legal
/// state. It stays honest because the frontend never reads a `*_sound` flag as "audible" on its
/// own — `alerts.ts::soundAudible` is the single predicate for that, and it is what
/// `effectiveDir` / `fireBatch` consult, so a muted channel cannot outrank a channel the user
/// can actually perceive (the ADR-0023 guarantee). Earlier this file cleared the flags at
/// volume 0 to reach the same end; that made the volume destroy configuration (ADR-0026).
pub fn normalize_alerts(cfg: &mut Config) {
    cfg.notify_volume = models::clamp_volume(cfg.notify_volume);
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
    use crate::models::CURRENT_SCHEMA;

    /// Saving then loading yields an equivalent config, including schema_version.
    #[test]
    fn round_trip() {
        let dir = std::env::temp_dir().join(format!("qanary-test-{}", uuid::Uuid::new_v4()));
        let path = dir.join("config.json");

        let original = Config::default();
        save(&path, &original).expect("save");
        let loaded = load(&path);

        assert_eq!(loaded.lists.len(), original.lists.len());
        assert_eq!(loaded.critical_interval_secs, original.critical_interval_secs);
        assert_eq!(loaded.noncritical_interval_secs, original.noncritical_interval_secs);
        assert_eq!(loaded.lists[0].services.len(), original.lists[0].services.len());
        // Every service must survive round-trip with at least one endpoint.
        for svc in &loaded.lists[0].services {
            assert!(!svc.endpoints.is_empty());
        }
        assert_eq!(loaded.ip_providers.len(), original.ip_providers.len());
        // schema_version must survive the round-trip intact.
        assert_eq!(loaded.schema_version, original.schema_version);

        fs::remove_dir_all(&dir).ok();
    }

    /// Legacy `{host, port}` JSON (schema_version = 0 by default) is migrated to
    /// `endpoints` on load and ends up at CURRENT_SCHEMA.
    #[test]
    fn migrate_legacy_host_port() {
        let dir = std::env::temp_dir().join(format!("qanary-migrate-{}", uuid::Uuid::new_v4()));
        let path = dir.join("config.json");

        // Write old-style JSON with `host` and `port` at the service level, no `endpoints`,
        // and no `schema_version` (serde default → 0, which triggers step 0→1).
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
        // After migration, schema_version must be stamped to the current version.
        assert_eq!(cfg.schema_version, CURRENT_SCHEMA, "migrated config should reach CURRENT_SCHEMA");

        fs::remove_dir_all(&dir).ok();
    }

    /// A config without schema_version (old file) loads and ends up at CURRENT_SCHEMA.
    #[test]
    fn no_schema_version_migrates_to_current() {
        let dir = std::env::temp_dir().join(format!("qanary-noschema-{}", uuid::Uuid::new_v4()));
        let path = dir.join("config.json");

        // Minimal valid config with no schema_version field — simulates a pre-versioning save.
        let json = r#"{"lists":[],"timeout_ms":3000,"ip_providers":[]}"#;
        fs::create_dir_all(&dir).unwrap();
        fs::write(&path, json).unwrap();

        let cfg = load(&path);
        assert_eq!(cfg.schema_version, CURRENT_SCHEMA);

        fs::remove_dir_all(&dir).ok();
    }

    /// `migrate` rejects schema_version values above CURRENT_SCHEMA (stops at the unknown arm).
    /// The runner must NOT infinite-loop on a future version.
    #[test]
    fn migrate_stops_on_unknown_version() {
        let mut cfg = Config::default();
        cfg.schema_version = CURRENT_SCHEMA + 5; // simulate a newer-app config
        migrate(&mut cfg);
        // Must still be above CURRENT_SCHEMA — the _ arm breaks without touching it.
        assert!(cfg.schema_version > CURRENT_SCHEMA);
    }

    /// `clamp_volume` clamps to 0..=100; step is 1, so in-range values pass through unchanged.
    #[test]
    fn clamp_volume_clamps_to_0_100() {
        use crate::models::clamp_volume;
        assert_eq!(clamp_volume(0), 0);
        assert_eq!(clamp_volume(1), 1);
        assert_eq!(clamp_volume(37), 37);
        assert_eq!(clamp_volume(100), 100);
        // Out of range (hand-edited) values clamp down to 100 rather than wrapping.
        assert_eq!(clamp_volume(101), 100);
        assert_eq!(clamp_volume(255), 100);
    }

    /// Volume 0 is a mute, not a reset: the three `*_sound` flags survive it, so raising the
    /// volume again restores exactly the directions the user had configured (ADR-0028).
    #[test]
    fn normalize_alerts_zero_volume_keeps_sound_flags() {
        let mut cfg = Config::default();
        cfg.notify_volume = 0;
        cfg.down_sound = true;
        cfg.up_sound = true;
        cfg.blocked_sound = true;

        normalize_alerts(&mut cfg);

        assert_eq!(cfg.notify_volume, 0);
        assert!(cfg.down_sound);
        assert!(cfg.up_sound);
        assert!(cfg.blocked_sound);
    }

    /// An out-of-range volume is clamped, and the sound flags are never touched.
    #[test]
    fn normalize_alerts_clamps_without_touching_flags() {
        let mut cfg = Config::default();
        cfg.notify_volume = 137;
        cfg.down_sound = true;

        normalize_alerts(&mut cfg);

        assert_eq!(cfg.notify_volume, 100);
        assert!(cfg.down_sound, "clamping must not change the flags");
    }

    /// All flags off does NOT lower the stored volume, so the user's remembered level survives
    /// turning every sound alert off and back on.
    #[test]
    fn normalize_alerts_keeps_volume_when_all_flags_off() {
        let mut cfg = Config::default();
        cfg.notify_volume = 100;
        cfg.down_sound = false;
        cfg.up_sound = false;
        cfg.blocked_sound = false;

        normalize_alerts(&mut cfg);

        assert_eq!(cfg.notify_volume, 100);
    }

    /// A saved out-of-range volume is clamped when the config is loaded from disk.
    #[test]
    fn load_clamps_stored_volume() {
        let dir = std::env::temp_dir().join(format!("qanary-volume-{}", uuid::Uuid::new_v4()));
        let path = dir.join("config.json");

        let mut original = Config::default();
        original.notify_volume = 137;
        save(&path, &original).expect("save");

        assert_eq!(load(&path).notify_volume, 100);

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
