# Direct RDP certificate policy

The native IronRDP connection uses TLS, CredSSP, and either platform-root/name
validation or an explicit SHA256 pin of the server leaf certificate. A saved
pin is passed from the catalog to the native backend on both transient-password
and unlocked-Vault paths. Invalid pins fail before any connection. The pin is
compared during the TLS handshake, before CredSSP sends credentials.

IronRDP's upstream certificate callback runs only when platform validation
fails. That cannot enforce a saved pin against a different CA-valid certificate.
NodeDesk therefore uses a local, pinned copy of `ironrdp-tls` with a narrowly
scoped change: the callback runs for every presented certificate. A configured
pin accepts only its exact certificate, including a self-signed certificate;
a mismatch rejects even a publicly trusted certificate. Without a pin,
IronRDP retains strict platform-root and server-name validation. The TLS
callback does not expose the password or write certificate data to WebView.

The disposable hybrid RDP fixture uses a generated self-signed certificate
whose exact SHA256 pin is supplied to the client. It checks CredSSP login,
framebuffer decoding and mouse input. A unit test rejects a different
certificate and malformed pins. A second disposable fixture exchanges
CF_UNICODETEXT through CLIPRDR in both directions using in-memory backends.
Another forces a server transport loss and checks IronRDP's reconnect events
against the same pinned identity. These protocol fixtures do not prove the
desktop clipboard integration or native GUI interaction.

The direct RDP clipboard toggle is opt-in. On Windows, NodeDesk supplies
IronRDP's native clipboard backend with file transfer disabled, because the
upstream default enables clipboard file streaming. The clipboard switch grants
text synchronization only; no remote file transfer is implied. This path still
needs a native Windows text round-trip and clipboard teardown test. Linux uses
IronRDP's native clipboard backend and requires a native Arch round-trip test.
Terminal connection/authentication failures close the input channel and remove
the session from NodeDesk's registry so a failed connection can be retried.
Passwords are wrapped for wiping while NodeDesk validates the target and pin;
ownership then moves into IronRDP without an extra application-side clone.
IronRDP still holds and clones ordinary `String` credentials for reconnect,
so this does not establish complete password zeroization.

Native Windows and Arch GUI acceptance, clipboard round-trip, reconnect
acceptance, and guaranteed zeroization of all IronRDP password copies remain
**NOT TESTED**. No release may claim these gates as complete based only on CI.
