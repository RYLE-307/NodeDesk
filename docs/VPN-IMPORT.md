# Linux NetworkManager VPN file import

NodeDesk can import an existing WireGuard `.conf` or OpenVPN `.ovpn` file on
Linux with an explicit user click and confirmation. The user supplies an
absolute local path. The native backend verifies a regular, non-symlink file
of 1–262144 bytes with owner-only permissions (mode 0600), checks for a
same-name profile, and invokes
`/usr/bin/nmcli connection import --temporary type ... file` with a fixed
argument list and no shell. It then requires exactly one new, inactive profile
of the requested kind, disables autoconnect, restricts access to the current
OS user, and makes the profile persistent. Conflicts and cancellation trigger
deletion of only the newly observed UUID. If NetworkManager becomes unavailable
during rollback, the UI reports that a temporary profile may remain. The path
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
NodeDesk discards `nmcli` stdout and stderr from the UI and logs.

Automated tests use only disposable files and a mock executable, never an
installed VPN profile or production network. The cancellation command kills
an in-progress importer and retains the process-wide mutation lock until the
worker exits. Native Arch import, secret-agent
behavior, actual route/DNS operation and uninstall of imported profiles remain
**NOT TESTED**. Windows profile creation and OpenConnect import remain open.
