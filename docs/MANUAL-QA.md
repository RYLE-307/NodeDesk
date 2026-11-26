# Native Windows and Arch acceptance — NOT TESTED

This list records checks that disposable CI cannot establish. Use only
operator-owned disposable services, credentials and VPN profiles. Record OS
version, NodeDesk commit, expected and observed result, and any defect before
changing a row to PASS. Do not connect to personal, work or customer systems.

## Windows

- Install the unsigned development NSIS preview on a clean VM; check WebView2
  prerequisites, shortcuts, file permissions and removal. Check portable
  launch separately. Repeat with a signed candidate before release.
- Verify OS Credential Manager save, lock, unlock, restart, delete and
  secret-free export. Inspect WebView storage for credentials.
- Exercise direct RDP with a disposable server: strict certificate trust and
  rejection, CredSSP, keyboard/mouse, framebuffer, resize, fullscreen, native
  text clipboard in both directions, disconnect and reconnect after loss.
- Exercise direct VNC against disposable X509 VeNCrypt: wrong pin must receive
  no password; verify framebuffer, input, resize, consented clipboard,
  reconnect and credential cleanup after close.
- Exercise disposable IKEv2/L2TP/SSTP profiles: connect, cancel, disconnect,
  error recovery and route/DNS behavior, including split tunnel and DNS leak
  checks. Record the actual OS state after cancellation.
- Exercise SSH/SFTP password, PAM, key and agent authentication through two
  disposable jump hosts; transfer, resume, cancel and recover after a cut.

## Arch Linux

- Install and remove the package and launch the portable build in a clean
  desktop VM. Check declared dependencies, desktop entry, icons and
  permissions. CI container package smoke is not native acceptance.
- Verify Secret Service save, lock, unlock, restart, delete and secret-free
  export with the target desktop keyring.
- Repeat direct RDP/VNC GUI, clipboard, reconnect and trust checks above.
- Import disposable WireGuard and OpenVPN files in NetworkManager; check
  owner restriction, no autoactivation before restriction, secret-agent
  behavior, cancellation, conflict and unavailable-manager recovery.
- Connect and disconnect disposable WireGuard, OpenVPN and OpenConnect
  profiles. Check actual routes, split tunnel behavior, DNS queries and state
  after cancellation; remove imported profiles.
- Repeat SSH/SFTP authentication, two-hop, transfer and recovery checks above.

## Release-only gates

- Verify code signing identity and reproducible installer integrity evidence.
- Verify any updater uses signed metadata and signed artifacts, rejects a
  changed or rolled-back package, and offers a safe rollback path. Automatic
  updating is not enabled in the current preview.
