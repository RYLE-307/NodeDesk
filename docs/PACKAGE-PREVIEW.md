# Installer preview gate

The draft PR's desktop CI creates an unsigned per-user Windows NSIS installer
and an Ubuntu DEB package after the Rust and disposable SSH/SFTP checks. Both
are uploaded as CI artifacts with SHA256SUMS.txt. The existing unbundled Windows
executable remains a portable preview. No artifact is published as a release.
An Arch Linux container builds and tests the application, archives the
unbundled executable, and creates an installable package with a desktop entry,
icon, license and declared system dependencies. Both artifacts are unsigned
development previews. Building a package in CI does not prove native desktop
execution or install/uninstall behavior.

The Windows installer may require the OS WebView2 runtime and relies on
separately installed OpenSSH, RDP and VNC clients for the corresponding external
features. The DEB declares `openssh-client` because SSH and SFTP need it.
CI obtains the pinned Tauri NSIS tool archive and plugin through the GitHub
release asset API and checks their upstream SHA-1 values before bundling. This
avoids a repeatedly observed 504 from the public release download URL; Tauri
also verifies the tool files in its local cache. No third-party binary is
committed to this repository.
Optional Linux ping, traceroute, desktop viewers and system VPN tooling remain
separate OS dependencies; the UI reports unavailable tools instead of silently
installing them.

These CI packages do not establish native Arch compatibility, install/uninstall
correctness, signing trust, update policy, WebView2 availability, executable
permissions, or native protocol acceptance. Before any release, install and
remove the Windows installer and an Arch package on clean operator-controlled
machines; verify dependencies, file locations, icons, shortcuts, OS prompts,
permissions and actual SSH/SFTP/RDP/VNC/VPN workflows. Record SHA256 and the
tested OS versions. Keep the PR draft until the integrated acceptance pass.


## Windows NSIS preparation: authenticated release asset metadata (2026-11-08)
GitHub Actions passes an ephemeral, read-only workflow token only to the NSIS
preparation step. Its upstream GitHub API queries now authenticate to avoid
the shared runner's unauthenticated REST rate limit. Existing pinned SHA-1
checks are unchanged and still fail closed if downloads differ. The token is
not embedded in artifacts or used at application runtime. Manual unsigned
Windows installer QA and signing remain outstanding.
