# NodeDesk development continuation

Updated: 2026-11-13. Work only on `feat/post-v0.9-roadmap`; draft PR #13.
The branch was fetched into the isolated `NodeDesk-rc` worktree because the
existing `NodeDesk` checkout has unrelated uncommitted work. Do not alter it.

## Current checkpoint

### 2026-11-13 RDP protocol fixtures and Arch package smoke test in progress

- Current pushed code HEAD remains `a4b7ff5de593871f7b4610112755a558c04487ff`;
  its [exact-head CI](https://github.com/RYLE-307/NodeDesk/actions/runs/43391658978)
  passed 6/6. PR #13 is Draft.
- Uncommitted RDP work adds a pinned disposable hybrid/CredSSP server with
  an in-memory CLIPRDR text exchange in both directions and a separate
  transport-loss/reconnect fixture. NodeDesk-owned passwords are wiped on
  failed configuration validation and moved into IronRDP without an extra
  application clone. IronRDP's own retained/copying `String` lifecycle is
  still open. These new fixtures are **NOT YET COMPILED OR RUN**; local MSVC
  `link.exe` is absent. Exact-head Windows/Ubuntu/Arch CI is required.
- The existing uncommitted packaging workflow change verifies Arch portable
  archive checksums and a disposable package install/uninstall in the CI
  container. It does not replace native Arch installation acceptance.
- Resume: inspect `git status`; preserve these edits; run Rust syntax and
  frontend tests; commit/push after the functional block; inspect only failed
  CI logs and fix failures. Native Windows/Arch RDP GUI, clipboard, reconnect
  and package acceptance remain **NOT TESTED**.

### 2026-11-13 VPN import rollback provenance fix pending CI

- Current code HEAD `a4b7ff5de593871f7b4610112755a558c04487ff`
  on `feat/post-v0.9-roadmap`; PR #13 remains Draft. Its
  [exact-head CI](https://github.com/RYLE-307/NodeDesk/actions/runs/43391658978)
  is in progress. The prior RDP clipboard policy [CI](https://github.com/RYLE-307/NodeDesk/actions/runs/43390076840)
  passed 6/6. The VPN import test fix [CI](https://github.com/RYLE-307/NodeDesk/actions/runs/43387378022)
  also passed 6/6. No native Windows/Arch GUI or installation acceptance was run.
- A before/after profile diff can include a profile created concurrently by
  another application. The import now parses NetworkManager's returned UUID
  under a fixed C locale and requires it to match the one new profile.
  Restriction and rollback use only that UUID. A cancelled or failed importer
  without a trustworthy UUID leaves any uncertain temporary profile for manual
  OS review; NodeDesk must never delete an unrelated system profile.
- Disposable mock `nmcli` now returns the import UUID; malformed and ambiguous
  outputs are rejected. Exact-head CI and native Arch race acceptance are
  pending. See `docs/VPN-IMPORT.md`.

### 2026-11-13 Direct VNC credential lifetime follow-up pending CI

- Vendored VNC layer wipes the reconnect-held password on teardown, the
  interactive answer held for retry on prompt teardown, the prior saved answer
  before replacement, and the X509Plain local password after making the
  already-wiped wire buffer. A unit test checks that the reconnect holder is
  emptied. This reduces retained copies but does **not** prove every transient
  `String` in the VNC library is wiped; that release gate remains open.
- Local Rust formatting parser and diff checks pass; semantic compilation and
  disposable protocol tests require exact-head CI because MSVC `link.exe` is
  unavailable here. Native Windows/Arch clipboard and GUI remain **NOT TESTED**.
- Also pending in the next push: direct RDP terminal error cleanup. Do not
  claim RDP clipboard/reconnect or VNC memory cleanup complete from compilation.

### 2026-11-13 Direct RDP Windows clipboard policy awaiting CI

- Pushed HEAD `97e6442ecc589c8c60a0da574fbf7463fb95579f`; [exact-head CI](https://github.com/RYLE-307/NodeDesk/actions/runs/43390076840)
  is running. The checkpoint commit `6d51f5c` preceded the RDP code commit.
- The code after VPN import configures IronRDP's native Windows clipboard with
  file transfer disabled when the user enables clipboard. The upstream default
  enables file streaming with the same toggle. Linux's native clipboard path
  is unchanged. See `docs/DIRECT-RDP-SECURITY.md`.
- Rust syntax and diff checks passed; local Windows semantic compilation is
  blocked by missing MSVC `link.exe`. Windows/Ubuntu/Arch exact-head CI is
  required. This closes only the Windows clipboard file-transfer consent gap;
  text roundtrip, reconnect, all password-copy wiping, and native Windows/Arch
  GUI acceptance remain **NOT TESTED**. Resume by checking CI on the pushed
  RDP HEAD and fixing any failure before continuing those gates.

### 2026-11-13 Linux VPN import, exact-head CI in progress

- VPN import code HEAD: `004f6ed3aed2a752fe4e9f859afbc10204341b74`
  on `feat/post-v0.9-roadmap`; PR #13 remains Draft. Import commits are
  `37d48a7`, `4551288` and the Rust test ownership fix `004f6ed`.
  [Exact-head CI](https://github.com/RYLE-307/NodeDesk/actions/runs/43387378022)
  is in progress. The previous run `43385204338` failed Ubuntu/Arch Rust
  compilation because a disposable test moved `args_file` before reusing it;
  `004f6ed` fixes that compile error. Windows/Ubuntu/Arch Rust and Playwright
  passed; Windows desktop packaging is still running. Do not claim 6/6 until
  that last job passes.
- The initial import [CI](https://github.com/RYLE-307/NodeDesk/actions/runs/43384419463)
  passed 6/6. On `004f6ed`, five jobs including Arch packaging passed;
  Windows desktop packaging is still running.
- Linux NetworkManager WireGuard/OpenVPN import uses private local files,
  temporary import, exact UUID verification, user-only access restriction,
  autoconnect disable, shared action serialization, cancellation and
  best-effort rollback. Rust mock CLI tests cover validation, argument shape,
  conflicts, cancellation and unavailable manager. Frontend unit/build and
  Playwright passed before the test fix; repeat exact-head CI for all platforms.
  See `docs/VPN-IMPORT.md`.
- Native Arch import/rollback, secret-agent behavior, brief pre-restriction
  autoactivation, route/DNS, and Windows VPN creation remain **NOT TESTED** or
  open. RDP clipboard roundtrip/reconnect/password lifecycle, VNC password
  cleanup, SSH/SFTP native acceptance, packaging native acceptance and P1
  remain open. The subsequent RDP change disables Windows clipboard file
  transfer pending exact-head CI. Next: finish exact-head CI, fix failures,
  then direct RDP clipboard/reconnect and credential lifecycle.
- Resume: `git status --short --branch`; fetch CI jobs for run `43387378022`;
  inspect only failed logs. Commit this checkpoint after a verified outcome,
  push, then continue direct RDP work without repeating the repository audit.

### 2026-11-13 Linux VPN import security follow-up awaiting exact-head CI

- Import implementation commit `37d48a7a96dbc3f7cbb7c7136c72c25add513b40`
  pushed on `feat/post-v0.9-roadmap`. Its [CI](https://github.com/RYLE-307/NodeDesk/actions/runs/43384419463)
  passed frontend/browser and Arch Rust tests at this update; Windows/Ubuntu
  Rust and desktop packaging were still running. Do not call this 6/6 yet.
- Local follow-up requires the source file to be private to its owner,
  exercises fixed `nmcli` modify/delete arguments and invalid-user/UUID
  rejection with a disposable executable, and adds a browser error case.
  Local frontend production build, Rust syntax parsing and diff check passed.
  Rust semantic compilation remains CI-only because MSVC `link.exe` is absent.
- Next: commit/push follow-up, verify exact-head CI, fix failures. Native Arch
  import, secret-agent behavior, auto-activation, route/DNS and rollback under
  OS races remain **NOT TESTED**. Then return to RDP clipboard/reconnect and
  password lifecycle, VNC cleanup, remaining VPN/SSH/SFTP/packaging P0.

### 2026-11-10 Linux VPN file import awaiting verification

- Last pushed HEAD before this block: `bb7d7db291ef35165524985d9db5209e54413631`
  on `feat/post-v0.9-roadmap`. Its [exact-head CI](https://github.com/RYLE-307/NodeDesk/actions/runs/42774801803)
  passed frontend/browser and Rust tests on Windows/Ubuntu/Arch at this
  update; desktop package builds remained in progress. PR #13 is Draft.
- Added explicit NetworkManager import for existing WireGuard `.conf` and
  OpenVPN `.ovpn` files. The native backend checks absolute regular files,
  refuses symlinks/oversize/unsupported types, imports temporarily with fixed
  `nmcli` arguments under the shared VPN mutation guard, rejects conflicting
  or active additions, restricts autoconnect and access to the current user,
  discards command output, and relists OS profiles. Cancellation kills the
  import process and attempts rollback of only one newly observed UUID.
  The UI clears the file path and never reads config content. NodeDesk does
  not request connection; NetworkManager auto-activation in the short import
  interval remains a native acceptance gate. See `docs/VPN-IMPORT.md`.
- Disposable Linux fixture tests validation and a mock `nmcli` executable;
  Playwright checks confirmation and IPC without config content. Local Rust
  compilation remains blocked by absent MSVC `link.exe`; exact-head CI is
  required. Local frontend 53 unit tests and production build pass; local
  Playwright did not start its WebServer and was stopped. Rustfmt parsing and
  `git diff --check` pass. Native Arch import, NetworkManager secret agent, routes/DNS and
  Windows profile creation are **NOT TESTED** or unimplemented as stated in
  the VPN document.
- Resume: finish frontend unit/build, Rust formatting/diff check; commit,
  push, inspect exact-head Windows/Ubuntu/Arch/browser CI and fix failures.

### 2026-11-10 direct RDP certificate pin enforcement awaiting CI

- Last pushed HEAD before this block: `477b46946822ac192f46e16d5795691204e58676`
  on `feat/post-v0.9-roadmap`. Its [exact-head CI](https://github.com/RYLE-307/NodeDesk/actions/runs/42773996036)
  passed frontend/browser and Rust tests on Windows/Ubuntu/Arch at this
  update; desktop packages were still running. PR #13 remains Draft.
- Direct RDP now forwards the saved leaf-certificate SHA256 pin to native
  IronRDP for both transient and Vault credentials. Invalid pins fail before
  connection. Vendored `ironrdp-tls` at pinned upstream revision with a narrow
  verifier patch so the callback rejects a changed certificate even if a CA
  validates it. Without a pin, strict system CA and host-name validation
  remains. See `docs/DIRECT-RDP-SECURITY.md`.
- The disposable hybrid CredSSP/framebuffer/mouse fixture uses its generated
  certificate pin. Added wrong-certificate/malformed-pin Rust test and browser
  pin handoff test. Local frontend unit tests (53), production build and
  formatting passed. Local Rust compilation is blocked by missing MSVC
  `link.exe`; all Rust changes require exact-head CI.
- Still open: direct RDP clipboard round trip, native reconnect acceptance,
  guaranteed wiping of all IronRDP password copies, native Windows/Arch GUI
  acceptance **NOT TESTED**. VNC native GUI and upstream password wiping also
  remain open. Continue P0 VPN and SSH/SFTP after these.
- Resume: `git status --short --branch`; commit/push this RDP pin block;
  inspect exact-head CI, fix failures; then continue remaining RDP gates.

### 2026-11-10 direct VNC fixture repair and native Vault handoff

- Branch `feat/post-v0.9-roadmap`; last pushed HEAD before this repair:
  `132efa25586ad57ed2e1a1fba804ea9d601a0c45`.
  [Exact-head CI](https://github.com/RYLE-307/NodeDesk/actions/runs/42770991213)
  passed frontend/browser and Windows/Ubuntu builds, but VNC Rust fixture
  failed on Windows/Ubuntu/Arch. The test shut the client down immediately
  after queueing input, before the fixture could read it. Reconnect fixture
  passed on all three systems. This change waits for server-observed input
  before shutdown; exact-head CI must confirm the repair.
- Added native Vault handoff for direct VNC. The UI offers explicit use of a
  saved credential; the backend reads only an unlocked VNC record bound to
  exact id, host, port and username. No saved password crosses WebView IPC.
  Added browser contract and Rust identity/lock tests. Local frontend unit
  tests (53), production build, Rust formatting and diff check passed. Local
  Rust linking remains unavailable without MSVC `link.exe`. This change is
  not yet verified by CI.
- Open gates: complete exact-head CI, live resize with disposable server,
  upstream password zeroization, and native Windows/Arch GUI acceptance
  **NOT TESTED**. Continue direct RDP memory/clipboard/reconnect, VPN and
  remaining P0/P1 after VNC verification. Do not merge, tag or release.
- Resume: `git status --short --branch`; run frontend unit/build locally;
  commit and push this repair; inspect exact-head CI jobs and only failed logs.

### 2026-11-10 direct VNC resize fixture in progress

- Repair/Vault commit `3cd3f4fe3bbc4f6cbc069e777fb189b11b12bfc1`
  pushed. [Exact-head CI](https://github.com/RYLE-307/NodeDesk/actions/runs/42773333004)
  passed frontend, browser and Rust tests on Windows/Ubuntu/Arch at this
  update; desktop packages were still running. Do not claim 6/6 yet.
- Added an ExtendedDesktopSize advertisement to the disposable X509Plain
  fixture and an assertion for the resulting SetDesktopSize request. This
  local change is **NOT YET TESTED by CI**. Finish Rust formatting and diff
  checks, commit/push and require exact-head Windows/Ubuntu/Arch CI.
- Native Windows/Arch VNC GUI, all library password copies zeroized and
  live server interoperability remain open release gates.

### 2026-11-10 direct VNC implementation awaiting exact-head CI

- Repair commit `95217a606093e3516de8f290c03984231658fbae` pushed;
  [exact-head CI](https://github.com/RYLE-307/NodeDesk/actions/runs/42770041989)
  passed Rust tests on Windows, Ubuntu and Arch plus browser/frontend. At
  this update Windows/Arch desktop packaging was still running.
- The next test change extends the disposable X509Plain fixture to check
  keyboard, pointer and clipboard in both directions and adds a two-connection
  reconnect fixture with a pinned generated certificate. Rust formatting
  passed; these additions are **NOT YET TESTED by CI**.

- Initial direct VNC commit `53df38289ec9c57a5195d9997c3a32aae8d18d8f`
  was pushed. Its [CI](https://github.com/RYLE-307/NodeDesk/actions/runs/42769204972)
  passed browser/frontend, but Rust compilation failed on Ubuntu and Arch
  (and Windows Rust test) on two local type errors: Tauri event error type
  inference and construction of non-exhaustive `image::Limits`. Both are
  fixed in the next commit. No protocol fixture ran in that CI.
- The same repair adds resize requests from the embedded view and prevents a
  duplicate session from spawning before the active-id check. Local frontend
  build and 53 unit tests passed; new Rust CI is still required.

- Branch `feat/post-v0.9-roadmap`; last verified pushed HEAD before this block
  `cabd6ede50bea3b4b04f77c3397a5dd461c5970a`. Its
  [exact-head CI](https://github.com/RYLE-307/NodeDesk/actions/runs/42681820162)
  passed 6/6, including Windows release/NSIS, Ubuntu desktop, Arch preview,
  browser and frontend. PR #13 remains Draft.
- Added native RFB/VeNCrypt client with X509Vnc/X509Plain only. Vendored
  DeskVNC `vnc-core` at `e80c515d94c5d91ec16f3bdb4439ed83c949437f`
  with MIT/Apache licenses, patched to reject cleartext/anonymous subtypes
  and verify the exact TLS SPKI pin before any password exchange. Added
  rectangle PNG framebuffer, keyboard/mouse, resize request, opt-in text
  clipboard, bounded reconnect/disconnect, UI and disposable loopback
  X509Plain positive/wrong-pin fixture. See `docs/DIRECT-VNC.md`.
- Local frontend tests: 53 passed; production build passed. Rustfmt and
  locked dependency resolution passed. Local Rust compilation is blocked by
  absent MSVC `link.exe`; the new Rust code and disposable fixture require
  Windows/Ubuntu/Arch CI before this block can be called verified.
- Open VNC gates: exact-head CI and fixture result; native Windows/Arch GUI
  acceptance **NOT TESTED**; clipboard round trip, resize and reconnect
  with a disposable server need dedicated coverage; password zeroization in
  every upstream library copy is unproven. Do not call VNC complete yet.
- Open RDP gates: guaranteed password zeroization in IronRDP, saved pin
  enforcement, clipboard round trip and reconnect native acceptance.
- Next: fix any VNC CI failures; add positive/negative disposable VNC
  clipboard/resize/reconnect checks; then finish RDP, Vault, VPN and remaining
  P0/P1 from roadmap. Do not merge, tag or release.
- Resume commands: `git status --short --branch`, `git rev-parse HEAD`,
  `npm test`, `npm run build`, `cargo test --locked --manifest-path
  src-tauri/Cargo.toml` in CI; inspect exact-head Actions jobs and their
  failing logs only.

### 2026-11-09 Vault to direct RDP native handoff (verification pending)

- Working branch `feat/post-v0.9-roadmap`; last pushed HEAD before this block
  `99c379bcc8555d68d608ded2ce4b761c845253a5`, with
  [exact-head CI](https://github.com/RYLE-307/NodeDesk/actions/runs/42680015865).
  Its disposable CredSSP/framebuffer/mouse test passed on Windows, Ubuntu and
  Arch. Windows/Arch release packaging was still running at this update.
- Added opt-in saved credential path from unlocked OS vault directly into the
  native IronRDP connector, bound to exact connection id, protocol, host,
  port and user. The saved secret is never returned to WebView for this path.
  Missing, changed or locked credentials fail before connection. Added Rust
  identity/lock test and browser UI contract test.
- Local frontend unit tests (52) and production build passed. Rust formatting
  passed; local Rust compilation remains unavailable without MSVC `link.exe`.
  This change requires exact-head Windows/Ubuntu/Arch and browser CI.
- Direct RDP still requires native GUI acceptance and memory zeroization in
  IronRDP; certificate pin and clipboard round-trip are not complete.
- Direct VNC remains next. The inspected DeskVNC `vnc-core` at
  `e80c515d94c5d91ec16f3bdb4439ed83c949437f` can negotiate cleartext
  VeNCrypt Plain and its TOFU path reports an unknown certificate after
  authentication. It must be restricted to certificate-verified X509 modes
  before use; do not integrate it unchanged. No real VNC host was contacted.
- Resume: inspect exact-head CI after commit; fix failures; implement direct
  VNC only with identity verification before password; then finish RDP/VNC
  acceptance, VPN and remaining P0/P1. Keep PR #13 Draft.

### 2026-11-09 disposable direct RDP framebuffer and input verification

- Working branch: `feat/post-v0.9-roadmap`. Last pushed HEAD before this block:
  `34e0825672a95f80044837c2c34cb983c1b123bb`. Its
  [exact-head CI](https://github.com/RYLE-307/NodeDesk/actions/runs/42676930307)
  has passed Rust tests on Windows, Ubuntu and Arch, browser tests, and
  frontend jobs; Windows release packaging was still running at this update.
- The local-only IronRDP hybrid fixture now sends a 2×2 bitmap and records a
  client mouse event. Its test requires CredSSP connection, a decodable
  framebuffer and server-observed input before success. No real host is used.
- Verification for this new test: Rust formatting passed; local Rust compile
  remains unavailable because MSVC `link.exe` is absent. Exact-head CI after
  commit is required. Windows/Arch native GUI acceptance remains NOT TESTED.
- Next: repair any CI failure, then implement direct VNC with server identity
  checked before password; keep direct RDP memory wiping, certificate pinning,
  clipboard round-trip and reconnect acceptance open until independently tested.
- Resume: `git status --short --branch`; inspect the newest exact-head Actions
  run; `npm test`; `npm run build`; `cargo test --locked --manifest-path
  src-tauri/Cargo.toml` on CI; keep PR #13 Draft.

### 2026-11-09 direct RDP implementation in progress (CI repair)

- Branch `feat/post-v0.9-roadmap`; last verified pushed HEAD before this work
  is `c938076`. Its [exact-head CI](https://github.com/RYLE-307/NodeDesk/actions/runs/42581103542)
  passed 6/6, as did [VNC CI](https://github.com/RYLE-307/NodeDesk/actions/runs/42580735514)
  and [RDP/NSIS CI](https://github.com/RYLE-307/NodeDesk/actions/runs/42580185235).
- Reviewed IronRDP's published `ironrdp-client 0.1.0`: its `ironrdp-tls`
  verifier unconditionally accepts certificates. Do **not** use that release
  for direct RDP. The current implementation pins upstream revision
  `b553ed4315655d9003e37d7bcae13a029405b845`, which exposes explicit
  `CertificateValidation::Strict`, and sets CredSSP on while disabling the
  legacy TLS login path.
- Added an IronRDP direct client backend with bounded framebuffer PNG events,
  keyboard/mouse input, resize, bounded automatic reconnect and close on tab
  or window teardown. The UI never writes the password or frame to WebView
  storage. Saved SHA256 pins fail closed because the new path does not yet
  enforce an additional pin. The existing Guacamole and external modes stay
  available.
- Initial direct-client commit `92bdfc6` is pushed. Its [CI run](https://github.com/RYLE-307/NodeDesk/actions/runs/42612441172)
  found a React StrictMode test failure and a Rust compile failure: IronRDP's
  `run()` future is not `Send`, and a test local shadowed the config function.
  The current change fixes the mount cleanup, runs IronRDP on a dedicated
  current-thread Tokio `LocalSet`, releases input on blur/view-only, and adds
  Arch `cmake` prerequisite. Its exact-head CI is pending. Local frontend unit
  tests (52) and production build passed; Rust formatting completed, but local
  Rust compilation is blocked by absent MSVC `link.exe`. Do not call this path
  verified until Windows, Ubuntu, Arch and browser CI pass.
- Repair commit `f57753425b67bc44e22858da9b57a5ef5c0c2d79` is pushed;
  [CI 42613611254](https://github.com/RYLE-307/NodeDesk/actions/runs/42613611254)
  has passed browser, both frontend jobs and Ubuntu desktop; Arch and Windows
  desktop were still running at the time of this checkpoint update.
- The clipboard commit adds common physical keys, exact pointer
  coordinates on mouse button events and an explicit per-session opt-in for
  IronRDP's native OS clipboard backend. Clipboard stays disabled by default;
  enabling it permits the remote machine to read/change the OS clipboard.
  Browser fixture checks default off and opt-in, and Rust config test checks
  the redirection property. Real clipboard exchange on Windows/Arch remains
  **NOT TESTED**. The pinned IronRDP revision stores the password in a regular
  String and does not promise memory wiping; this remains an open security
  gate, even though it never enters persistent WebView storage.
- Clipboard commit `be571194d1b557b9015960c8d3e41e9b779311d1` is pushed.
  [CI 42615017352](https://github.com/RYLE-307/NodeDesk/actions/runs/42615017352)
  found a Rust **test-only** method resolution error in the clipboard property
  assertion on Ubuntu. The follow-up uses `PropertySet::get` directly and
  requires a new exact-head CI. Browser and both frontend jobs passed.
- Test repair commit `e79f6de66828a4483809763744b6a09fced9e238`
  is pushed. [CI 42615689103](https://github.com/RYLE-307/NodeDesk/actions/runs/42615689103)
  passed **6/6**: browser, both frontend jobs, Ubuntu and Windows desktop,
  and Arch preview including the Windows release build and package checks.
- Commit `2d5e59f66fce86f53341a79076243e89e6deed0a` adds a disposable
  loopback TLS peer with a generated self-signed certificate and verifies
  IronRDP's strict verifier refuses it. Its [CI 42672251014](https://github.com/RYLE-307/NodeDesk/actions/runs/42672251014)
  is still running. The current uncommitted follow-up uses IronRDP's own
  server API as a disposable loopback **CredSSP hybrid** fixture, with an
  exact-certificate callback solely inside the test. Production config has
  no callback and continues to require platform trust. The fixture checks
  authentication/connection, not a native GUI or full clipboard exchange.
- Disposable server fixture commit `86fa1dc05348434b5783b351b781cc8d1c509226`
  is pushed. [CI 42673727810](https://github.com/RYLE-307/NodeDesk/actions/runs/42673727810)
  failed the new CredSSP integration assertion on Ubuntu and Arch (82 other
  Rust tests passed). The local follow-up now records sanitized fixture-only
  connection/termination diagnostics and checks that the server task stayed
  alive before connect. Do not treat this integration as passed; fix the
  specific handshake/fixture defect and rerun exact-head CI.
- Diagnostic commit `6bfe3ab1c543a5bd190835bf01b97f33528919df`
  is pushed. [CI 42674925257](https://github.com/RYLE-307/NodeDesk/actions/runs/42674925257)
  identified the actual fixture defect: IronRDP's `NoopDisplay` advertises
  0×0, which the client correctly rejects after CredSSP during capability
  exchange. The local fix supplies an 800×600 disposable display handler;
  rerun the fixture on Windows, Ubuntu and Arch. This failure does not show a
  production RDP regression.
- Display fixture fix `7bb58adca91a0f8dd9ce01de702133b70c4fb7e2`
  is pushed. [CI 42676326639](https://github.com/RYLE-307/NodeDesk/actions/runs/42676326639)
  stopped before Rust tests because the newly direct `async-trait` dev
  dependency had not been reflected in Cargo.lock. The follow-up updates only
  the lockfile; run exact-head CI before assessing the display fixture.
- VNC library review: `madeye/rv` accepts anonymous TLS subtypes; DeskVNC's
  `vnc-core` rejects them but its trust-on-first-use flow can authenticate
  before showing an unknown-certificate prompt. Do not bind NodeDesk secrets
  to that flow without a strict CA-or-pin gate before VNC authentication.
  Native RDP against a disposable Windows server, clipboard, certificate
  error UX and Windows/Arch GUI acceptance remain **NOT TESTED** or incomplete.
- Next: finish direct RDP CI, add disposable TLS/CredSSP fixture and native clipboard acceptance,
  then direct VNC, vault binding and remaining P0/P1. Never use real servers.

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

1. Verify exact-head [CI for VPN rollback provenance](https://github.com/RYLE-307/NodeDesk/actions/runs/43391658978)
   on code HEAD `a4b7ff5de593871f7b4610112755a558c04487ff`;
   fix any compiler or test failure before treating that change as verified.
2. Complete direct RDP clipboard roundtrip, reconnect fixture and password
   lifecycle; complete VNC transient credential cleanup. Continue VPN native
   lifecycle/route/DNS evidence, SSH/SFTP, packaging and the remaining P1.
   Native Windows/Arch GUI and installation acceptance remain NOT TESTED.

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
