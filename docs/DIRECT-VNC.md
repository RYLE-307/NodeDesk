# Direct VNC security and verification

The native client connects to the RFB endpoint without Guacamole or a WebSocket
gateway. It uses a pinned DeskVNC RFB core (`e80c515d94c5d91ec16f3bdb4439ed83c949437f`)
with a local policy patch under `src-tauri/vendor/deskvnc-vnc-core`. The code is
dual licensed MIT/Apache-2.0; its license texts are retained beside the source.
The patch prohibits VeNCrypt Plain, anonymous TLS, and unauthenticated X509None.
NodeDesk requests only VeNCrypt and requires an exact SHA256 fingerprint of the
server certificate's SubjectPublicKeyInfo. The fingerprint is compared after
TLS and **before** X509Vnc or X509Plain password authentication, including when
the certificate also validates against a public CA. A missing or changed pin
terminates the connection; there is no TOFU prompt after password submission.

Get the SPKI fingerprint from a trusted administrator or independently trusted
management channel. An administrator with the server certificate can compute it:

```sh
openssl x509 -in server.crt -pubkey -noout |
  openssl pkey -pubin -outform DER |
  openssl dgst -sha256
```

The session password and pin are passed through native IPC at connect time.
Alternatively, an explicitly selected saved password is read by the native
backend from the unlocked OS Vault using the exact connection identity; that
password is never returned to WebView. The password input is cleared immediately
and neither value is saved to the catalog, WebView storage, a URL, a process
argument, or a log. Clipboard text
transfer requires per-session opt-in and explicit user actions; it is off by
default. On tab close, disconnect cancels the native session. Reconnect is
limited to three attempts. X509Vnc uses classic VNC DES authentication and
truncates the password to eight bytes; use X509Plain where the server supports
it for a full username and password exchange inside verified TLS.

The disposable tests use loopback RFB/VeNCrypt X509Plain servers with generated
certificates. They check that the wrong pin receives no password, and that a
matching pin permits authentication, framebuffer, keyboard, pointer and text
clipboard exchange. The input fixture also advertises ExtendedDesktopSize and
checks a SetDesktopSize request. A separate fixture drops the first connection
and checks that the client reconnects to the same pinned server. The resize
extension requires exact-head CI confirmation. Native Windows and Arch GUI
acceptance remains **NOT TESTED**. The pinned upstream
credential type uses ordinary `String` values. NodeDesk's vendored VNC layer
now wipes the reconnect holder at teardown, the stored interactive answer at
prompt teardown, the old answer before replacement, and the X509Plain local
password and wire buffer after encoding. The native connection builder also
wipes its input password when target or pin validation fails, before it can
reach the VNC core. The credential prompt path clones a saved password only
when that credential actually satisfies the selected security method. Other transient library copies still
need review before guaranteed password zeroization can be claimed.

## 2026-11-18 — VeNCrypt plaintext-auth write-buffer lifetime

The serialized X509Plain username/password payload is now held in a
`zeroize::Zeroizing<Vec<u8>>` across the asynchronous TLS write. If that
write fails or the task is dropped mid-await (for example, on cancellation),
the owned buffer is wiped on Drop; the previous explicit wipe ran only
after `write_all` completed. The password string is separately held in
`Zeroizing<String>`. A Rust unit test checks the wire payload and the
RAII-protected type; existing disposable X509Plain/TLS/SPKI fixtures remain
the protocol-level verification.

This is a targeted reduction of one residual secret-copy risk, **not**
proof that every password copy in the remote-core/transport/OS library is
securely erased. Full RDP/VNC memory audit and native Windows/Arch acceptance
remain open.

## 2026-11-18 — duplicate-session rejection

The direct VNC entrypoint now holds the incoming password in
`Zeroizing<String>` **before** acquiring the active-session registry
mutex. A duplicate ID or poisoned registry returns without creating
library `ConnectOptions`; no unguarded password-bearing configuration
is dropped on these refusal paths. Once accepted, the options are
transferred to the VNC session supervisor (which wipes its stored
credential when the session is torn down). This does not prove all
third-party temporary copies are eliminated.

## 2026-11-18 — Vault credential handoff without a new plaintext clone

The saved direct VNC entrypoint now moves the `Zeroizing<String>` returned
by the native Vault into a private guarded connect helper. Previously it
called `secret.to_string()` merely to use the public IPC signature,
creating another unprotected String allocation before wrapping it. The
explicit-password IPC still wraps its received String on entry. This
is a narrow elimination of one copy, not a claim that the VNC protocol
library or OS transport erases every transient credential buffer.

## 2026-11-18 — saved-credential preflight

The native saved-VNC path now validates public target ID, endpoint,
username, SPKI SHA256 pin and TLS key-logging policy, and checks whether
the session ID is already active, **before** reading the password from
the OS Vault. The internal session registry repeats the duplicate
check after the read to protect against concurrent starts. The same
public preflight runs when creating VNC protocol options; all earlier
certificate trust requirements are unchanged. This does not prove
third-party memory zeroization.


## 2026-11-23 — VNC pointer input follows the live server framebuffer

Native VNC pointer input is now checked against the framebuffer size most
recently announced by the server, rather than only against the library's
maximum supported dimensions. Until the first valid DesktopResize event,
pointer input is rejected. The active viewport is reset when the session
enters reconnecting or disconnected state and becomes valid again only after
the server announces its framebuffer size. Keyboard, clipboard and explicit
resize-request handling are unchanged.

The current dimensions are shared between the native session event consumer
and the Tauri input command. The input check is independent of WebView
validation. Rust tests cover unknown dimensions, exact last pixels, each
out-of-bounds edge, post-resize dimensions and invalid button masks.
This verifies client-side input bounds; it does not prove the remote OS
accepted an input event or a requested resize. Native Windows/Arch GUI
acceptance remains NOT TESTED.
