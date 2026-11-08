# NodeDesk third-party software notices (v0.7 release candidate)

NodeDesk's own code is MIT-licensed; see [LICENSE](../LICENSE). A distribution
that bundles dependencies must retain their applicable copyright/license
notices. These direct runtime dependencies and their license identifiers are
recorded in the committed npm lockfile. Versions are **the locked versions**,
not an assertion about transitive packages.

| Package | Locked version | License |
| --- | --- | --- |
| `@novnc/novnc` | 1.7.0 | MPL-2.0 |
| `@pelotech/guacamole-common-js` | 1.6.0 | Apache-2.0 |
| `@tauri-apps/api` | 2.12.4 | Apache-2.0 OR MIT |
| `@xterm/addon-fit` | 0.10.0 | MIT |
| `@xterm/addon-search` | 0.15.0 | MIT |
| `@xterm/xterm` | 5.5.0 | MIT |
| `react` | 19.3.1 | MIT |
| `react-dom` | 19.3.1 | MIT |

For a packaged binary, also review full transitive npm and Cargo dependency
licenses and any bundled native libraries; this table alone is **not a complete
binary SBOM**. Redistributors must satisfy the MPL-2.0 source and notice
obligations for noVNC-covered files; the presence of an MPL dependency does
not relicense NodeDesk's own MIT sources.

This development branch also directly uses `sysinfo` 0.39.6 for local metrics
(MIT license). Its transitive licenses still require a release audit.

Upstream resources:
- [noVNC license / source](https://github.com/novnc/noVNC)
- [Apache Guacamole client code](https://github.com/apache/guacamole-client)
- [Tauri](https://github.com/tauri-apps/tauri)
- [xterm.js](https://github.com/xtermjs/xterm.js)
- [React](https://github.com/facebook/react)

The built executable has not yet been manually accepted on native Windows
and Arch. No release archives or third-party binaries are claimed here.
