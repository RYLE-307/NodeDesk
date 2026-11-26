# Autonomous NodeDesk development worker

This is a **local VM supervisor**, not an endless ChatGPT/Work conversation.
It invokes one bounded Codex CLI session using official noninteractive mode,
then a systemd user timer triggers another cycle five minutes after exit.
Runs preserve committed/uncommitted code, state, failure logs, and checkpoint
documents across reboots. A quota, expired login, stalled development or
diverged git history can still pause the worker.

## Requirements

- Dedicated **disposable** Ubuntu Server VM, internet-only network, without
  routes to Proxmox, NAS, LAN, corporate VPNs, or customer infrastructure.
  No host mounts, personal key forwarding, or client secrets.
- Recommended minimum: 4–6 vCPU, 12–16 GiB RAM, 120 GiB SSD.
- Dedicated non-root, non-sudo user; user-level systemd with linger enabled
  by an administrator; current Rust toolchain, Node.js 24, npm, git, jq,
  curl, flock, OpenSSH client and Tauri Linux build libraries.
- Install Codex CLI from the [official installer](https://github.com/openai/codex):
  `curl -fsSL https://chatgpt.com/codex/install.sh | sh`.
  Log in interactively as this dedicated user with
  `codex login --device-auth`, then verify `codex login status`.
- Clone `git@github.com:RYLE-307/NodeDesk.git`, branch
  `feat/post-v0.9-roadmap`, into `~/NodeDesk`; run `npm ci`.
  GitHub SSH host fingerprint must be verified against published GitHub
  fingerprints before trusting it.
- Configure a GitHub **deploy key with write access to this repository
  only** (never share the private key). Protect main, releases and tags
  using GitHub branch/repository permissions.

Run from the checkout as the dedicated user:

```bash
bash ops/autodev/install.sh
systemctl --user list-timers
journalctl --user -u nodedesk-autodev.service -n 80 --no-pager
```

The installed systemd service begins with
`NODEDESK_AUTOPUSH=0`, so it is safe to observe local agent work first.
After setting up the restricted deploy key and verifying one push to the
feature branch, change the installed user service setting to
`NODEDESK_AUTOPUSH=1`, then run
`systemctl --user daemon-reload`.

A VM administrator must enable persistence after logout using
`sudo loginctl enable-linger <dedicated-user>`.

**Pause after the current cycle:**
`touch ~/.local/state/nodedesk-autodev/PAUSE`.

**Pause and stop the active run immediately:**
`systemctl --user stop nodedesk-autodev.service` and create PAUSE.

**Resume:** remove the PAUSE file, then run
`systemctl --user start nodedesk-autodev.service`.

**Disable:** `systemctl --user disable --now nodedesk-autodev.timer`.

The worker stops after five identical/no-progress cycles instead of
burning a model quota forever. It also backs off for four hours on detected
rate limits; **this cannot bypass usage limits or guarantee uninterrupted
service**. It only pushes clean, npm-unit/build-validated commits to one
feature branch and never auto-merges, tags, publishes, force-pushes or
claims final Windows/Arch native acceptance. GitHub CI remains authoritative
for Windows/Linux and real protocol fixtures.

Security note: `--approve-for-me` uses automatic review in a workspace-write
sandbox; it is **not** equivalent to a hard network boundary. Isolate the VM
at Proxmox/VLAN level and avoid any privileged user or trusted infrastructure.
