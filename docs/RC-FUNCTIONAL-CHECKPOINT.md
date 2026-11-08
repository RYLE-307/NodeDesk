# Functional RC worklist — 2026-11-08

Baseline: `main` 3146142, draft #12 01305fd, draft #13 cf624c3. This branch
is **not** a feature-complete RC. A checked box requires code, failing and
successful disposable fixture coverage, Windows/Linux CI, and a documented
native acceptance result. Automated passes alone do not close a row.

## P0

- [ ] SSH/SFTP: direct private-key selection (console and GUI Files implementation
  in this branch; native Windows/Arch acceptance pending), safe multi-hop, authentication
  failure/cancellation, gateway GUI Files, Windows/Arch acceptance.
- [ ] Desktop: decide supported direct versus gateway topology; verify RDP
  target certificate identity, clipboard, resize, reconnect and VNC auth/trust.
- [ ] Secrets: design and audit OS keychain or master-password vault, explicit
  unlock/lock, migration, export/backup policy and secret-free WebView storage.
- [ ] VPN: supported WireGuard/OpenVPN/OpenConnect profile lifecycle on each
  OS, status/errors and isolated route/DNS verification.
- [ ] Packaging: installable and portable Windows/Arch artifacts, dependency
  notices, update signing policy, native install/uninstall and permissions.

## P1

- [ ] SCP, rsync, FTP/FTPS: bounded transfers, collision handling, TLS trust,
  cancellation and disposable protocol fixtures.
- [ ] SSH: local and dynamic loopback tunnels implemented (dynamic fixture and
  native acceptance pending); remote tunnels, X11, safe gateway chains, agent-forwarding trust
  decision and exact identity-file behaviour.
- [ ] Telnet, serial, Mosh, X11/XDMCP: platform capabilities and permissions;
  decide whether insecure Rlogin/Rsh can be supported safely.
- [ ] Catalog and terminal: migrations, MobaXterm import, backup/restore,
  clipboard/link/log controls, background transfers and accessibility review.
- [ ] Network: diagnostic cancellation and manual JSON report export implemented,
  pending CI/native acceptance. DNS resolution and active TCP connect calls are
  blocking OS operations; cancellation takes effect after they return. Proxmox,
  Zabbix and MikroTik scoped API
  credentials, opt-in polling and isolated mock services.
- [ ] Monitoring: remote sampling and alerting with opt-in lifecycle.

## Verification and release state

- Local frontend unit tests: 43 passed after this change.
- Local frontend production build: passed after this change.
- Local Rust tests: **not run** here; MSVC `link.exe` is unavailable.
- Local browser tests: **not run** here; Playwright Chromium launch returned
  `spawn UNKNOWN` before any test body ran.
- Fresh GitHub CI for this change: **not run** until this branch is pushed.
- Native Windows/Arch GUI and live protocol acceptance: **not tested**.
- Windows NSIS and Ubuntu DEB preview packaging is configured in CI, with
  SHA256 manifests. Exact-head bundle results and native install/uninstall
  remain pending; see [PACKAGE-PREVIEW.md](PACKAGE-PREVIEW.md).
- Arch container build, portable binary archive and installable package are
  configured; exact-head CI and native Arch install/execution remain pending.
- GUI Files key selection uses one transient absolute regular-file path, the
  existing strict OpenSSH host-key policy and key-only SFTP transport. Encrypted
  keys must already be loaded into an SSH agent; Files cannot prompt for a key
  passphrase. It cannot be combined with password/PAM login. Disposable Linux
  fixture coverage and Windows/Linux CI for this increment are pending.
- Production-stable release: prohibited while the above gates remain open.

## Terminal paste guard (2026-11-08, review increment)
- The shared SSH/SFTP/local xterm paste handler rejects pasted control/escape
  bytes, bidi direction overrides and payloads above 16 KiB UTF-8. CR/LF
  pastes still require explicit confirmation. Ordinary typing is unchanged.
- New pure unit cases and a Playwright browser scenario cover ordinary text,
  multiline consent, escape sequences, and bounded Unicode payloads.
- This code is **not native Windows/Arch accepted**. Exact-head automated CI
  must pass before treating the increment as verified.

## Terminal clipboard copy (2026-11-08, review increment)
- An explicit **Copy selection** button copies only xterm's actively selected text,
  not the full scrollback. Empty selections, OS clipboard denial and unavailable
  clipboard APIs have visible errors; copying is bounded to 64 KiB UTF-8.
- Clipboard access is never initiated by opening or connecting a session.
  Browser coverage checks no-selection behavior; native clipboard success on
  Windows/Arch and large-output acceptance remain **NOT TESTED**.

## Network report privacy (2026-11-08, review increment)
- JSON report schema v2 redacts hostname, IP addresses, traceroute hops and raw
  diagnostic command output by default. Durations, statuses and up to 12
  explicit TCP port numbers remain. Detailed export requires opt-in checkbox
  and a separate confirmation; target edits clear the opt-in.
- Pure unit tests verify absence of sensitive fields; browser tests cover
  redacted download and opt-in full download. Native Windows/Arch acceptance
  and exact-head CI validation are still pending.


## P0 Files single-hop SSH gateway (2026-11-08, review increment)
- Transient single OpenSSH ProxyJump host, user and port added to graphical
  Files, using agent-only key authentication. Binary SFTP operations, transfer
  cancellation, no-overwrite and strict target known-host checking remain.
- Backend refuses mixing a gateway with interactive login, a manually selected
  identity file, or a gateway identical to the target. Changes to the gateway
  discard loaded remote listings and cancel pending operations.
- Local OpenSSH configuration may affect the gateway's own connection despite
  target -F none; audit gateway ssh_config separately. Both host keys must be
  trusted already. Neither gateway settings nor secrets are stored by default.
- Rust argument/negative tests and Playwright destination/route invalidation
  added. Real two-hop fixture, Windows/Arch manual acceptance and gateway
  host-key/agent failure cases remain NOT TESTED; P0 still open.


## Disposable Files gateway fixture (2026-11-08)
A Unix-only Rust integration test launches OpenSSH ProxyJump to the real
disposable sshd fixture, authenticates both hops using the fixture key and
reads a structured SFTP directory. It also checks unknown target host key
rejection while gateway trust remains valid. A per-test wrapper configures
only the disposable gateway SSH child; it does not alter the developer's
known_hosts. Windows/Arch native acceptance and multi-host/corporate
topologies are still NOT TESTED.
