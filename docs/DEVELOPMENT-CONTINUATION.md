# NodeDesk development continuation

Updated: 2026-11-09. Work only on `feat/post-v0.9-roadmap`; draft PR #13.
The branch was fetched into the isolated `NodeDesk-rc` worktree because the
existing `NodeDesk` checkout has unrelated uncommitted work. Do not alter it.

## Current checkpoint

### 2026-11-09 VPN route/DNS presence increment (CI pending)

- Previous VNC commit `85a30fc` is pushed; its [exact-head CI](https://github.com/RYLE-307/NodeDesk/actions/runs/42580735514)
  must be checked before declaring that increment verified.
- Added an explicit read-only VPN health query for a selected OS profile.
  NetworkManager reads only active profile route/DNS fields by UUID. Windows
  reads interface route/DNS presence through fixed PowerShell cmdlets with
  the profile alias passed as an environment value. Only booleans or unknown
  reach the WebView; no route, DNS address, profile secret or raw command
  output is returned. Inactive profiles report unknown.
- UI starts at Not checked and clears evidence on refresh or mutation. Browser
  fixture verifies no automatic query, profile-ID-only IPC, and reset.
  Windows unit fixture shadows all network cmdlets; no real VPN is touched.
- Local 52 frontend unit tests and production build passed. Rust and browser
  for this increment need CI; local Rust cannot link because MSVC `link.exe`
  is absent, and local Playwright WebServer has not started in this environment.
- **VPN-01 remains open:** presence of routes/DNS is not path correctness,
  DNS leakage, split-tunnel policy or traffic proof. Real profile lifecycle,
  native Windows/Arch acceptance and packet-level checks remain NOT TESTED.

### 2026-11-09 VNC gateway clipboard increment (verification pending)

- Previous RDP/NSIS commit `c8c3b33` is pushed. Its [exact-head CI](https://github.com/RYLE-307/NodeDesk/actions/runs/42580185235)
  has passed Windows/Ubuntu frontend, browser, Windows/Ubuntu desktop and
  Windows package preview; Arch preview is still running at this checkpoint.
- The existing noVNC WSS viewer now exposes per-session opt-in clipboard only
  after an authenticated RFB connection. Receiving remote text never writes
  to the OS clipboard automatically. Copy and send are separate actions;
  sending requires confirmation and is disabled in view-only mode. Shared
  validation bounds text to 64 KiB UTF-8 and rejects control/bidi characters.
  Disconnect or tab teardown clears the retained remote text.
- Local frontend unit tests (52) and production build passed. Browser coverage
  checks clipboard controls are absent before VNC authentication with a
  disposable mocked WSS failure. Full RFB clipboard exchange and native
  Windows/Arch acceptance remain NOT TESTED. No real VNC endpoint was used.
- **VNC-01 remains open:** the viewer requires an operator WSS/RFB proxy;
  direct TCP, RFB identity acceptance, reconnect and native acceptance remain
  unimplemented or untested. Next priority is direct native desktop clients
  or a documented gateway deployment with disposable end-to-end fixtures;
  then VPN route/DNS lifecycle evidence.

### 2026-11-09 RDP gateway clipboard increment (verification pending)

- Current branch: `feat/post-v0.9-roadmap`; prior HEAD `9136c0a` is pushed.
  Its [CI run](https://github.com/RYLE-307/NodeDesk/actions/runs/42579427080)
  passed browser, Windows/Ubuntu frontend, Ubuntu desktop and Windows Rust,
  but Windows packaging failed because `prepare-nsis.ps1` found an already
  populated Tauri NSIS directory. The current increment removes that exact
  checked workspace cache and fetches checksum-verified NSIS tools anew.
- The existing Guacamole RDP viewer now offers per-session opt-in text
  clipboard. Remote text requires an explicit copy; sending local text
  requires a separate confirmation. UTF-8 is bounded to 64 KiB and control
  characters are refused. Clipboard data is cleared on disconnect. A mock
  Guacamole protocol browser test covers opt-in, oversized text and teardown.
- Local frontend: 52 unit tests and production build passed. Browser test
  web server has not started in this local environment; CI must run it.
- **RDP-01 remains open:** this still requires a separately deployed
  Guacamole gateway. Direct embedded RDP, target certificate trust, NLA,
  native input/clipboard/resize/fullscreen/reconnect acceptance on Windows
  and Arch remain NOT TESTED or NOT IMPLEMENTED as appropriate.
- Next: push this increment, require exact-head CI, then implement a native
  IronRDP client path. Do not call the gateway viewer direct RDP.

### 2026-11-09 OS vault implementation (automated verification passed)

- Branch: `feat/post-v0.9-roadmap`. Vault code commit `790ba7c` and test fix
  `4094943` are pushed; this checkpoint has its own later documentation HEAD.
- Native backend uses Windows Credential Manager or Linux Secret Service via
  keyring 3.6.3. It starts locked, exposes explicit unlock/lock, bounded
  put/has/get/delete, binds each record to exact catalog target fields, and
  refuses plaintext fallback. App/window close locks the application gate.
- Vault UI has uncontrolled password inputs, explicit temporary reveal,
  deletion and no WebView storage writes. Catalog export remains secret-free.
  See `SECURE-VAULT.md` for migration and threat boundaries.
- Local frontend: 51 unit tests passed; production build passed. Playwright
  discovered the browser test but could not start its local WebServer here.
  Local Rust check cannot link build scripts because MSVC `link.exe` is absent.
- [First vault CI](https://github.com/RYLE-307/NodeDesk/actions/runs/42578000205):
  browser failed on an ambiguous **test selector**, fixed by `4094943`.
  [Exact-head CI at `4094943`](https://github.com/RYLE-307/NodeDesk/actions/runs/42578381253)
  passed 6/6: Windows/Ubuntu/Arch Rust and desktop builds, browser, Windows
  disposable Credential Manager roundtrip and preview packages.
- A disposable Windows CI Credential Manager roundtrip test has been added;
  Linux unit tests use an in-memory store. Native Windows GUI and Arch Secret
  Service save/restart/delete remain **NOT TESTED**. Automatic use of saved
  credentials by SSH/RDP/VNC is not yet implemented; SEC-01 remains open.
- Catalog import does not contain secrets, but an imported record with the
  same UUID and exact endpoint can match an existing OS credential after
  unlock. The import confirmation now warns about this. The final commit also
  checks `sessionStorage` in the browser test and records keyring in notices;
  its exact-head CI must be checked after push.
- Next priority: verify vault exact-head CI, fix failures, then implement
  direct embedded RDP with certificate identity and disposable server coverage.
  IronRDP's web client requires an RDCleanPath-aware gateway, so a plain
  WebSocket-to-TCP bridge does not meet the direct-client requirement. Prefer
  native `ironrdp-client` with strict TLS/CredSSP before framebuffer/input IPC.
  Do not claim a functional RC from the vault slice alone.

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
