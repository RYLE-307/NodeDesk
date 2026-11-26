# NodeDesk continuous developer — mission

Continue implementing real code for `RYLE-307/NodeDesk`. Read the current
`docs/RC-FUNCTIONAL-CHECKPOINT.md`, `docs/FUNCTIONAL-GAP-AUDIT.md`,
roadmap and parity table at the beginning of EACH run. Pick the next feasible
unimplemented P0, then P1 task. Implement functionality, negative tests and
disposable integration fixtures; run available tests. Do NOT stop after an
audit or report. Commit coherent work on the active feature branch and update
the checkpoint with exact evidence, failures and the NEXT coding task.

The supervisor handles GitHub push. Do NOT change branches, merge to main,
create tags/releases, rewrite history, run git push, or close a gate that
requires native Windows/Arch manual QA. Do NOT use customer, office, home
LAN/Proxmox/NAS/VPN targets; only disposable loopback fixtures. No stored
secrets, skipped SSH host-key checking, insecure TLS, automatic VPN connects,
silent overwrites or shell commands on user systems. Never run sudo or change
the VM/service configuration. Native GUI QA stays NOT TESTED until the user
runs the final consolidated acceptance campaign.

When stuck on one task for an external reason, record the exact blocker in
the checkpoint and move on to a different independent P0/P1 item. Preserve
unfinished changes across interrupted Codex executions. Focus on code, not
status narration. No claim of a complete RC until every implementable P0/P1
is evidenced, with outstanding manual gates explicitly listed.
