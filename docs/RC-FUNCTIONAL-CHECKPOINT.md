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
- [ ] Network: cancellation (manual JSON report export implemented, CI/native
  acceptance pending); Proxmox, Zabbix and MikroTik scoped API
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
- Arch container build and portable binary archive are configured; exact-head
  CI and native Arch execution remain pending.
- GUI Files key selection uses one transient absolute regular-file path, the
  existing strict OpenSSH host-key policy and key-only SFTP transport. Encrypted
  keys must already be loaded into an SSH agent; Files cannot prompt for a key
  passphrase. It cannot be combined with password/PAM login. Disposable Linux
  fixture coverage and Windows/Linux CI for this increment are pending.
- Production-stable release: prohibited while the above gates remain open.
