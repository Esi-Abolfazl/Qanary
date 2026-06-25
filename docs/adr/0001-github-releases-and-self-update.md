# 0001. Distribute Qanary via GitHub Releases and self-update with Tauri's official updater

- **Status:** accepted
- **Date:** 2026-06-16
- **Deciders:** Esi-Abolfazl

## Context

Qanary had no distribution mechanism and no way for existing installs to update themselves.
Users needed both a download page and an in-app update path. The project is macOS-first
(per CLAUDE.md), open-source on GitHub, and does not have an Apple Developer account for
notarization. Tauri v2 ships a first-party updater plugin and a companion GitHub Action
(`tauri-action`) that together handle signing, manifest generation, and release publishing —
making this a low-infrastructure choice that fits the project's stage.

## Decision

Use `tauri-apps/tauri-action@v0` triggered on `push: tags: v*` to build macOS aarch64 +
x86_64 binaries, sign them with a minisign keypair stored in GitHub Secrets, and publish
them as a non-draft GitHub Release. The release includes `.dmg` installers, `.app.tar.gz`
updater bundles with `.sig` files, and a `latest.json` manifest at a stable URL.

For in-app updates, use `tauri-plugin-updater` polling `releases/latest/download/latest.json`.
The app checks silently on startup and shows a banner if an update is available; a manual
"Check for updates" button is always present. The user confirms before install; the app then
calls `tauri-plugin-process` to relaunch after installation.

Apple code signing and notarization are skipped for now. The updater's own minisign
signature is independent of Apple signing and is sufficient for verifying update integrity.

## Alternatives considered

- **Self-hosted update server** — rejected. Extra infrastructure with no benefit at this
  stage; GitHub Releases is free, reliable, and serves the `latest.json` manifest natively.
- **Manual-only updates** — rejected. Poor UX; users on restricted networks may not check
  GitHub often. Auto-check on startup is low-friction and matches the app's connectivity
  monitoring theme.
- **Auto-install without confirmation** — rejected. Restarting without notice is disruptive.
  The confirm-then-relaunch flow is safer and was explicitly chosen.
- **Cross-platform CI matrix now** — deferred. CLAUDE.md says mac-first. Windows and Linux
  can be added to the matrix later by adding entries to the `strategy.matrix`.

## Consequences

**Positive:**
- Free hosting on GitHub; no servers to maintain.
- Signed, verifiable updates via minisign (independent of Apple).
- Both manual download and in-app update work from day one.
- CI matrix is trivially extendable to Windows/Linux.

**Negative / accepted trade-offs:**
- The minisign private key is a long-lived secret. Losing it means all existing installs
  can no longer auto-update (they reject unverifiable manifests). Must be backed up securely.
- Unsigned macOS builds trigger a Gatekeeper warning on first manual launch. Users must
  right-click → Open once. Documented in the README.
- The public key baked into a shipped binary cannot be rotated for those installs without
  a full reinstall. Key rotation is a breaking change to the update chain.

**Follow-ups:**
- Add Apple code signing / notarization when an Apple Developer account is available.
- Add Windows and Linux build targets to `.github/workflows/release.yml`.
- Consider a CHANGELOG generated from commit messages to populate `releaseBody`.
