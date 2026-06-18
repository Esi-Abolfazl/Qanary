# Qanary

Desktop connectivity monitor. Traffic-light status for whether your machine can reach a list of
services — useful on restricted/censored networks where some services are blocked and others
aren't.

- **Global list** (Claude, Telegram, ChatGPT, Google, X) all unreachable → **yellow / warn**.
- **Iran list** (digikala, torob, divar, snapp) all unreachable → **red / critical**.
- Shows WAN IP + country flag + short name.
- Add your own services and lists. Config persisted as local JSON.

## Adding services

Add or edit services from the modal. Each non-blank line is one service.

- **Custom ports** — write `host:port` to probe a specific port instead of the default 443. Example: `api.example.com:8080`.
- **Multi-endpoint services** — comma-separate hosts on one line to group them under a single service. Example: `Mail: smtp.example.com:465, imap.example.com:993, mail.example.com`. The row shows a rolled-up count of reachable / blocked / down endpoints; expand it to see each endpoint with its own status and latency.
- **Bulk input** — paste many lines at once to add a whole batch of services in one go. One service per line.
- **Optional label** — prefix a line with `Label:` to name the service (`Search: google.com`). Without a label, the first host becomes the name.

Each service can be edited or removed from its row's `⋯` menu.

## Stack

- **Tauri v2** (Rust backend) + **React + Vite + TypeScript** frontend.
- Probe = TCP connect + HTTPS HEAD → classify Up / Blocked / Down.
- Config stored at `~/Library/Application Support/com.qanary.app/config.json` (mac).

## Develop

```bash
source "$HOME/.cargo/env"   # until login shell picks up cargo
pnpm install                 # frontend deps
pnpm run tauri dev           # run app (dev)
pnpm run tauri build         # release bundle
cd src-tauri && cargo test  # Rust unit tests
```

Requires Node, Rust (rustup), and Xcode CLT on mac.

## Releases

Prebuilt apps are on the [Releases page](https://github.com/Esi-Abolfazl/Qanary/releases).

> **First launch:** macOS may show a Gatekeeper warning. Right-click the app → Open to bypass it once.

## Cutting a new release

1. Bump the version in three places (all must match):
   - `src-tauri/tauri.conf.json` → `"version"`
   - `src-tauri/Cargo.toml` → `version`
   - `package.json` → `"version"`
2. Commit, tag, and push:
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
3. GitHub Actions builds both arches, signs the artifacts, and publishes the release automatically. The `latest.json` manifest is included so existing installs can detect the update.

> **Prerequisite:** secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` must be set in the repo's GitHub settings. Generate the keypair once with `pnpm tauri signer generate -w ~/.tauri/qanary_updater.key` and paste the public key into `tauri.conf.json` → `plugins.updater.pubkey`.

## In-app updates

Qanary checks for updates silently on every launch. If a newer version is available, a banner appears — click **Install & restart** to update. You can also click **Check for updates** at the bottom of the window at any time.
