# Linux NetworkManager VPN file import

NodeDesk can import an existing WireGuard `.conf` or OpenVPN `.ovpn` file on
Linux with an explicit user click and confirmation. The user supplies an
absolute local path. The native backend verifies a regular, non-symlink file
of 1–262144 bytes with owner-only permissions (mode 0600), checks for a
same-name profile, and invokes
`/usr/bin/nmcli connection import --temporary type ... file` with a fixed
argument list and no shell. It then requires exactly one new, inactive profile
of the requested kind, disables autoconnect, restricts access to the current
OS user, and makes the profile persistent. The importer runs under a fixed C
locale; its returned UUID must match the newly listed profile. Rollback uses
only that UUID, even if another program creates a profile concurrently. If
the importer fails or is cancelled before returning a trustworthy UUID,
NodeDesk cannot safely choose a profile to delete and asks for manual review.
If NetworkManager becomes unavailable during rollback, a temporary profile
may remain. The path
is immediately cleared from
the WebView input and never saved to the catalog or WebView storage. File
contents, keys and passwords never enter WebView; NetworkManager owns imported
profile settings and secrets. NodeDesk does not explicitly connect during
import. NetworkManager could apply an auto-connect policy in the brief interval
before the new profile is restricted, so native acceptance must verify this
on disposable profiles; do not import a production profile before that gate.

OpenConnect profiles can be managed after they are configured in
NetworkManager. Windows built-in IKEv2/L2TP/SSTP profiles likewise remain
system-owned; this file import command is unavailable there. A profile can
still require a NetworkManager secret agent or OS authorization at connect.
The file path, as opposed to its contents, is passed as an OS process argument
because `nmcli` requires it; use a neutral filename if its name is sensitive.
NodeDesk parses only the import UUID and discards other `nmcli` stdout and
stderr from the UI and logs.

Automated tests use only disposable files and a mock executable, never an
installed VPN profile or production network. The cancellation command kills
an in-progress importer and retains the process-wide mutation lock until the
worker exits. Native Arch import, secret-agent
behavior, actual route/DNS operation and uninstall of imported profiles remain
**NOT TESTED**. Windows profile creation and OpenConnect import remain open.

Connect and disconnect now expose a separate cancel action. Linux `nmcli` and
Windows `rasdial` are spawned without a shell, with bounded output and a
35-second deadline. A cancellation request kills the waiting child process;
the mutation lock remains held until the worker exits. The OS may already
have applied the connection change before cancellation, so NodeDesk does not
claim either final state and asks the operator to refresh. Disposable Linux
manager and browser fixtures cover cancellation; native route/DNS and traffic
behavior still require acceptance.
