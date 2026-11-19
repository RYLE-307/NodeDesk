# MobaXterm session import — conservative preview

NodeDesk accepts a local `.mxtsessions` export using the documented
INI-like `[Bookmarks]` / `[Bookmarks_N]` and `SubRep` folder structure.
The file is decoded as Windows-1252 (CP1252). See:
- https://mobaxterm.mobatek.net/documentation.html (export workflow)
- https://gist.github.com/Ruzgfpegk/ab597838e4abbe8de30d7224afd062ea
  (community reverse-engineered format, not an official specification).

## Scope

Only SSH type 0, RDP type 4 and VNC type 5 are imported; the local catalog
stores display name, literal host, validated port, user (not VNC) and folder.
SFTP-only, Telnet and other session types are **skipped** and counted.
Advanced options including proxy settings, commands, X11, private-key paths,
RDP redirection, TLS exceptions, password fields and unrecognized records
are ignored and **never executed**. The import does not carry over
authentication trust: verify fingerprints and credentials in NodeDesk.
No passwords or private keys enter catalog storage.

The importer runs only after the operator chooses a local file, displays a
confirmation with accepted/skipped counts, and **appends** through the safe
catalog merge logic. Existing connections, workspace tabs and preferences
remain intact, and all imported IDs are regenerated to prevent accidental
matching of OS-vault credentials. Nothing auto-connects. Importing the same
file more than once creates duplicates by design.

## Limitations and QA

- Only the community-documented basic endpoint fields are recognized.
  MobaXterm may change its format; advanced/older exporter variants are
  not guaranteed to be interpreted correctly.
- No exact settings parity or full MobaXterm migration is claimed.
- Test with synthetic fixtures containing no actual credentials or server
  addresses. Native Windows/Arch UI file-selection and encoding acceptance
  are still **NOT TESTED**.
- Imported records must pass NodeDesk's strict catalog validator. Invalid
  sources or zero supported sessions leave the catalog unchanged.
