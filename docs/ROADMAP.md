# План разработки

> **Current review: v0.6.0-alpha.0 — embedded WSS VNC, Guacamole-gateway RDP, external clients and system VPN (draft PR #11).**
> v0.5 graphical SSH/SFTP was merged into main with CI green; Arch manual smoke test confirmed login, browsing and upload.
> First v0.6 RDP details: [V0.6-RDP](V0.6-RDP.md). Historical plans below describe past stages.

## Full product scope requested on 7 November 2026

The intended feature set is the entire [MobaXterm parity matrix](MOBAXTERM-PARITY.md)
plus VPN, Proxmox, Zabbix, MikroTik and opt-in monitoring, rather than only
the v0.6 slice. Implement and verify in dependency order: (1) session/catalog
and local terminal foundations; (2) SSH/SFTP and transfer/editor/tunnels;
(3) remote desktop and additional protocols; (4) VPN and infrastructure
integrations; (5) packaging, license notices and release hardening. Each
finished change still needs automated tests and Windows/Linux build checks.
Combined manual acceptance and visual design review are deferred until the
planned functionality is implemented. A green CI job is not a substitute for
real network/protocol acceptance, and the draft PR must not be called a release.

The first new foundation is a local shell tab (SH-01): fixed system PowerShell
or CMD on Windows, `/bin/sh` on Linux, explicit start/stop and PTY lifecycle.
No arbitrary executable path or command line crosses the WebView boundary.
Linux Rust CI launches `/bin/sh` inside a disposable PTY; Windows Rust CI
executes the fixed PowerShell path noninteractively. Neither touches remote hosts.
Quick Connect (UI-06) now opens a transient SSH/RDP/VNC tab using the existing
validated connection form. It does not save the entry or start a network
session until the user explicitly chooses a protocol action.
Catalog JSON import/export (CAT-02) validates the existing v1 schema and
strips unknown fields, including credential-like fields, on both paths.
Import confirms replacement, closes old session tabs and keeps the original
catalog on invalid input. Native WebView file download/picker acceptance and
older-format migrations remain outstanding.
Open workspace tabs (UI-02) can now be reordered by drag/drop or Alt+Left/Right
without changing saved catalog entries or starting connections.
Recent (UI-06) stores only the last 20 catalog IDs in local preferences,
filters deleted entries and never records Quick Connect destinations.
Workspace split (UI-03/UI-07) now has one, two and four independently selected
panes. A tab keeps the same mounted component when moved between panes, so an
active terminal is not closed by the layout change. Column/row splitters can
be adjusted with pointer or arrow keys and save their ratios. Native desktop
acceptance remains outstanding.
Network diagnostics (NET-01) resolves a manually entered host, probes one TCP
port and offers an explicitly triggered system ICMP ping with two echo requests.
The ping process has fixed argument lists, no shell, no user-controlled binary,
a 10-second hard timeout and bounded display output. A reachable ICMP reply does
not prove TCP service availability; a silent ping does not prove the host is
down (ICMP may be filtered). No background requests or port ranges are used.
Frontend/Rust tests cover invocation and argument validation; native manual
Windows/Linux acceptance is pending. An explicitly triggered, bounded system
traceroute is also provided: Windows tracert.exe (8 hops, 500 ms per probe) or
Linux /usr/bin/traceroute (12 hops, one probe per hop), with a 25-second hard
timeout. An absent platform tool reports an error without fallback to a shell.
An explicit list of 1–12 unique TCP ports can also be checked on one manually entered host.
This never expands ranges, resolves the host once, checks at most two returned IP addresses,
and limits each TCP attempt to 400 ms. No connection is attempted on page load.
DNS cancellation, range scans, persistent reports and reverse-DNS enrichment
are still planned. ICMP and TCP results do not establish complete host availability.
Terminal tabs now have scrollback search and bounded font zoom. Multiline paste
requires confirmation because pasted commands may execute immediately. Clipboard
copy/link handling, persisted font preferences and native acceptance remain open.
The first SSH tunnel slice provides one explicit local forward per SSH workspace:
the listener is fixed to 127.0.0.1, only unprivileged ports are accepted, and
OpenSSH runs without a shell or password prompt using an already trusted host key
and key/agent authentication. The tunnel stops with the tab or application.
Remote/dynamic forwards, password/PAM tunnel auth and real target acceptance
remain open.
FS-02 now includes explicit UTF-8 remote text preview and an in-memory editor
(128 KiB maximum). **Save as new copy** checks the original against the exact
text read when the editor opened, then creates a distinct remote filename with
SFTP v3 EXCL|CREAT. The original is never opened for writing, and an existing
copy cannot be overwritten. It verifies the written copy and rechecks the
source; if the source changed during saving, that conflict is reported.
A failed write may leave an incomplete new file for manual inspection.
There is no silent autosave, shell, persistent cache, or local temporary copy.
SFTP v3 cannot provide a true atomic compare-and-swap overwrite: direct saving
to the original, encoding selection, 3-way merge, recovery and manual native
Windows/Arch acceptance remain open. The editor clears on profile/auth change.
Added local-only **literal, case-sensitive Find Previous/Next**, exact-selection
replacement, and explicitly confirmed Replace All. Matching is not a regex;
search/replacement operates only on the in-memory text, with a 128 KiB output
limit and at most 4096 replacements per action. No network or file write occurs
until the separate Save as new copy command. Even after switching to read-only
view, closing modified text requires a discard confirmation.

Linux CI separately uses a disposable trusted sshd fixture to verify bytes
through the local SSH forward to a loopback target; native Windows and
user-owned tunnel-target acceptance remain open.

## v0.6 priorities

1. **RDP launcher (in PR #11):** explicitly launch GUI client on Windows and Arch, no credentials in argv/catalog, keep certificate dialogs intact. CI checks frontend/Rust; manual native GUI acceptance pending.
2. **Embedded RDP through Guacamole (draft PR #11):** HTTPS Guacamole 1.6 account login, authorized RDP discovery, and in-tab framebuffer/input over WSS to an independently provisioned gateway. Standard Guacamole tokens appear in WSS URL queries (must be redacted in proxy logs); exact-origin CORS is required. Does not speak native RDP TCP. [Scope and TLS requirements](V0.6-RDP-EMBEDDED.md). **Direct native Rust RDP is NOT yet implemented**: IronRDP TLS certificate verification must be addressed before acceptance.
3. **VNC launcher (in PR #11):** TigerVNC, explicit external window, X.509-based encrypted authentication schemes only, no clipboard sharing, no secrets. See [V0.6 VNC](V0.6-VNC.md). Manual native login/certificate verification remains pending. **Embedded WSS noVNC** was added as a separate opt-in mode; it needs a trusted TLS gateway and an authentication policy. Direct TCP and SSH/VPN tunnels follow later. See [embedded desktops](V0.6-EMBEDDED-DESKTOP.md).
4. **VPN system-profile manager (in PR #11):** read-only listing and manual connect/disconnect (with confirmation) of OS-owned profiles. Linux NetworkManager VPN/WireGuard; Windows current-user IKEv2/L2TP/SSTP, with control restricted to Required/Maximum encryption and other profiles visible read-only. Existing OS credentials only. No profile editing, plaintext secrets or automatic routing changes. [V0.6 VPN](V0.6-VPN.md). Actual desktop VPN acceptance pending.
5. **QA/release:** native desktop acceptance on Windows/Arch, packaging, security checks and dependency notices before release.



## v0.2 alpha

Каталог с CRUD, вложенными группами, поиском, избранным и локальным хранением
реализован; RU/EN и три темы доступны. Первый отдельный UI-срез: верхние вкладки
и две панели карточек без сетевых сессий. Подробности и границы: [V0.2.md](V0.2.md).
CI проверяет frontend и desktop Windows/Ubuntu; Arch требует отдельного запуска.
Следующий срез: жизненный цикл реальных сессий, SSH/SFTP, защищённые секреты.


1. Основа Git: структура, README, матрица паритета, ограничения лицензии.
2. Проверить desktop-сборку Windows и Arch Linux; создать Cargo.lock; CI обеих платформ.
3. Каталог и группы, локальное сохранение с миграциями; настройки RU/EN и тем.
4. Рабочие вкладки и split panes; менеджер жизненного цикла сессий.
5. SSH + SFTP + local PTY; защищённые секреты, host-key verification, тестовые стенды.
6. RDP/VNC/Serial/Telnet и туннели; платформенные backend-решения после аудита.
7. X11/XDMCP/Mosh, файловые протоколы, утилиты, макросы, multi-execution.
8. VPN, Proxmox, Zabbix, MikroTik; необязательный мониторинг.
9. Закрытие матрицы паритета, доступность UI, упаковка, notices и лицензия релиза.

Номер версии не означает готовность всего перечня. Функция считается выполненной
только после проверки на обеих целевых ОС либо явного описания различий.


## v0.3 SSH vertical slice (review branch)

Real interactive SSH via OpenSSH + native PTY + xterm.js is implemented in this branch. Explicit connect/reconnect, resize, tab lifecycle and strict known_hosts trust are included; key/agent authentication only. Arch manual acceptance is required before merge. See [architecture, limits and acceptance steps](V0.3-SSH.md). Passwords, SFTP and tunnels remain deferred.

## Дополнение 2026-11-06: требования после ручной проверки Arch

Состояние v0.3 [PR #4](https://github.com/RYLE-307/NodeDesk/pull/4): OpenSSH/PTY запускается, новый host-key запрашивает подтверждение, но демонстрационная попытка входа по паролю завершилась `Permission denied (publickey,password)`. **Подключение на уровне SSH есть, успешная авторизация удалённого пользователя ещё не подтверждена.** В PR #4 password и keyboard-interactive намеренно отключены. Нельзя объявлять SSH-паритет достигнутым.

### Приоритетные доработки (P0 / следующий технический срез)

1. **[Issue #5 — SSH password и keyboard-interactive](https://github.com/RYLE-307/NodeDesk/issues/5)**: интерактивный скрытый ввод по паролю, PAM/2FA prompts без хранения секретов в каталоге, localStorage, argv и логах; сохранить strict known_hosts, отклонение changed/revoked keys, ключи/agent/passphrase, тесты Arch/Windows.
2. **[Issue #6 — Контекстное меню каталога](https://github.com/RYLE-307/NodeDesk/issues/6)**: правый клик по пустой области, группе и подключению; создание, редактирование, переименование, дублирование, перенос, избранное и удаление с подтверждением; клавиатурная альтернатива Shift+F10, RU/EN, тесты.
3. **[Issue #7 — Resizable sidebar](https://github.com/RYLE-307/NodeDesk/issues/7)**: перетаскивание границы левой панели для непрерывного изменения ширины, компактный вид, локальное сохранение ширины и управление с клавиатуры. Кнопка сворачивания остаётся дополнением, не единственным способом.

Закрыть v0.3 по текущему ключевому SSH-MVP можно после ручной успешной авторизации ключом на Arch и проверки resize/input/output/reconnect/close. Password-auth — отдельный блокирующий пункт для *полного SSH-паритета*, не повод утверждать что существующий key-only MVP уже умеет пароли. PR #4 остаётся draft до соответствующей проверки.

### Последующие этапы по приоритету (не создавать отдельную ветку на каждую мелкую задачу)

- **P1 / ежедневный терминал**: automatic SSH SFTP browser и transfer drag/drop; remote editor и conflict handling; clipboard, search, links, copy/paste, font/zoom, hotkeys, log/recording с защитой секретов; Quick Connect, recent/favorites, drag/drop tabs, split 2/4 panes, import/export/backup sessions (включая частичный импорт MobaXterm). Затем SCP/rsync и безопасный vault с opt-in master password/OS keyring.
- **P1 / продвинутые SSH**: пользовательские identity files, SSH config aliases, ProxyJump и gateway, port-forwarding (local/remote/dynamic), agent forwarding с предупреждениями, X11 forwarding и удобный connection profile.
- **P1 / удалённые рабочие столы**: встроенные RDP и VNC с проверкой trust, multi-monitor/DPI/fullscreen, clipboard, перенаправлением звука/дисков/принтеров где поддерживается, SSH-gateway.
- **P2 / MobaXterm long tail**: X server/XDMCP (особенно отдельный Windows X server и Linux X11/Wayland), Mosh, Telnet/Serial/Rlogin/Rsh, FTP/FTPS, embedded servers, Unix tools on Windows, macro/multi-execution, terminal customization, plugin/extension packaging, portable builds.
- **Сверх MobaXterm**: VPN WireGuard/OpenVPN/IKEv2/L2TP/OpenConnect; Proxmox VM/LXC; Zabbix; MikroTik; необязательный мониторинг. После рабочего базового SSH и безопасности.

### Принципы релиза

Единая текущая папка `~/NodeDesk` на Arch; работа через Git ветки/PR, после merge возврат на `main`, без множества локальных копий. Любая feature обязана иметь тесты + статус Windows/Linux. Полная матрица ниже — цель продукта, **не обещание наличия всех функций в v1.0**. Различия реализаций и лицензий Windows/Linux фиксировать до выпуска.


### v0.3 SSH password-auth implementation (PR #4, pending verification)

SSH authentication selection Auto/Key/Password-PAM and native OpenSSH password/keyboard-interactive prompts added in review branch; **not yet manually confirmed as successful login**. See [Issue #5](https://github.com/RYLE-307/NodeDesk/issues/5) and [V0.3-SSH.md](V0.3-SSH.md). Verify Arch/Windows against an isolated SSH host and retain key-only and changed-host-key regression tests before merging.

## v0.4 SFTP transport slice (draft PR)

First real SFTP step: user-initiated native OpenSSH `sftp` process attached to a PTY and rendered inside NodeDesk, next to the existing SSH terminal. Key, agent, password/PAM modes use the existing strict OpenSSH trust policy. Users can run `pwd`, `ls`, `cd`, `get`, `put` and `help` in the embedded SFTP console. This does **not** yet include a two-pane graphical browser or file drag/drop. Track full file manager acceptance in [MOBAXTERM-PARITY.md](MOBAXTERM-PARITY.md). Manual test on Arch and Windows required before merge.


## v0.5 SFTP GUI — review slice / срез для проверки

Two panels, real structured SFTP v3 listing/navigation, binary upload/download,
nonrecursive mkdir, rename, delete (with confirmation), and internal single-file
drag/drop, with no overwrite, progress/cancel. GUI: Linux password/PAM via
OpenSSH auth bridge; Windows native password/keyboard-interactive. Recursive and
background operations remain planned. Issue #9 remains open pending manual Arch/Windows acceptance.

Две панели, настоящий SFTP v3, навигация, бинарная передача без перезаписи,
создание папок, переименование, удаление с подтверждением и Drag & Drop одного
файла. GUI Linux: пароль/PAM через OpenSSH. Windows: native пароль/PAM или ключ/агент.

See [V0.5-SFTP-GUI.md](V0.5-SFTP-GUI.md).


### v0.5 review follow-up: filesystem mutations (not yet accepted)

Added bounded local/remote **mkdir, rename (no-overwrite), delete** and single-file cross-pane **internal Drag & Drop** to PR #10. Permanent deletion requires user confirmation. Symlinks, recursive and bulk operations remain unsupported. Local directory rename now uses no-replace OS primitives on Linux/Windows. This is still **draft**, not merged, pending latest CI and manual Arch acceptance. See [v0.5 guide](V0.5-SFTP-GUI.md), [Issue #9](https://github.com/RYLE-307/NodeDesk/issues/9).

### v0.5 review update: multi-file selection and bounded transfer queue

Added per-pane regular-file checkboxes, capped at 50 files and a sequential
upload/download operation. All files must pass preflight collision/type
checks; any error or user cancellation stops the rest, and prior successful
files remain. Manual runtime verification pending. This is not a persistent
background queue. [Issue #9](https://github.com/RYLE-307/NodeDesk/issues/9).

### v0.5 review addition: transfer visibility

An ephemeral per-file transfer report, live queue position, and "Select visible
(up to 50)" were added to the same draft PR. A selected group of files can be
dragged between loaded panels using the same confirmation and no-overwrite
backend as the sequential transfer buttons. This is **not** a persistent
background queue, and transfers that finished before cancellation are not
rolled back. Pending newest CI and manual desktop testing.


### Windows native GUI authentication — implemented review slice

Rust ssh2/libssh2 now provides password and keyboard-interactive for Windows
Files, with strict previously trusted host-key verification before credentials,
hidden bounded input, destination-bound sessions and socket cancellation.
OpenSSH consoles, Linux ControlMaster login and direct key/agent are retained.
Native cancellation closes the Windows Files login and requires reconnect.
Unknown/changed/revoked keys fail closed; new trust uses the OpenSSH console.
No saved secrets, shell/askpass or credentials in argv/environment/logs.

Linux CI uses real isolated sshd/PAM; Windows CI uses an independent loopback
SSH/SFTP peer for the native client (not a Windows sshd/PAM claim). Certificates,
password-change and mixed-method MFA chains remain unsupported. GUI acceptance
on Arch/Windows is pending; keep PR #10 draft and do not merge before the user
accepts. See [architecture, security and exact limits](V0.5-SFTP-GUI.md).
