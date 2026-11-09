# NodeDesk development continuation

Updated: 2026-11-09. Work only on `feat/post-v0.9-roadmap`; draft PR #13.
The branch was fetched into the isolated `NodeDesk-rc` worktree because the
existing `NodeDesk` checkout has unrelated uncommitted work. Do not alter it.

## Current checkpoint

- Code HEAD: `1138d47` (`fix-vpn-bound-manager-execution`), pushed to the
  working branch. The exact HEAD of this document's commit is its own commit.
- Baseline `420ff01` passed [CI 42512592259](https://github.com/RYLE-307/NodeDesk/actions/runs/42512592259)
  6/6. The `1138d47` workflow is pending verification.
- Implemented in this block: a 35-second wall-clock deadline for system VPN
  manager commands, a 256 KiB streaming stdout cap, process termination on
  timeout or overflow, and generic errors that do not echo profile output.
  This applies to Linux `nmcli` and Windows PowerShell/rasdial actions.
- Added Rust tests using only local disposable processes for timeout and
  oversized output on both platforms. No real VPN profile was read or changed
  during this work.
- Local `git diff --check` passed. Local Rust tests: NOT RUN (`cargo` absent).
  Local frontend unit/build/browser tests: NOT RUN (`npm` absent). CI must
  establish automated results; native Windows/Arch GUI, VPN route/DNS,
  installation and protocol acceptance remain **NOT TESTED**.

## Open release gates

- P0 SSH/SFTP: native password/PAM/key/agent and two-hop authentication,
  cancellation, transfer recovery and error acceptance on Windows/Arch;
  independently deployed gateway topology.
- P0 secrets: audited OS keychain or master-password vault with lock/unlock,
  migration and secret-free backup.
- P0 RDP/VNC: embedded direct or accepted gateway topology, target trust,
  input, clipboard, resize/fullscreen/reconnect and native acceptance.
- P0 VPN: profile lifecycle, Windows/Arch support matrix, route/DNS evidence,
  native acceptance. The current change closes only unbounded manager waiting.
- P0 packaging: native NSIS/Arch install/uninstall, dependency notices, signing
  and update policy verification.
- P1: file protocols, advanced SSH, legacy/serial/Mosh/X11, catalog import,
  terminal automation, diagnostics and scoped infrastructure integrations per
  `ROADMAP.md`, `MOBAXTERM-PARITY.md` and `RC-FUNCTIONAL-CHECKPOINT.md`.

## Next action

1. Inspect exact-head PR #13 workflow for `1138d47`. Fix any failed jobs and
   repeat checks before calling this block verified.
2. Continue P0 with disposable two-hop SSH authentication failure and cancel
   coverage, then select the next concrete product gap. Keep all native checks
   as NOT TESTED until an operator performs them on Windows and Arch.

## Commands

```text
git status --short --branch
git rev-parse HEAD
git diff --check
npm ci && npm test && npm run build && npm run test:browser
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

For disposable Linux SSH/SFTP CI, use `bash tests/ssh-fixture.sh` only in an
isolated runner. Never point NodeDesk at personal, work or customer systems.
Do not merge PR #13, create a release tag or publish an RC before all gates.
