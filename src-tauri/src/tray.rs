//! System-tray helpers for Qanary.
//!
//! `build_tray` creates the menu-bar icon and wires all interactions:
//!   - Icon colour reflects `Severity` (green / amber / red traffic light).
//!   - Left-click → toggle main window.
//!   - Context menu → Show / Hide · Refresh now · Quit.
//! Icon pixels are generated at runtime — no binary asset files.
//!
//! Call `build_tray` once inside `setup()` **before** the first `emit_checking`
//! so the tray handle exists when `update_icon` is first invoked.

use crate::models::Severity;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

/// Generation counter for the breathing animation. `update_checking` claims the next
/// value and animates while it stays current; any later `update_icon`/`update_checking`
/// bumps it, which stops the previous loop. (Lets us cancel without channels.)
static ANIM_GEN: AtomicU64 = AtomicU64::new(0);

/// Context-menu item identifiers.
const ID_SHOW_HIDE: &str = "show_hide";
const ID_REFRESH: &str = "refresh_now";
const ID_QUIT: &str = "quit";

/// Palette colours, matching `src/tokens.css` (the authoritative source):
///   Green  #1fb872 (--state-up) · Yellow #f2792b (--state-blocked) · Red #e03131 (--state-down)
fn severity_rgb(sev: Severity) -> (u8, u8, u8) {
    match sev {
        Severity::Green => (0x1f, 0xb8, 0x72),
        Severity::Yellow => (0xf2, 0x79, 0x2b),
        Severity::Red => (0xe0, 0x31, 0x31),
    }
}

/// Brand yellow (#ffcc00, --brand) — the "busy/checking" colour the in-app status
/// button breathes via `.status-btn-dot.qbreathe`, and the golden frame border the
/// button shows in the green state (`.status-btn { border: 1px solid var(--brand) }`).
const BRAND_RGB: (u8, u8, u8) = (0xff, 0xcc, 0x00);

/// Frame-border colour per severity, matching `.status-btn` borders in `src/App.css`:
/// green → brand gold; yellow/red → the severity colour (so the ring blends into the dot).
fn border_rgb(sev: Severity) -> (u8, u8, u8) {
    match sev {
        Severity::Green => BRAND_RGB,
        other => severity_rgb(other),
    }
}

/// Tray icon for the Severity traffic-light state (static, full opacity).
pub fn severity_icon(sev: Severity) -> tauri::image::Image<'static> {
    draw_icon(severity_rgb(sev), border_rgb(sev), 1.0)
}

/// One breathing frame of the busy/checking icon — brand yellow, `pulse` in 0..1
/// scales the glow + opacity so the dot appears to breathe like `qbreathe`.
fn checking_frame(pulse: f32) -> tauri::image::Image<'static> {
    draw_icon(BRAND_RGB, BRAND_RGB, pulse)
}

