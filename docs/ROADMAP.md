# План разработки

> **Current review: v0.6.0-alpha.0 — external RDP and TigerVNC launchers (draft PR #11).**
> v0.5 graphical SSH/SFTP was merged into main with CI green; Arch manual smoke test confirmed login, browsing and upload.
> First v0.6 RDP details: [V0.6-RDP](V0.6-RDP.md). Historical plans below describe past stages.

## v0.6 priorities

1. **RDP launcher (in PR #11):** explicitly launch GUI client on Windows and Arch, no credentials in argv/catalog, keep certificate dialogs intact. CI checks frontend/Rust; manual native GUI acceptance pending.
2. **Embedded or managed RDP:** investigate FreeRDP library/embedding and licensing, session lifecycle, reconnect, clipboard/fullscreen/multi-monitor. The launcher is not the final integration.
3. **VNC launcher (in PR #11):** TigerVNC, explicit external window, X.509-based encrypted authentication schemes only, no clipboard sharing, no secrets. See [V0.6 VNC](V0.6-VNC.md). Manual native login/certificate verification remains pending. Embedded VNC and SSH/VPN tunnels follow later.
4. **VPN:** explicit profile-driven user actions and integration with system VPN clients, no silent routing changes or stored plaintext secrets.
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
