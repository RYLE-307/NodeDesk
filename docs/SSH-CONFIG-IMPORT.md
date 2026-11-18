# OpenSSH config bulk import (P1 catalog)

**Import SSH config** reads only the existing NodeDesk native
ssh_config_preview command, and only when a user explicitly clicks the
button. That native preview reads a regular UTF-8 ~/.ssh/config (maximum
64 KiB; symlinks and non-regular files rejected). It does not evaluate
Include, Match, shell commands, ProxyCommand, ProxyJump or config
substitutions, and currently returns up to 40 literal Host entries.

The UI accepts only the four preview fields:
- Host alias (catalog display name)
- literal HostName / host
- TCP port
- username (possibly blank)

Import requires a separate confirmation showing the count. It appends
to the catalog through mergeCatalog, which generates new IDs for every
entry so they never accidentally match existing OS-Vault credential
records. No keys, passwords, commands, forwarding or proxy settings
are saved, and **no connection starts automatically**.

Blank User entries require editing before NodeDesk's SSH client can
connect. Advanced SSH config behavior is intentionally not carried into
NodeDesk. Repeated imports create duplicate entries by design. An empty,
invalid, unavailable or overly large preview leaves the catalog intact.

Node/Playwright tests use synthetic preview data. No real SSH config,
server, key or private path was read during development. Native GUI
Windows/Arch preview and import acceptance: **NOT TESTED**.
