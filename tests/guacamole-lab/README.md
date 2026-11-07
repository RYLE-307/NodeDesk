# Disposable Guacamole + RDP integration lab

This is a **test fixture, not a production deployment**. It starts Apache
Guacamole 1.6.0, guacd, PostgreSQL, a disposable Ubuntu Xfce/xrdp host, and
a Caddy HTTPS/WSS reverse proxy. Only
`https://localhost:8443/guacamole/` is published on **127.0.0.1**.
PostgreSQL, guacd, and xrdp have **no host ports**. The Docker network
is internal. Do **not** attach real Windows endpoints or office VPNs.

## First run on an isolated Arch/Linux test machine

Prerequisites: Docker, Compose v2, Python 3, Node.js 24 for the scripted
verification, and free disk space for the container images.

```bash
cd ~/NodeDesk
git switch feat/v0.6-rdp-launcher
git pull --ff-only origin feat/v0.6-rdp-launcher
cd tests/guacamole-lab
bash prepare.sh
docker compose up -d
docker compose ps
```

`prepare.sh` obtains Guacamole's **official** PostgreSQL init schema,
generates independent random passwords for PostgreSQL, admin, QA user and
the disposable xrdp user, replaces Guacamole's predictable default admin
password in the initial database, grants the non-admin QA user **READ**
access to exactly one RDP connection, and creates ignored files
`.env` and `generated/init/*.sql` with permissions 0600. Never post
or commit those files or share their contents.

The QA RDP connection intentionally sets `ignore-cert=true` for this
**isolated, self-signed disposable xrdp container only**. This setting
is not used by NodeDesk, and must **never** be copied into production
RDP connection profiles. The third-party xrdp image is
`danchitnis/xrdp:ubuntu-xfce`; its launch arguments carry the generated
test password in the **Docker metadata**. Use fake credentials only.

## TLS CA trust and smoke test

Caddy issues a **test-only** localhost TLS certificate using its private
internal CA. Export its public root certificate:

```bash
docker compose cp proxy:/data/caddy/pki/authorities/local/root.crt generated/caddy-root.crt
curl --cacert generated/caddy-root.crt https://localhost:8443/guacamole/
```

For a Node.js smoke test of **actual** Guacamole 1.6 login, RDP profile
authorization, trusted WSS handshake and initial framebuffer instructions:

```bash
set -a
source .env
set +a
NODE_EXTRA_CA_CERTS="$PWD/generated/caddy-root.crt" \
  node --experimental-strip-types verify.mjs
```

The test validates the certificate using `NODE_EXTRA_CA_CERTS`, not
`NODE_TLS_REJECT_UNAUTHORIZED=0`. It must print **PASS** only after it
observes a ready RDP session and at least one framebuffer/sync/size
instruction. This checks the *Linux xrdp disposable peer* and backend
Guacamole protocol, **not** the real Windows RDP experience.

To use the NodeDesk embedded RDP panel, your **test OS/WebView must trust**
this localhost test CA. In an isolated VM, import the public CA to the
OS/user trust store. Do not globally trust this CA on a production
workstation; remove it after testing. If you prefer not to modify trust,
use a separate disposable test VM. Never disable certificate validation
in NodeDesk or launch Chrome with certificate checks turned off for
production use.

Log in using the `QA_USER` and `QA_PASSWORD` values from the private
`.env`; **do not use guacadmin** for routine testing. In the NodeDesk
RDP tab, enter `https://localhost:8443/guacamole/`, sign in and choose
`NodeDesk QA xrdp`. Click Connect embedded only after acknowledging
Guacamole's URL-token behavior. Passwords/tokens must not appear in
localStorage or NodeDesk logs.

### Exact-origin CORS

The Caddy reverse proxy permits only the one development origin given by
`NODEDESK_ORIGIN`, initially `http://127.0.0.1:1420`. The **packaged Tauri
WebView's Origin may differ** depending on OS/build. Inspect the actual
request origin in WebView developer tools, put that exact origin into
your **ignored** `.env` (not a wildcard), then recreate the proxy:

```bash
docker compose up -d --force-recreate proxy
```

There is no `Access-Control-Allow-Credentials` header: Guacamole uses
explicit scoped account tokens and the NodeDesk REST client does not
send cookies. Caddy does not enable access logging, because Guacamole's
own protocol embeds temporary session tokens in query parameters. Review
upstream logging and avoid proxy traffic dumps, diagnostic screenshots
of requests, and credentials in terminal history.

## Shutdown / reset

```bash
docker compose down -v --remove-orphans
# To start completely fresh, also remove ignored secrets and generated SQL:
rm -rf generated/ .env
```

`down -v` removes the isolated PostgreSQL and Caddy volumes for **this
Compose project**. Do not run it from another project's directory.

## CI and limitations

The GitHub Actions workflow
[Disposable Guacamole RDP integration](../../.github/workflows/guacamole-lab.yml)
builds this same isolated fixture, verifies HTTPS with the generated CA,
does a **real remote xrdp/Guacamole WSS protocol handshake**, and tears
down the volumes and credentials on completion. It does not check pixel
appearance, keyboard layouts, user input accuracy, WebView CA trust,
Guacamole CORS on the packaged app or a Windows RDP server.

These remain separate manual acceptance items before PR #11 can be
merged. Keep the existing v0.5 main branch untouched until then.

References:
- [Official Guacamole Docker installation](https://guacamole.apache.org/doc/1.6.0/gug/guacamole-docker.html)
- [Official PostgreSQL authentication setup](https://guacamole.apache.org/doc/1.6.0/gug/postgresql-auth.html)
- [Guacamole protocol](https://guacamole.apache.org/doc/1.6.0/gug/protocol-reference.html)
- [XRDP QA image source](https://github.com/danchitnis/container-xrdp)
