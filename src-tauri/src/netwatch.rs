//! Network-change watcher — triggers an immediate probe round when the OS network state changes.
//!
//! # Why this exists
//!
//! Without this, probes fire only on the per-Service interval timer (30 s / 60 s). A user who
//! connects a VPN or plugs in ethernet sees stale status for up to a minute. This module makes
//! Qanary probe immediately when the network changes.
//!
//! # How it works
//!
//! Two detection layers feed a shared `tokio::sync::mpsc` channel:
//!
//! 1. **`if-watch`** (all platforms): wraps OS-native interface events — netlink on Linux,
//!    `NotifyIpInterfaceChange` on Windows. On macOS it falls back to a ~10 s poll (no event
//!    backend), so it serves only as a cheap backstop there.
//!
//! 2. **SCDynamicStore** (`#[cfg(target_os = "macos")]`): the primary macOS source. Watches
//!    `State:/Network/Global/IPv4`, `State:/Network/Interface/.*/IPv4`, and
//!    `State:/Network/Service/.*/IPv4` — catching wifi/ethernet interface changes AND split-tunnel
//!    VPN route changes that don't change interface IPs. Latency ≈ 1 s.
//!    The SCDynamicStore callback API requires a `CFRunLoop`. This does not exist on tokio worker
//!    threads, so the watcher runs on a dedicated OS thread with its own `CFRunLoop`.
//!
//! A **debounce loop** waits for the first `()` from either watcher, sleeps 500 ms while draining
//! any extras (VPN bring-up fires several route changes at once), then calls `trigger` exactly once.
//!
//! `trigger` reuses the same path as the manual refresh button (`refresh_now` command):
//! `emit_checking` paints all services Checking for instant UI feedback, then `probe_now.send(())`
//! wakes every Service probe task and the WAN task simultaneously.
//!
//! Watcher errors are logged and cause that layer to exit; the interval timer and the other layer
//! keep the app functional.

use crate::{emit_checking, state::AppState};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::sync::mpsc;

// ── Public entry point ────────────────────────────────────────────────────────

/// Spawn the network-change watcher. Called once from `setup`, after `spawn_wan_task`.
///
/// Creates the shared debounce channel, starts the debounce consumer loop, then starts each
/// detection layer with a clone of the channel sender.
pub fn spawn_netwatch_task(app: &AppHandle) {
    // Channel into which every watcher sends () on a detected network change.
    // The debounce loop on the other end coalesces bursts into single probe rounds.
    // Capacity 8: generous for any realistic event burst; each send is cheap.
    let (tx, rx) = mpsc::channel::<()>(8);

    // Consumer: waits for events, debounces, then triggers a probe round.
    spawn_debounce_loop(app.clone(), rx);

    // Producer 1 — all platforms (event-driven on Linux/Windows; ~10 s poll on macOS).
    spawn_ifwatch_watcher(tx.clone());

    // Producer 2 — macOS only (event-driven SCDynamicStore; primary mac source).
    #[cfg(target_os = "macos")]
    spawn_sc_watcher(tx);
}

// ── Trigger (mirrors `refresh_now`) ──────────────────────────────────────────

/// Fire one probe round. Mirrors `commands::refresh_now` exactly:
/// 1. `emit_checking` paints all services Checking and emits a `status-update` for instant
///    UI feedback (the spinning indicator appears before any probe result comes back).
/// 2. `probe_now.send(())` wakes every subscribed Service probe task and the WAN task.
///
/// `Err` on send means no subscribers yet — harmless.
fn trigger(app: &AppHandle) {
    eprintln!("netwatch: probe triggered"); // observable signal for §5 manual smoke tests
    emit_checking(app);
    let _ = app.state::<AppState>().probe_now.send(());
}

// ── Debounce loop ─────────────────────────────────────────────────────────────

/// Spawn the debounce consumer loop as a tokio task.
///
/// Algorithm (per cycle):
/// 1. Block on `rx.recv()` — wait for the first network-change event.
/// 2. Sleep 500 ms.
/// 3. Drain any extras that arrived during the window (discarded; already "inside" the burst).
/// 4. Call `trigger` once.
///
/// This turns a flurry of events (e.g. VPN bring-up fires multiple route changes within
/// milliseconds) into a single probe round.
fn spawn_debounce_loop(app: AppHandle, mut rx: mpsc::Receiver<()>) {
    tauri::async_runtime::spawn(async move {
        loop {
            // Wait for at least one network-change event from any watcher.
            if rx.recv().await.is_none() {
                // All senders dropped (both watcher tasks/threads exited). Nothing left.
                eprintln!("netwatch: all senders dropped; debounce loop exiting");
                break;
            }

            // Drain any burst extras that arrive during the 500 ms window.
            tokio::time::sleep(Duration::from_millis(500)).await;
            while rx.try_recv().is_ok() {
                // discard — collapsed into the single trigger below
            }

            trigger(&app);
        }
    });
}

// ── if-watch watcher (all platforms) ─────────────────────────────────────────

