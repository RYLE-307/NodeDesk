# NodeDesk

> Current review / Текущая проверяемая версия: **v0.5 SFTP GUI slice**.
> GUI: key/agent only; password/PAM in consoles. No mkdir/rename/delete/DnD.
> Full scope and acceptance: [V0.5](docs/V0.5-SFTP-GUI.md). Historical notes below may describe older releases.

[Русский](README.ru.md) · **EN**

Offline-first infrastructure workspace for Windows and Linux, built with Tauri 2,
React, TypeScript and Rust. Current review version: **0.5.0-alpha.0**.

## Available

- Connection and nested group creation, editing, moving and deletion.
- Search by name, host, user and group path; favorites.
- Local catalog and settings persistence with schema validation and error handling.
- RU/EN, dark/light/system themes, collapsible Tech Dark navigation.
- Empty workspace at startup; closable tabs and two connection-detail panes.
- Optional monitoring panel, off by default, with no configured providers.

Real SSH/SFTP consoles support key/agent/password/PAM. The v0.5 Files GUI
supports structured SFTP browsing and binary transfer with key/agent auth.
RDP, live monitoring and protected secret storage remain future work. No automatic connections, fake terminals, telemetry
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
Cargo.lock is tracked. Real-server SFTP integration runs in Linux CI; Windows
runs unit tests and builds Tauri. Desktop GUI acceptance is pending.

[Roadmap](docs/ROADMAP.md) · [Architecture](docs/ARCHITECTURE.md) ·
[MobaXterm parity goals](docs/MOBAXTERM-PARITY.md) · [MIT](LICENSE)


## v0.3 SSH vertical slice (review branch)

Real interactive SSH via OpenSSH + native PTY + xterm.js is implemented in this branch. Explicit connect/reconnect, resize, tab lifecycle and strict known_hosts trust are included; key/agent/password/PAM authentication is supported in consoles. Arch manual acceptance is required before merge. See [architecture, limits and acceptance steps](docs/V0.3-SSH.md). GUI password/PAM and tunnels remain deferred. See the v0.5 note below.


## v0.5 SFTP GUI — review slice / срез для проверки

Two panels, real structured SFTP v3 listing/navigation and binary upload/download
with no overwrite, confirmation, progress/cancel. GUI: key/agent and previously
trusted host only; password/PAM stay in the existing consoles. No mkdir, rename,
delete or drag/drop yet. Issue #9 remains open. Arch/Windows manual acceptance
is pending; no merge before verification.

Две панели, настоящий SFTP v3, навигация и бинарная передача без перезаписи,
с подтверждением, прогрессом и отменой. GUI: ключ/агент и уже доверенный host key.
Пароль/PAM работают в консолях. mkdir/rename/delete/DnD отложены.

See [security, limitations and acceptance](docs/V0.5-SFTP-GUI.md).
