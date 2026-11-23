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

On Linux, an active profile's route indicator now requires both a route
reported by NetworkManager for its exact UUID and an installed unicast route
on NetworkManager's exact device in the OS routing table. The device name is
validated before passing it as an argument to `ip`; no shell or address data
reaches WebView. Missing `iproute2`, ambiguous devices, malformed output or a
timeout yield an unknown result. DNS now requires an active NetworkManager
profile to report IP4.DNS/IP6.DNS **and** systemd-resolved to report a DNS
server on that profile's exact device through read-only
`/usr/bin/resolvectl --no-pager dns DEVICE`.
The parser accepts only IP addresses under a matching `Link N (device)`
header. Missing resolver, unsupported DNS architectures, ambiguous output,
mismatched device or timeout yield **unknown**, not confirmed DNS. If the
active NetworkManager profile reports no DNS, its DNS indicator is absent.
No DNS addresses enter WebView and no DNS configuration is modified.
These checks do not prove real query routing, split DNS, leak resistance,
or VPN encryption, which remain native QA.

## 2026-11-18 — VPN profile health snapshot revalidation

After inspecting the active profile's OS routes and resolver configuration,
NodeDesk re-enumerates the system VPN list and requires the exact same
UUID, displayed name, protocol, active state and control eligibility
to remain unchanged. A disappearing, disabled or externally replaced
profile returns a visible refresh-required error instead of a stale
route/DNS presence result. This is a bounded read-only operation and
never connects, disconnects, imports or changes an OS profile.

The post-check reduces stale-state windows but **cannot** guarantee
that VPN traffic follows the expected route, that DNS queries remain on
the interface, or that the OS won't change immediately afterward.
Native Windows/Arch operator acceptance is still **NOT TESTED**.

## 2026-11-23 — exact resolver DNS matching on Linux

An active NetworkManager profile's IPv4/IPv6 DNS addresses now must match the full set reported by systemd-resolved on the exact link. A different address, a missing one or an additional link DNS address yields a false indicator, not a positive DNS presence claim. If NetworkManager reports no DNS, its indicator is false. Unsupported or malformed output, ambiguous device names and unavailable tools still return unknown. Addresses are not sent to WebView and no OS configuration is modified.

This verifies configuration agreement only, not actual DNS query routing, split DNS, leak resistance or encryption. Rust tests exercise synthetic mixed IPv4/IPv6, wrong-link, mismatch, extra-address and malformed-output scenarios through a fake read-only resolver command. Native Windows/Arch manual acceptance remains NOT TESTED.

## 2026-11-23 — Linux VPN route-family agreement

NetworkManager IPv4 and IPv6 route presence is now inspected
separately for the active UUID. The route indicator requires at
least one kernel unicast route on the same selected device and in
an address family also reported by NetworkManager. An unrelated IPv6
route cannot validate an IPv4-only claim (or vice versa). No routes
reported gives false; tooling failure and ambiguous output give
unknown. All checks remain bounded, read-only, and shell-free.

This is family-level agreement, not a check of exact route CIDR,
default-route selection, effective traffic forwarding, kill-switch
status or leak protection. Disposable mock ip tools and Rust tests
cover mismatched families; no real VPN profile was accessed.
