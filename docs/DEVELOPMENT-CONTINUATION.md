# NodeDesk development continuation

Updated: 2026-11-09. Work only on `feat/post-v0.9-roadmap`; draft PR #13.
The branch was fetched into the isolated `NodeDesk-rc` worktree because the
existing `NodeDesk` checkout has unrelated uncommitted work. Do not alter it.

## Current checkpoint

- Code HEAD: `a867a7f` (checkpoint including
  `faa02eb` `test-ssh-reject-two-hop-wrong-identity`), pushed. The exact HEAD of this document's commit
  is its own commit.
- Baseline `420ff01` passed [CI 42512592259](https://github.com/RYLE-307/NodeDesk/actions/runs/42512592259)
  6/6. The `8923456` workflow for the first VPN change
  [passed 6/6](https://github.com/RYLE-307/NodeDesk/actions/runs/42574389066).
  The `3d6a2d8` workflow for the whole VPN fix
  [passed 6/6](https://github.com/RYLE-307/NodeDesk/actions/runs/42574795865).
  The `a867a7f` exact-head workflow, including the SSH negative fixture,
  [passed 6/6](https://github.com/RYLE-307/NodeDesk/actions/runs/42575299283):
  Windows/Ubuntu frontend and desktop, browser, Arch Rust/build/package.
- Implemented in this block: a 35-second wall-clock deadline for system VPN
  manager commands, a 256 KiB streaming stdout cap, process termination on
  timeout or overflow, and generic errors that do not echo profile output.
  This applies to Linux `nmcli` and Windows PowerShell/rasdial actions.
- Added Rust tests using only local disposable processes for timeout and
  oversized output on both platforms. No real VPN profile was read or changed
  during this work.
- `18ab58c` makes the 35-second listing limit apply to the *whole* profile
  enumeration, including per-profile `nmcli` metadata. The five-second
  post-action state check now passes its remaining deadline to the OS query.
  An expired-deadline test runs without touching an OS VPN profile.
- `faa02eb` adds a disposable three-listener SFTP negative case: all host
  keys are trusted, but a wrong fixture identity is rejected before SFTP.
  No user key, saved profile or production host is involved.
- Local `git diff --check` passed. Local Rust tests: NOT RUN (`cargo` absent).
  Local frontend unit/build/browser tests: NOT RUN (`npm` absent). Exact-head
  CI passed the automated checks; native Windows/Arch GUI, VPN route/DNS,
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

1. Inspect exact-head PR #13 workflow for this checkpoint commit. Fix any failed jobs and
   repeat checks before calling this block verified.
2. Continue P0 with two-hop SSH cancellation and native auth/error coverage,
   then select the next concrete product gap. Keep all native checks
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
