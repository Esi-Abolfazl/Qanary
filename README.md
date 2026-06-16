# Qanary

Desktop connectivity monitor. Traffic-light status for whether your machine can reach a list of
services — useful on restricted/censored networks where some services are blocked and others
aren't.

- **Internet list** (Claude, Telegram, ChatGPT, Google, X) all unreachable → **yellow / warn**.
- **Intranet list** (digikala, torob, divar, snapp) all unreachable → **red / critical**.
- Shows WAN IP + country flag + short name.
- Add your own services and lists. Config persisted as local JSON.

## Stack

- **Tauri v2** (Rust backend) + **React + Vite + TypeScript** frontend.
- Probe = TCP connect + HTTPS HEAD → classify Up / Blocked / Down.
- Config stored at `~/Library/Application Support/com.qanary.app/config.json` (mac).
- mac first; Windows/Linux + tray/widget later (same codebase).

## Develop

```bash
source "$HOME/.cargo/env"   # until login shell picks up cargo
npm install                 # frontend deps
npm run tauri dev           # run app (dev)
npm run tauri build         # release bundle
cd src-tauri && cargo test  # Rust unit tests
```

Requires Node, Rust (rustup), and Xcode CLT on mac.

See [.claude/plans/qanary-v1.md](.claude/plans/qanary-v1.md) for the full v1 design.