/// Drive the `if-watch` interface-event stream and forward each event into the debounce channel.
///
/// Uses `if_watch::tokio::IfWatcher`, which implements `futures_core::Stream<Item = io::Result<IfEvent>>`.
/// On macOS this is a ~10 s polling backstop; on Linux/Windows it is event-driven.
///
/// On any error, logs and exits (the other watcher + interval timer keep the app alive).
fn spawn_ifwatch_watcher(tx: mpsc::Sender<()>) {
    tauri::async_runtime::spawn(async move {
        use futures_util::StreamExt as _;

        let watcher = match if_watch::tokio::IfWatcher::new() {
            Ok(w) => w,
            Err(err) => {
                eprintln!("netwatch: if-watch init failed: {err}");
                return; // interval timer + SCDynamicStore remain
            }
        };
        // Pin on the stack: Stream::poll_next requires Pin<&mut Self>.
        // tokio::pin! is available without the futures crate.
        tokio::pin!(watcher);

        loop {
            match watcher.next().await {
                Some(Ok(_event)) => {
                    // Forward the interface-change event into the debounce channel.
                    if tx.send(()).await.is_err() {
                        // Debounce receiver dropped (debounce loop exited).
                        break;
                    }
                }
                Some(Err(err)) => {
                    eprintln!("netwatch: if-watch stream error: {err}");
                    break; // interval timer + SCDynamicStore remain
                }
                None => {
                    // Stream ended (unexpected for if-watch).
                    eprintln!("netwatch: if-watch stream ended unexpectedly");
                    break;
                }
            }
        }
    });
}

// ── SCDynamicStore watcher (macOS only) ──────────────────────────────────────

/// Watch macOS network configuration changes via `SCDynamicStore`.
///
/// Monitors:
/// - `State:/Network/Global/IPv4`           — default route / primary interface (wifi on/off,
///                                            ethernet plug/unplug)
/// - `State:/Network/Interface/.*/IPv4`     — per-interface IP changes (tunnels, aliases)
/// - `State:/Network/Service/.*/IPv4`       — per-service route changes (split-tunnel VPNs
///                                            that add routes without changing interface IPs)
///
/// The `SCDynamicStore` callback requires a `CFRunLoop` that does NOT exist on tokio worker
/// threads. We run this entire watcher on its own `std::thread` with `CFRunLoop::run_current()`.
/// Events are forwarded into the `mpsc` channel via `tx.blocking_send(())` (safe on an OS thread).
///
/// The `system-configuration` crate provides a safe callback wrapper (`SCDynamicStoreCallBackT`)
/// that takes a normal Rust fn with `info: &mut T` — no unsafe pointers needed.
#[cfg(target_os = "macos")]
fn spawn_sc_watcher(tx: mpsc::Sender<()>) {
    use core_foundation::{
        array::CFArray,
        runloop::{kCFRunLoopDefaultMode, CFRunLoop},
        string::CFString,
    };
    use system_configuration::dynamic_store::{
        SCDynamicStoreBuilder, SCDynamicStoreCallBackContext,
    };

    std::thread::spawn(move || {
        // The safe callback signature provided by system-configuration 0.6:
        // `fn(store: SCDynamicStore, changed_keys: CFArray<CFString>, info: &mut T)`
        // Our T = mpsc::Sender<()>; no unsafe needed.
        fn on_network_change(
            _store: system_configuration::dynamic_store::SCDynamicStore,
            _changed_keys: CFArray<CFString>,
            sender: &mut mpsc::Sender<()>,
        ) {
            // blocking_send: safe because we are on a dedicated OS thread, not tokio.
            let _ = sender.blocking_send(());
        }

        // Build the store. The `callback_context` call owns `tx`; the crate boxes it and
        // passes a pointer to it on each callback invocation.
        let store = SCDynamicStoreBuilder::new("qanary-netwatch")
            .callback_context(SCDynamicStoreCallBackContext {
                callout: on_network_change,
                info: tx, // moved in; the crate boxes + frees it on drop
            })
            .build();

        // Exact keys (literal match):
        let keys: CFArray<CFString> = CFArray::from_CFTypes(&[
            CFString::new("State:/Network/Global/IPv4"),
        ]);

        // Pattern keys (shell-glob style; '.*' matches any sub-path segment):
        let patterns: CFArray<CFString> = CFArray::from_CFTypes(&[
            CFString::new("State:/Network/Interface/.*/IPv4"), // per-interface IP change
            CFString::new("State:/Network/Service/.*/IPv4"),   // split-tunnel VPN route change
        ]);

        // Register the keys and patterns we want to be notified about.
        if !store.set_notification_keys(&keys, &patterns) {
            eprintln!("netwatch: SCDynamicStore failed to register notification keys; exiting");
            return; // if-watch backstop + interval timer remain
        }

        // Attach the store's notification source to this thread's run loop.
        let source = store.create_run_loop_source();
        let run_loop = CFRunLoop::get_current();
        // SAFETY: kCFRunLoopDefaultMode is a valid static CFStringRef guaranteed by the OS.
        run_loop.add_source(&source, unsafe { kCFRunLoopDefaultMode });

        // Block this thread in the CFRunLoop, firing `on_network_change` on each key change.
        // This call does not return for the lifetime of the app process.
        CFRunLoop::run_current();
    });
}