/// Draw a 22×22 RGBA image shaped like the in-app status button: a rounded-square
/// ("squircle") `dot` with a `border` ring and a soft outer glow — mirroring
/// `.status-btn` (golden frame) + `.status-btn-dot` (glowing dot) in `src/App.css`.
/// `pulse` (0..1) dims the whole icon for the breathing animation; 1.0 = static.
///
/// ponytail: runtime-drawn squircle + glow; swap to `Image::from_path` if designed art
///           is wanted. Rebuilt on every icon update; no last-severity guard.
fn draw_icon(
    dot: (u8, u8, u8),
    border: (u8, u8, u8),
    pulse: f32,
) -> tauri::image::Image<'static> {
    // 2× supersample → render at 44px, then box-downsample to 22px for clean AA.
    const SIZE: u32 = 22;
    const SS: u32 = 2;
    const HI: u32 = SIZE * SS; // 44

    // The frame ring is drawn OUTSIDE the dot, so the coloured dot keeps the same
    // `half` size in every state (green isn't shrunk by its golden border). States
    // whose border == dot colour get no visible ring.
    let has_border = border != dot;
    let (dr, dg, db) = (dot.0 as f32, dot.1 as f32, dot.2 as f32);
    let (br, bg, bb) = (border.0 as f32, border.1 as f32, border.2 as f32);

    // Geometry in hi-res pixels. Squircle centred, leaving room for ring + glow.
    let cx = HI as f32 / 2.0;
    let cy = HI as f32 / 2.0;
    let half = HI as f32 * 0.32; // dot half-extent (same for all states)
    let corner = HI as f32 * 0.11; // rounded corners
    let border_w = if has_border { HI as f32 * 0.045 } else { 0.0 }; // thin golden ring
    let glow = HI as f32 * 0.14; // soft halo reach beyond the outer edge

    // Signed distance to a rounded square (negative inside).
    let sd_round_rect = |px: f32, py: f32| -> f32 {
        let qx = (px - cx).abs() - (half - corner);
        let qy = (py - cy).abs() - (half - corner);
        let ox = qx.max(0.0);
        let oy = qy.max(0.0);
        (ox * ox + oy * oy).sqrt() + qx.max(qy).min(0.0) - corner
    };

    let mut hi = vec![0u8; (HI * HI * 4) as usize];
    for py in 0..HI {
        for px in 0..HI {
            let d = sd_round_rect(px as f32 + 0.5, py as f32 + 0.5);
            // cov_fill = the dot at `half`; cov_ring = dot expanded outward by the
            // border. The band between them is the ring, sitting OUTSIDE the dot.
            let cov_fill = (0.5 - d).clamp(0.0, 1.0);
            let cov_ring = (0.5 - (d - border_w)).clamp(0.0, 1.0);
            let mix = if cov_ring > 0.0 {
                ((cov_ring - cov_fill) / cov_ring).clamp(0.0, 1.0)
            } else {
                0.0
            };
            // Blend dot → border across the outer ring band.
            let mut cr = dr * (1.0 - mix) + br * mix;
            let mut cg = dg * (1.0 - mix) + bg * mix;
            let mut cb = db * (1.0 - mix) + bb * mix;
            let mut alpha = cov_ring;
            // Glow beyond the outer (ring) edge, in the border colour.
            if d > border_w && d < border_w + glow {
                let t = 1.0 - (d - border_w) / glow;
                let halo = t * t * 0.55;
                if halo > alpha {
                    alpha = halo;
                    cr = br;
                    cg = bg;
                    cb = bb;
                }
            }
            alpha *= pulse.clamp(0.0, 1.0);
            let i = ((py * HI + px) * 4) as usize;
            hi[i] = cr as u8;
            hi[i + 1] = cg as u8;
            hi[i + 2] = cb as u8;
            hi[i + 3] = (alpha * 255.0).round() as u8;
        }
    }

    // Box-downsample SS×SS → final RGBA.
    let mut rgba = vec![0u8; (SIZE * SIZE * 4) as usize];
    for y in 0..SIZE {
        for x in 0..SIZE {
            let (mut sr, mut sg, mut sb, mut sa) = (0u32, 0u32, 0u32, 0u32);
            for dy in 0..SS {
                for dx in 0..SS {
                    let i = (((y * SS + dy) * HI + (x * SS + dx)) * 4) as usize;
                    sr += hi[i] as u32;
                    sg += hi[i + 1] as u32;
                    sb += hi[i + 2] as u32;
                    sa += hi[i + 3] as u32;
                }
            }
            let n = (SS * SS) as u32;
            let o = ((y * SIZE + x) * 4) as usize;
            rgba[o] = (sr / n) as u8;
            rgba[o + 1] = (sg / n) as u8;
            rgba[o + 2] = (sb / n) as u8;
            rgba[o + 3] = (sa / n) as u8;
        }
    }
    tauri::image::Image::new_owned(rgba, SIZE, SIZE)
}

