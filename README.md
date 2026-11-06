# NodeDesk

> Current review / Текущая проверяемая версия: **v0.5 SFTP GUI slice**.
> GUI: Linux OpenSSH password/PAM; Windows native password/keyboard-interactive or OpenSSH key/agent; bounded CRUD, selected-file Drag & Drop and a 50-file sequential queue (draft, pending manual acceptance).
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
supports structured SFTP browsing and binary transfer with Linux password/PAM
auth bridge, Windows native password/keyboard-interactive or direct key/agent auth.
RDP, live monitoring and protected secret storage remain future work. No automatic connections, fake terminals, telemetry
or credentials are collected. Catalog storage is local WebView profile storage,
not encryption or backup. [Storage contract and acceptance checks](docs/V0.2.md).

## Development

Use Node 24 LTS, npm and, for desktop, stable Rust plus the
[Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/).
Windows needs MSVC Build Tools and WebView2; Linux needs WebKitGTK and build tools.
The native SSH dependency builds vendored OpenSSL, requiring a C compiler,
Perl and make (MSVC/NMake on Windows). OpenSSH Client supplies ssh-keygen for
known_hosts matching; no SSH server installation is required on the client.

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
v0.1–v0.4 was confirmed by the user; v0.5 latest GUI still needs manual acceptance.
Cargo.lock is tracked. Real-server SFTP integration runs in Linux CI; Windows
runs native integration against an independent loopback SSH/SFTP peer, unit tests and Tauri builds. Desktop GUI acceptance is pending.

[Roadmap](docs/ROADMAP.md) · [Architecture](docs/ARCHITECTURE.md) ·
[MobaXterm parity goals](docs/MOBAXTERM-PARITY.md) · [MIT](LICENSE)


## v0.3 SSH vertical slice (review branch)

Real interactive SSH via OpenSSH + native PTY + xterm.js is implemented in this branch. Explicit connect/reconnect, resize, tab lifecycle and strict known_hosts trust are included; key/agent/password/PAM authentication is supported in consoles. The v0.3 SSH PR has already merged and was manually tested on Arch. See [architecture, limits and acceptance steps](docs/V0.3-SSH.md). Windows native GUI password/keyboard-interactive is described below; tunnels remain deferred. See the v0.5 note below.


## v0.5 SFTP GUI — review slice / срез для проверки

Two panels, real structured SFTP v3 listing/navigation and binary upload/download
with no overwrite, confirmation, progress/cancel. GUI: Linux password/PAM via the Files login panel; Windows native password/keyboard-interactive or direct key/agent. Nonrecursive mkdir, safe rename, delete and single-file internal drag/drop are implemented. Issue #9 remains open. Arch/Windows manual acceptance
is pending; no merge before verification.

Две панели, настоящий SFTP v3, навигация и бинарная передача без перезаписи,
с подтверждением, прогрессом и отменой. GUI Linux: пароль/PAM через OpenSSH, Windows: native пароль/keyboard-interactive или ключ/агент. Создание папок, переименование, удаление и DnD одного файла есть, приёмка ещё впереди.

See [security, limitations and acceptance](docs/V0.5-SFTP-GUI.md).

### v0.5 review addition

Multi-file checkbox selection and one-at-a-time upload/download (up to 50
regular files) with explicit confirmation and cancellation are included in
[PR #10](https://github.com/RYLE-307/NodeDesk/pull/10). The existing SFTP
trust and no-overwrite rules still apply. This is not a persistent transfer
queue; see [V0.5](docs/V0.5-SFTP-GUI.md).

### Windows native Files login

The draft now implements password and keyboard-interactive using Rust ssh2/libssh2.
Only previously trusted OpenSSH host keys are accepted; unknown/changed/revoked
keys are rejected before credential input. Verify and accept new keys through
the existing SSH console first. Input is hidden and credentials are not saved.
Cancelling a native transfer closes the Windows Files login; reconnect afterwards.
Uncheck interactive login for the existing key/agent path. CA/certificate trust,
password changes and arbitrary mixed-method MFA chains are outside this slice.
Linux real-sshd/PAM and Windows independent-peer CI are separate from manual GUI
acceptance. [Exact architecture and limits](docs/V0.5-SFTP-GUI.md). PR #10 stays draft.
