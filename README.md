# NodeDesk

> **Current development: v0.6.0-alpha.0** — embedded Guacamole/WSS RDP, embedded VNC, external desktop launchers and OS VPN control in draft PR #11.
> v0.5 SSH/SFTP GUI was merged into main in PR #10; production Windows GUI acceptance and release packaging remain separate.
> First v0.6 RDP scope: [V0.6 RDP](docs/V0.6-RDP.md). The remaining historical notes describe earlier releases.

[Русский](README.ru.md) · **EN**

Offline-first infrastructure workspace for Windows and Linux, built with Tauri 2,
React, TypeScript and Rust. Current development version: **0.6.0-alpha.0**.

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
The first RDP launcher opens an external mstsc/FreeRDP window on explicit click. Embedded RDP/VNC, VPN, live monitoring and protected secret storage remain future work. No automatic connections, fake terminals, telemetry
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

CI tests/builds frontend and compiles Tauri on Windows and Ubuntu. The user confirmed the v0.5 Arch GUI launched and uploaded a file to a real server. Windows GUI acceptance remains separate.
Cargo.lock is tracked. Real-server SFTP integration runs in Linux CI; Windows
runs native integration against an independent loopback SSH/SFTP peer, unit tests and Tauri builds. Desktop GUI acceptance is pending.

[RDP v0.6 notes](docs/V0.6-RDP.md) · [Roadmap](docs/ROADMAP.md) · [Architecture](docs/ARCHITECTURE.md) ·
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

### v0.6 VNC integration (draft)

The existing v1 connection catalog now supports VNC profiles (default port
5900). Opening the VNC tab does not connect; **Open VNC** launches an externally
installed TigerVNC viewer. A strict `X509Vnc,X509Plain` allowlist rejects
unauthenticated or anonymous-transport VNC. Viewer password/certificate prompts
remain outside NodeDesk; no passwords, insecure fallback, clipboard sharing,
automatic reconnection or catalog credentials. Linux needs the `tigervnc`
package; Windows needs the official TigerVNC Viewer installation. The **new embedded viewer** uses noVNC inside the NodeDesk tab over an independently configured authenticated **wss://** gateway. It cannot connect directly to raw TCP 5900. Its security depends on trusted gateway TLS and enforced VNC/gateway authentication, unlike the external client's X.509-only setting. Live manual acceptance is pending.
[VNC security and QA](docs/V0.6-VNC.md).

### v0.6 system VPN manager (draft)

**System VPN** is a separate tool tab, not a connection catalog item.
It lists existing OS-managed profiles with status, and allows explicit
Connect/Disconnect with a confirmation about route, DNS and remote-access
changes. On Linux it supports NetworkManager VPN/WireGuard profiles identified
by UUID. On Windows it covers current-user built-in IKEv2/L2TP/SSTP profiles
with required encryption, using OS-managed credentials. NodeDesk neither
imports nor stores passwords, keys, credentials, DNS settings or routes.
Unsupported third-party VPN clients, Windows all-user profiles and old PPTP
are intentionally excluded. Native Windows/Arch live VPN acceptance is
still pending. [VPN scope and safety](docs/V0.6-VPN.md).

### v0.6 embedded desktop status

Embedded **VNC** now uses noVNC 1.7.0 (MPL-2.0) to render a live RFB
framebuffer and send keyboard/mouse events inside the NodeDesk tab. It needs
an explicit operator-controlled `wss://` WebSocket/RFB gateway with a
certificate trusted by the operating system, and an authentication policy
enforced by the gateway/origin server. NodeDesk rejects a session if the RFB
server never challenged for credentials, but that does not replace gateway
access controls. Connection and credential entry are
manual and transient; the URL and password are not persisted. This is not
the same as X509Vnc-only external TigerVNC authentication. No direct raw
TCP VNC, no anonymous-gateway security guarantee, and no native Arch/Windows
live WSS acceptance yet.

Embedded **RDP through Guacamole** is now present in the RDP tab, using a separately installed, authenticated WSS Guacamole gateway. This mode renders pixels and sends input in NodeDesk, but is **not a native Rust RDP engine** and cannot connect to raw TCP:3389. Existing external FreeRDP/mstsc works separately. Native IronRDP needs certificate identity verification; gateway integration still needs live manual acceptance.

[Embedded desktop architecture and license notices](docs/V0.6-EMBEDDED-DESKTOP.md).

[Gateway-based in-tab RDP, native TLS blocker and QA](docs/V0.6-RDP-EMBEDDED.md).
