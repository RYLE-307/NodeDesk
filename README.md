# NodeDesk

[Русский](README.ru.md) · **EN**

Offline-first infrastructure workspace for Windows and Linux, built with Tauri 2,
React, TypeScript and Rust. Current version: **0.2.0-alpha.0**.

## Available

- Connection and nested group creation, editing, moving and deletion.
- Search by name, host, user and group path; favorites.
- Local catalog and settings persistence with schema validation and error handling.
- RU/EN, dark/light/system themes, collapsible Tech Dark navigation.
- Empty workspace at startup; closable tabs and two connection-detail panes.
- Optional monitoring panel, off by default, with no configured providers.

SSH/SFTP/RDP sessions, live monitoring and protected secret storage are future
work. Tabs show metadata only. No automatic connections, fake terminals, telemetry
or credentials are collected. Catalog storage is local WebView profile storage,
not encryption or backup. [Storage contract and acceptance checks](docs/V0.2.md).

## Development

Use Node 24 LTS, npm and, for desktop, stable Rust plus the
[Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/).
Windows needs MSVC Build Tools and WebView2; Linux needs WebKitGTK and build tools.

```sh
npm ci
npm test
npm run build
npm run dev          # web UI
npm run tauri dev    # desktop
npm run tauri build -- --no-bundle
```

Keep `package-lock.json`; use `npm ci` on Arch and Windows. Before pulling, inspect
`git status` and commit or stash local edits; do not delete conflicting icons or
lock files. Dependency installation needs internet; normal catalog use does not.
Installers remain disabled pending platform validation and release preparation.

CI tests/builds frontend and compiles Tauri on Windows and Ubuntu. Arch launch of
v0.1 was confirmed by the user; v0.2 still needs separate Arch desktop acceptance.
Rust is unavailable in the local agent environment; Cargo.lock is not yet tracked.

[Roadmap](docs/ROADMAP.md) · [Architecture](docs/ARCHITECTURE.md) ·
[MobaXterm parity goals](docs/MOBAXTERM-PARITY.md) · [MIT](LICENSE)
