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
The password input is cleared immediately and neither value is saved to the
catalog, WebView storage, a URL, a process argument, or a log. Clipboard text
transfer requires per-session opt-in and explicit user actions; it is off by
default. On tab close, disconnect cancels the native session. Reconnect is
limited to three attempts. X509Vnc uses classic VNC DES authentication and
truncates the password to eight bytes; use X509Plain where the server supports
it for a full username and password exchange inside verified TLS.

The disposable tests use loopback RFB/VeNCrypt X509Plain servers with generated
certificates. They check that the wrong pin receives no password, and that a
matching pin permits authentication, framebuffer, keyboard, pointer and text
clipboard exchange. A separate fixture drops the first connection and checks
that the client reconnects to the same pinned server. The new input, clipboard
and reconnect fixtures require exact-head CI confirmation. Native Windows and
Arch GUI acceptance and live resize remain **NOT TESTED**. The pinned upstream
credential type uses ordinary `String` values, so guaranteed password
zeroization in all library copies is also an open security gate.