/// Update the tray icon to reflect the current `Severity`.
/// Cancels any running breathing animation. No-op if the tray doesn't exist yet.
pub fn update_icon(app: &AppHandle, sev: Severity) {
    ANIM_GEN.fetch_add(1, Ordering::SeqCst); // stop any breathing loop
    set_tray_image(app, severity_icon(sev));
}

/// Start the busy/checking state: a breathing brand-yellow dot, mirroring the status
/// button's `qbreathe`. Animates on a background task until the next `update_icon`
/// (cycle settles) or `update_checking` supersedes it.
pub fn update_checking(app: &AppHandle) {
    let generation = ANIM_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut t: f32 = 0.0;
        // ponytail: ~11 fps sine pulse; cheap, stops the instant the cycle settles.
        while ANIM_GEN.load(Ordering::SeqCst) == generation {
            // Breathe opacity 0.45 → 1.0 and back, like qbreathe's scale/opacity.
            let pulse = 0.45 + 0.55 * (0.5 - 0.5 * t.cos());
            set_tray_image(&app, checking_frame(pulse));
            t += 0.5;
            tokio::time::sleep(Duration::from_millis(90)).await;
        }
    });
}

fn set_tray_image(app: &AppHandle, img: tauri::image::Image<'static>) {
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_icon(Some(img));
        // Re-assert: set_icon can reset the template flag, which would strip our colour.
        let _ = tray.set_icon_as_template(false);
    }
}

/// Toggle the main window: hide if visible, show + focus if hidden.
fn toggle_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Center pixel is the solid Severity colour; corners are transparent (squircle shape).
    #[test]
    fn icon_is_a_colored_squircle() {
        let img = severity_icon(Severity::Red);
        let (w, h) = (img.width(), img.height());
        assert_eq!((w, h), (22, 22));
        let px = img.rgba();
        let at = |x: u32, y: u32| {
            let i = ((y * w + x) * 4) as usize;
            (px[i], px[i + 1], px[i + 2], px[i + 3])
        };
        // Center: opaque red (#e03131).
        let (r, g, b, a) = at(w / 2, h / 2);
        assert_eq!((r, g, b), (0xe0, 0x31, 0x31));
        assert_eq!(a, 255);
        // Corner: fully transparent — proves it's not a full square.
        assert_eq!(at(0, 0).3, 0);

        // Yellow renders its own (distinct) colour at full opacity — not red.
        let yimg = severity_icon(Severity::Yellow);
        let yp = yimg.rgba();
        let ci = ((h / 2 * w + w / 2) * 4) as usize;
        let ycenter = (yp[ci], yp[ci + 1], yp[ci + 2], yp[ci + 3]);
        assert_eq!(ycenter.3, 255);
        assert_ne!((ycenter.0, ycenter.1, ycenter.2), (0xe0, 0x31, 0x31));
    }
}

/// Build and register the tray icon and its context menu.
///
/// Must be called once inside `setup()`, before the first `emit_checking`.
pub fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, ID_SHOW_HIDE, "Show / Hide", true, None::<&str>)?,
            &MenuItem::with_id(app, ID_REFRESH, "Refresh now", true, None::<&str>)?,
            &MenuItem::with_id(app, ID_QUIT, "Quit", true, None::<&str>)?,
        ],
    )?;

    TrayIconBuilder::with_id("main")
        .icon(severity_icon(Severity::Green))
        // macOS renders tray icons as monochrome template images by default, which
        // strips the colour. Keep our RGBA colours so the traffic-light reads.
        .icon_as_template(false)
        .menu(&menu)
        // macOS shows the menu on left-click by default; we want click = toggle window.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            ID_SHOW_HIDE => toggle_window(app),
            ID_REFRESH => {
                // Mirror the in-app refresh_now command: flash the checking state so the
                // UI visibly reacts, then probe everything + refresh WAN.
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    crate::emit_checking(&handle);
                    crate::run_cycle(&handle, true).await;
                });
            }
            ID_QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Click fires for both press and release; handle only Up to avoid
            // toggling twice per click.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}
