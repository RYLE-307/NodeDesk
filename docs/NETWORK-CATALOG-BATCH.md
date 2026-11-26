# Explicit catalog TCP batch checks (P1)

The Network diagnostics workspace can check the TCP reachability of up to
10 selected SSH/RDP/VNC catalog entries, using the same native bounded
network_probe command as its existing single-host TCP test. Use the
collapsible **Catalog TCP batch checks** section, search by connection name
or address and explicitly select up to 10 rows. The UI displays no more than
50 matches at once; refine the query to find additional entries.

Nothing runs on tab open, search, selection or refresh. **Check selected TCP
ports** always asks for consent: this actively sends DNS/TCP traffic to
the chosen servers. Results run sequentially, showing only whether each
port was reachable, refused/timed out or returned an error. No login,
SSH protocol negotiation, RDP/VNC authentication, TLS trust or service
health is inferred. No background monitoring, persistence or auto-retry.

**Cancel batch checks** cancels the active native network_probe (best
effort), rejects late results and does not start subsequent targets.
An OS DNS call or TCP connect may finish before cancellation takes effect;
closing the workspace also cancels the outstanding request.

Only connection ID, name, protocol, host and port are planned in memory;
native IPC receives only host/port, never usernames, passwords, Vault
secrets, identity files or pinned certificates. No batch DNS/IP-address
report is downloaded. Tests mock all network calls with disposable hostnames;
no real server was probed. Native Windows and Arch acceptance remains
**NOT TESTED**.
