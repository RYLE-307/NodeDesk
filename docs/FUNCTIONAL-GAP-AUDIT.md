# Functional gap audit — 2026-11-08

Baseline: `main` 3146142 (v0.7/v0.8 merged), draft PR #12 at 01305fd
(v0.9.0-alpha.0). This document lists implementation priorities before the
single operator-led native acceptance pass. A CI pass proves only the tested
automated scenarios; it does not prove desktop, protocol or security parity.

## P0 — required before a release candidate can be called feature-complete

| Area | Current evidence | Remaining gate |
| --- | --- | --- |
| SSH/SFTP security and recovery | Strict host-key checks, password/PAM console, graphical SFTP, bounded transfer queues and partial recovery have automated fixtures. Direct key-file choice is implemented for console and GUI Files, pending CI and native acceptance. | Native Windows/Arch acceptance; GUI Files through a gateway; safe multi-hop and auth/error coverage. |
| Desktop protocols | RDP uses an external client or separately deployed Guacamole gateway; VNC uses an external client or WSS gateway. | Embedded direct protocol/trust path or an explicit product decision to keep gateway dependency; clipboard/resize/reconnect and target certificate acceptance. |
| Secrets and storage | Catalog strips unknown secret fields; credentials are transient. | Audited OS vault/master-password policy, lock/unlock, migration and backup policy. Never put credentials in WebView storage. |
| System VPN | Existing OS-owned profiles can be listed and explicitly toggled. | WireGuard/OpenVPN/OpenConnect coverage per OS, profile lifecycle/status/errors and disposable route/DNS tests. No corporate profiles. |
| Packaging and trust | Windows/Ubuntu CI builds unbundled desktop binaries. | Installers/portable builds, complete dependency notices, update signing, native Windows/Arch install/uninstall and permission checks. |

## P1 — planned functionality still substantially open

| Area | Remaining gate |
| --- | --- |
| File protocols | SCP, rsync, FTP/FTPS with bounded transfers, TLS validation, collision policy and lab fixtures. |
| SSH advanced | Direct identity-file selection and loopback-only dynamic SOCKS5 forwarding are implemented, pending CI/native acceptance. ProxyJump chains, remote tunnels and X11 forwarding need explicit trust boundaries; current single-hop console jump is limited. |
| Other sessions | Telnet, serial, Mosh and X11/XDMCP with platform-specific capability/permission checks. Rlogin/Rsh need an explicit security decision. |
| Workspace/terminal | Catalog migrations and MobaXterm import, terminal clipboard/link/log controls, background transfer lifecycle, accessibility and visual review. |
| Network/infrastructure | Ping/traceroute process cancellation and manually downloaded result reports are implemented, pending CI/native acceptance. DNS/TCP and explicit port-check cancellation remain open. Proxmox, Zabbix and MikroTik need scoped API credentials, opt-in polling and disposable mocks. |
| Monitoring | Local read-only CPU/RAM/disk/network sampling is in this branch, explicitly opt-in. Remote monitoring, alerting and native acceptance remain open. |

## Verification rule

For each row: unit tests for validation, a disposable protocol/service fixture
for successful and failing operations, Windows and Ubuntu CI, and one combined
native Windows/Arch GUI acceptance at the end. Record actual protocol versions,
trust prompts, cancellation, reconnect and SHA256 for transfers. Unrun checks
remain **not tested**. Do not merge the final candidate or cut a release while
required gates are open.
