# OS credential vault (review implementation)

NodeDesk stores opt-in credentials in Windows Credential Manager or a Linux
desktop Secret Service implementation through the `keyring` crate. It never
falls back to plaintext. On Arch, a running and unlocked Secret Service provider
is required; `gnome-keyring` is one option. Automated CI compiles the backend
and tests a disposable in-memory store, but does not prove either desktop's
native keyring behavior. Windows CI also writes and removes one disposable
Credential Manager record under its throwaway runner account. Native Windows
GUI and Arch Secret Service QA remain **NOT TESTED**.

## Boundary and lifecycle

- The application starts locked. **Unlock** probes the OS store and opens an
  application-level gate; **Lock**, window destruction and process exit close
  that gate. Lock does not lock the entire OS keyring or revoke other programs'
  same-user access. The OS is responsible for at-rest encryption and user
  session access control.
- A credential is keyed by protocol and catalog UUID. The record includes the
  exact host, port and username. Read and replacement fail if those fields
  changed; the operator must explicitly delete the old record before saving
  for a changed target. Catalog import does not copy OS credentials; an
  imported record with the same ID and exact endpoint can still match an
  existing OS item after unlock. The import confirmation warns about this.
- No existing NodeDesk release saved credentials, so there is no plaintext
  credential migration. Catalog v1 import/export continues to strip unknown
  secret fields. OS keyring items are not included in catalog backups.
- The native API enforces an unlocked gate, identity validation and 1–1024
  UTF-8 byte secrets. It returns generic errors without secret contents.
  Secrets in the native process are zeroized where owned; the OS library and
  WebView runtime may make additional transient copies.
- The UI keeps newly entered password values out of React state and clears
  the input after use. **Saved credentials cannot be revealed or returned to
  the WebView.** The formerly supported `vault_get` IPC endpoint and
  **Reveal** control were removed on 2026-11-18 to close a credential-exposure
  path. Credential retrieval for embedded RDP/VNC is native-only, bound to
  the exact catalog ID, protocol, host, port and username after vault unlock.
  User-entered passwords still necessarily pass through the input WebView
  when initially saved; the OS store and third-party libraries may create
  additional temporary copies. Stored secrets are not included in catalog
  export, localStorage, sessionStorage, process arguments or logs.

## Current limits and acceptance

The vault provides write, presence-check and delete operations to WebView,
but **no secret-read IPC operation**. SSH password/PAM remains at the
terminal's hidden prompt. Embedded direct RDP/VNC clients can retrieve the
saved credential inside the native backend, tied to the validated target and
certificate trust; the credential is never returned to WebView. The native
RDP/VNC third-party protocol libraries may still retain additional password
copies, which remains a separate open security gate. Do not send a stored
password in response to an untrusted remote prompt.

Before closing SEC-01, test native Windows Credential Manager and Arch Secret
Service unlock/lock, save/read/delete, missing or locked OS store, restart,
endpoint changes, catalog import/export and WebView storage inspection with
disposable credentials. Review local same-user threat boundaries and the
dependency/license notices. No real user secrets or servers are test fixtures.

Backend reference: [keyring 3.6 documentation](https://docs.rs/crate/keyring/3.6.3).
