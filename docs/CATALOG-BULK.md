# P1 catalog bulk operations (CAT-04 slice)

NodeDesk supports opt-in bulk editing of up to 50 selected SSH/RDP/VNC
catalog connections. Toggle **Bulk edit**, select rows with explicit
checkboxes and choose one of:
- **Move selected** to a root or an existing group.
- **Favorite selected**.
- **Unfavorite selected**.

Every action requires confirmation with the selected count and persists
as one catalog update. The helper rejects unknown/duplicate/stale IDs,
overlarge selections, invalid groups or unrecognized changes before any
write. Persistence failure is reported without updating in-memory catalog.
Canceling the confirmation does not change anything. Turning off bulk mode
clears the temporary checkbox selection. Unrelated entries and the
connection identity (IDs, hosts, ports, usernames, protocols, certificate
pins) are never changed; OS Vault associations remain unchanged.

This action is metadata-only. It never starts a connection, disconnects
existing workspace tabs, imports secrets or invokes a server command.
Bulk deletion and remote profile changes are intentionally not provided.

Pure Node tests and Playwright tests use synthetic catalogs with no real
server/secret references. Windows/Arch native acceptance remains NOT TESTED.
