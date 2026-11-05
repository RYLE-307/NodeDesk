# NodeDesk

[Русский](README.md) · **EN**

An offline-first infrastructure workspace for Windows and Linux, built with
Tauri 2, React, TypeScript and Rust. Target: MobaXterm feature parity plus VPN,
Proxmox, Zabbix and MikroTik integrations.

This initial scaffold provides a Tech Dark shell, collapsible navigation,
RU/EN switching and an empty workspace with a reserved top tab strip.
No remote connections, saved catalog, functional tabs, split panes or monitoring
are implemented yet. No sessions open automatically.

The earlier chat's starter archive was not available in this session. This is
a new scaffold, not a recovered or verified version of that archive.

## Development

Install Node.js 22.12+, npm, stable Rust and the
[Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
npm install
npm run dev
npm run build
npm run tauri dev
```

Dependency installation requires internet; runtime is intended to work without
a mandatory cloud account. Packaging is disabled pending platform validation,
icons and license review. Commit package-lock.json and Cargo.lock after resolving
dependencies, then switch to npm ci. See [validation status](docs/BOOTSTRAP.md).

See [parity](docs/MOBAXTERM-PARITY.md), [architecture](docs/ARCHITECTURE.md)
and [roadmap](docs/ROADMAP.md). Monitoring will be optional and off by default.

