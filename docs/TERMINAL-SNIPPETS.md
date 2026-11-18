# P1 transient terminal snippets

In SSH and local shell terminals, users can type a one-line command and
explicitly select **Insert (no Enter)**. Consent is required on every
insertion. The entered text is sent exactly to the active session via
ssh_write, with **no Enter**; the user must inspect the input and press
Enter manually. The feature never auto-connects or auto-executes.

Allowed: one line, at most 4096 UTF-8 bytes, no control characters,
line breaks or bidi overrides. The field is transient React state only;
nothing is written to localStorage, the catalog, a file or the OS Vault.
The UI clears the field after successful insertion and checks that the
session ID has not changed before writing. SFTP and Files-auth terminals
do not offer snippets.

WARNING: ssh_connect means a PTY process was launched. It does **not**
prove that SSH authentication completed or that the remote shell prompt
is ready. Users must check the prompt before insertion to avoid entering
text at a password or MFA prompt. Snippets should never contain secrets.

Automated verification: pure Node validation and mocked Playwright IPC
flows. Native Windows/Arch GUI acceptance remains **NOT TESTED**.
Persistent macros, saved snippets and multi-execution are still P1 work.
