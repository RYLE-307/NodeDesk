# NodeDesk v0.7.0 — candidate release notes

**Status: v0.7.0-rc.1 is under review in draft PR #11; this is NOT a published
GitHub release.** These notes describe implemented functionality on the release
candidate branch; the automated engineering milestone requires green exact-HEAD CI, license
review and an approved merge. Manual Windows/Arch acceptance is reserved
for the consolidated v0.9–v1.0 campaign; v0.7 is **CI-only unverified GUI**.

## Major changes since stable v0.5

- Desktop workspace: more flexible tabs, local shells and pane resizing,
  browser-backed Guacamole RDP and VNC-over-WSS integration, opt-in external
  RDP/VNC launchers, system-owned VPN profile visibility with documented limits.
- SFTP GUI: multi-file batches (up to 50 per queue), up to eight bounded
  independent queue reports, with **only one active transfer per Files tab**.
  The operator explicitly selects, pauses, resumes, retries, switches or
  discards queues. No unattended background transfer after the Files tab closes.
- SFTP integrity: exclusive/no-overwrite uploads/downloads and byte-by-byte
  comparison before **manual resume** of upload or download, including full
  final-content verification.
- Recovery: optional local checkpoints for up to eight queue records,
  seven-day expiry, strict schema validation, file/endpoint checks and explicit
  login/refresh/confirmation before any resumed network operation.
  Recovery metadata (host/user/path/file name/size/status/partial ID) is
  **unencrypted** in application local storage; passwords, private keys,
  authentication sessions and file contents are not written there.
- In-memory remote UTF-8 text preview/editor (128 KiB), case-sensitive literal
  find/replace and exclusive **Save as new copy**, never a direct overwrite of
  the source file.
- Network diagnostics: DNS, one TCP probe, manually specified bounded ports,
  ping and bounded traceroute.

## Security, compatibility and limitations

- NodeDesk never auto-connects to saved hosts or VPN profiles. It does not
  import or persist credentials; SSH host-key verification is required.
- Existing Windows L2TP settings may be shown read-only; NodeDesk does not
  initiate corporate VPN test connections automatically.
- Persistent queue records are NOT a background transfer engine. One queue
  executes at a time per Files tab; interruptions can leave `.part` files
  requiring manual inspection. No resume against actively malicious servers
  or arbitrary concurrent writers is guaranteed.
- Embedded RDP requires a separately provisioned TLS Guacamole/guacd service;
  embedded VNC requires a trusted WSS gateway. Native direct TCP RDP/VNC are
  not part of these embedded modes. Architecture and security requirements:
  [embedded desktop notes](V0.6-EMBEDDED-DESKTOP.md).
- Full MobaXterm parity, FTP/FTPS, Mosh, X11, Serial, Proxmox, Zabbix,
  MikroTik, native credential vault, and durable unattended queue scheduling
  are **not v0.7 release claims**.
- Native Windows and Arch manual GUI testing and validated installer bundles
  are **not yet complete**; native testing is deferred until v0.9–v1.0.

## Release verification and assets

Candidate version: `0.7.0-rc.1` in npm/package-lock, Tauri and Cargo/Cargo.lock.
Unit/browser and disposable SSH/SFTP/RDP/VNC workflow results must be evaluated
at the exact candidate SHA, not reused from an earlier commit. Windows preview
executable is a GitHub Actions build artifact for QA, not a signed installer.

For manual checks and build instructions, see
[v0.7 acceptance](V0.7-ACCEPTANCE.md). Third-party obligations are outlined in
[license notices](THIRD-PARTY-NOTICES.md).

**Publishing policy:** do not merge PR #11, tag `v0.7.0`, upload installers
or declare native acceptance until the applicable automated engineering gates in
[v0.7 release plan](V0.7-RELEASE.md) have passed.
