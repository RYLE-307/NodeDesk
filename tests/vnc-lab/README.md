# Disposable local VNC/WSS lab

This lab starts a throwaway Xvfb desktop, password-protected x11vnc,
websockify and a Caddy HTTPS/WSS proxy. Only `127.0.0.1:8444` is published;
raw VNC and websockify have no host ports. The VNC password and Caddy CA are
generated locally under ignored `generated/`. Use fake test data only.

## Arch WSL2 setup

Prerequisites: Docker/Compose v2, Python 3 and the same NodeDesk checkout used
for the Guacamole test. From the repository root:

```bash
cd tests/vnc-lab
bash prepare.sh
docker compose up -d --build
docker compose cp proxy:/data/caddy/pki/authorities/local/root.crt generated/caddy-root.crt
curl --cacert generated/caddy-root.crt https://localhost:8444/rfb
```

The final request can return HTTP 400/404 without a WebSocket upgrade; its
purpose is to verify the certificate chain. Never use `curl -k`, cleartext
`ws://`, or `NODE_TLS_REJECT_UNAUTHORIZED=0`.

The NodeDesk Tauri/WebKitGTK process must trust the **public** temporary CA
before opening WSS. On an isolated Arch WSL2 test instance, import that
certificate into the trust store used by WebKitGTK, as was done for the
Guacamole lab. Confirm it with a normal certificate-verified HTTPS request.
Do not copy the private Caddy key or add the test CA to a production machine.
The generated Caddy CA here is separate from the Guacamole lab CA; both can
be trusted for the duration of this isolated test.

Open a disposable VNC catalog entry (host `127.0.0.1`, port `5900` is just
catalog metadata for embedded mode), enter `wss://localhost:8444/rfb` in
**Embedded VNC**, and click **Connect embedded**. Read the password from the
private local file without pasting it into chat or logs:

```bash
cat generated/vnc-password
```

Enter it only in NodeDesk's VNC password prompt. Verify the desktop and
light terminal are visible **inside** the tab, mouse and keyboard input work,
view-only blocks input, then disconnect and close the tab. Test an incorrect
password and an untrusted certificate separately. The classic VNC password
scheme uses eight bytes; this lab is restricted to loopback and disposable
data. It does not claim the external TigerVNC X.509-only policy.

## Automated check and cleanup

The [VNC CI workflow](../../.github/workflows/vnc-lab.yml) imports the
temporary public CA into an ephemeral Linux runner and runs the live
Playwright test. It checks the real password challenge and visible framebuffer
pixels in Chromium, not native Tauri/WebKitGTK or Windows WebView2.

```bash
docker compose down -v --remove-orphans
rm -rf generated
```

Run cleanup only from this lab directory after the test. The generated files
are ignored by Git. The workflow removes the lab containers and secrets even
on test failure.
