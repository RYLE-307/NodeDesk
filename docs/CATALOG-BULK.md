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


## Export selected connections (2026-11-18)

**Bulk edit → Export selected** creates a bounded, manually downloaded
NodeDesk JSON catalog with only the selected SSH/RDP/VNC endpoints and the
ancestor groups required to preserve their folder hierarchy. This allows
sharing subsets through the existing **Merge catalog** flow. The export
requires separate confirmation because hostnames, IP addresses, usernames
and group names may themselves be sensitive.

The serialized data is decoded using the catalog allowlist. All group and
connection IDs are regenerated before export, so even **Replace catalog**
on another machine cannot silently reuse the recipient's OS-Vault binding
by importing the original connection ID. Saved secrets, unknown fields,
private-key paths, certificates and RDP certificate fingerprints are omitted.
Imported RDP trust must be established again; no server is auto-connected.
Catalog display preferences in the subset use defaults and are ignored by
Merge catalog. The source catalog, current sessions and selection remain
unchanged.

Cancellation makes no download; unknown IDs, duplicate selections,
ID collisions and >50 selected rows fail closed. Unit and Playwright tests
use synthetic addresses only. Native Windows/Arch file-download acceptance
remains **NOT TESTED**.
