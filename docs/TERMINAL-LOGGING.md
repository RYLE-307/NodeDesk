# Terminal scrollback TXT export (P1 functionality)

The SSH, SFTP and local terminal toolbar includes **Export TXT**. This
reads the terminal emulator's *rendered scrollback* only after the user
presses the button, and after a separate privacy confirmation. NodeDesk
does **not** automatically record input, keystrokes, passwords, whole PTY
output streams, or produce background log files.

The confirmation warns that displayed history can still contain hostnames,
IP addresses, command output, authentication messages, and accidentally
echoed secrets. Treat the resulting TXT as sensitive and check it before
sharing. The filename includes only a generic NodeDesk prefix and timestamp;
no host or username. Downloads are started locally through the WebView.

Export preserves the most recent 4096 display lines (up to 512 KiB UTF-8),
discarding older output when the cap is reached. The exporter joins
soft-wrapped lines and places a truncation notice at the start of the TXT. Empty history causes no download.
Export neither starts a connection nor changes terminal history.

Known limitations:
- An xterm display snapshot is not a raw, byte-for-byte audit log.
  Output that scrolled beyond the existing terminal buffer is unavailable.
- Screen-rendered content can be sensitive. There is no attempt to promise
  redaction or secure erasure of saved TXT files.
- Native Windows/Arch GUI and file chooser/download acceptance are
  **NOT TESTED**; pure Node and Playwright checks are included.
- Continuous logging, log rotation and authenticated archive backups
  remain separate features, not implemented by this slice.
