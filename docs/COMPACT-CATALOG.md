# Compact catalog / Issue #2

Groups and connections share a dense, scrollable hierarchy. Row actions are
available through the labeled ellipsis button (Tab + Enter), or right-click on
a connection. Edit / Move to group opens the existing keyboard-accessible form.
Folder names and connection names truncate, with full paths/addresses in titles.
All action and protocol icons are inline SVG, independent of installed fonts.
RU/EN and dark/light/system preferences retain the v1 storage format.

Drag a connection onto a group, nested group, or the Ungrouped target at the top.
Valid targets highlight; hovering for 650ms expands a folder. Drag near the
scrolling catalog's top/bottom to scroll. Escape or dropping outside a target
does not change data. Drops from outside NodeDesk are ignored. Moving preserves
the ID and all metadata, and writes storage before updating the UI. Failed
writes leave the original record in place and display the existing error alert.
No session is opened by a drag; startup tabs remain empty.

Tauri native file drop is disabled for the window so HTML drag/drop is available
in Windows WebView2. Native file import is not a feature of this version.

## Validation and remaining manual acceptance

9 model/storage tests, TypeScript, production frontend build pass locally.
Browser automation cannot reach this Windows host's loopback server (timeout),
so graphical interaction and SVG rendering are not claimed as verified.
CI compiles frontend/Tauri on Windows and Ubuntu; it does not verify desktop UI.

Before merging, manually check on Arch and Windows:

1. Create parent/child groups and SSH/RDP records; move to each group and root.
2. Verify target highlight, hover expansion, edge scroll, Escape and outside drop.
3. Restart: verify group, favorite, address, username, ID retained; no open tabs.
4. Use only Tab/Enter to open row actions, change group and save; Escape closes
   the editor. Check visible focus, long names, many records and narrow windows.
5. Block storage / simulate quota: drop and form save must show an error without
   moving the record. Restore storage and retry.
6. Verify SVG icons on Arch, both languages, all themes and sidebar collapse.

PR #1 was merged after all four CI jobs and user-reported Arch v0.2 acceptance.
This iteration requires a new manual Arch acceptance before merge.
