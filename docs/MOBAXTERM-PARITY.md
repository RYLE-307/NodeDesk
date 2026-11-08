# MobaXterm parity / Матрица паритета

Сверено 2026-11-05 с [официальными возможностями](https://mobaxterm.mobatek.net/features.html)
и [документацией MobaXterm](https://mobaxterm.mobatek.net/documentation.html).
Это рабочая матрица требований, не сертификат полного паритета. Перед объявлением
v1.0 зафиксировать сравниваемую версию/редакцию MobaXterm и расширить проверки по
настройкам каждого протокола. Публичная страница функций не исчерпывает все опции.

Статусы: **План** — реализации нет; **Каркас** — только часть UI;
**Реализация** — рабочий срез, ожидающий ручной проверки; **Готово** — проверено на указанной ОС.
W = Windows, L = Linux. Приоритет не исключает функцию из общей цели.

| ID | Возможность и критерий приёмки | W | L | Этап |
| --- | --- | --- | --- | --- |
| UI-01 | Tech Dark, раскрываемая навигация, пустое окно без автосессий | Каркас | Каркас | Основа |
| UI-02 | Верхние вкладки: открыть, закрыть, переставить, восстановить каталог без автоподключения | Частично: открыть/закрыть/переставить | Частично: открыть/закрыть/переставить | Основа |
| UI-03 | Split panes, изменение размеров, перенос сессии между панелями | Реализация: 2/4 панели, resize, перенос | Реализация: 2/4 панели, resize, перенос | Основа; native приёмка ожидается |
| UI-04 | Светлая/тёмная/системная тема; шрифты, масштаб, горячие клавиши | План | План | Основа |
| UI-05 | Полный RU/EN, сохранение выбора, отсутствие непереведённых строк | Каркас | Каркас | Основа |
| CAT-01 | Каталог: группы, избранное, поиск, редактирование, дублирование | План | План | Каталог |
| CAT-02 | Импорт/экспорт, миграции формата, backup/restore, обработка повреждений | Частично: JSON импорт/экспорт | Частично: JSON импорт/экспорт | Каталог; native WebView приёмка ожидается |
| CAT-03 | Импорт сессий MobaXterm: документированное покрытие, без исполнения команд | План | План | Паритет |
| SEC-01 | Хранилище секретов, блокировка, master password/OS vault; экспорт без секретов по умолчанию | План | План | База |
| SSH-01 | Интерактивный SSH, PTY, resize, UTF-8, пароли/ключи/passphrase, keyboard-interactive | Реализация (ключи) | Реализация (ключи) | v0.3 |
| SSH-02 | Host-key trust/change rejection, known_hosts, агент и agent forwarding | Реализация (без forwarding) | Реализация (без forwarding) | v0.3 |
| SSH-03 | Jump host/ProxyJump, цепочки шлюзов и SSH gateway для других протоколов | Частично: один ручной ProxyJump в SSH/SFTP консоли без GUI Files | Частично: один ручной ProxyJump в SSH/SFTP консоли без GUI Files | Цепочки, другие протоколы, доверие шлюза и нативная приёмка v0.9 остаются |
| SSH-04 | Local/remote/dynamic tunnels: создание, остановка, ошибки порта, reconnect | Частично: локальный loopback key/agent | Частично: локальный loopback key/agent | Паритет |
| SSH-05 | X11 forwarding: локальный X display и корректное закрытие соединения | План | План | Паритет |
| FS-01 | SFTP рядом с SSH: список, upload/download, drag/drop, rename/delete, права, прогресс/отмена | Частичная реализация: листинг/передача | Частичная реализация: листинг/передача | v0.5 draft; см. ограничения ниже |
| FS-02 | Удалённый текстовый редактор: кодировки, поиск, upload при сохранении, конфликт изменений | Частично: UTF-8 editor ≤128 KiB, буквальный поиск/замена, безопасный Save as new copy, конфликт источника; без перезаписи оригинала | Частично: UTF-8 editor ≤128 KiB, буквальный поиск/замена, безопасный Save as new copy, конфликт источника; без перезаписи оригинала | Нативная приёмка, редактирование оригинала с атомарной защитой от гонок, кодировки/слияние/восстановление — ожидаются |
| FS-03 | SCP, FTP/FTPS: передача и TLS-проверка; предупреждение для незашифрованного FTP | План | План | Паритет |
| RDP-01 | Встроенный desktop, параметры безопасности и проверка сертификата | План | План | Протоколы |
| RDP-02 | Clipboard, диски, звук, multi-monitor, разрешение/DPI, fullscreen/reconnect | План | План | Паритет |
| VNC-01 | Встроенный VNC: auth, resize, clipboard, SSH gateway | План | План | Протоколы |
| LEG-01 | Telnet, Rlogin/Rsh: рабочая сессия, явное предупреждение о рисках | План | План | Паритет |
| SER-01 | Serial COM/USB: выбор порта, baud/parity/stop/flow, disconnect/reconnect | План | План | Протоколы |
| MSH-01 | Mosh: roaming/reconnect, внешние компоненты явно указаны | План | План | Паритет |
| X-01 | X11 server/display: запуск GUI, clipboard, OpenGL/Composite/RandR — отдельные проверки | План | План | Паритет |
| X-02 | XDMCP: удалённая X-сессия и управление жизненным циклом | План | План | Паритет |
| SH-01 | Local shell: PowerShell/CMD на W, системные shell на L, Bash где доступен | Реализация: PowerShell/CMD | Реализация: `/bin/sh` | Протоколы; ручная приёмка ожидается |
| SH-02 | Unix tools, rsync, выбор среды на W; установка/обновление дополнительных пакетов | План | План | Паритет |
| TERM-01 | Эмуляция VT, ANSI/256/truecolor, Unicode, scrollback, selection, clipboard, search | Частично: xterm и поиск | Частично: xterm и поиск | Протоколы |
| TERM-02 | Логи, настройка подсветки, ссылки, безопасная многострочная вставка | Частично: подтверждение вставки | Частично: подтверждение вставки | Паритет |
| AUTO-01 | Запись/редактирование/повтор макросов, явный запуск, секреты не записываются | План | План | Паритет |
| AUTO-02 | Multi-execution: выбор целей и подтверждение опасных массовых действий | План | План | Паритет |
| NET-01 | Ping, traceroute, DNS, port scan: таймауты, отмена, сохранение результатов | Частично: DNS, TCP (1–12 явных портов), ICMP ping, traceroute; native проверка ожидается | Частично: DNS, TCP (1–12 явных портов), ICMP ping, traceroute; native проверка ожидается | Утилиты; диапазоны, отмена и сохранение результатов ожидаются |
| SRV-01 | Встроенные сетевые серверы: инвентаризация типов по документации, start/stop, bind/firewall | План | План | Паритет |
| DIST-01 | Portable/installable поставка, настройки по умолчанию и branding/customization | План | План | Релиз |
| EXT-01 | Расширения/дополнительные инструменты: модель установки, доверие и лицензии | План | План | Паритет |

## Дополнительно к MobaXterm

| ID | Модуль и критерий приёмки | W | L |
| --- | --- | --- | --- |
| VPN-01 | WireGuard, OpenVPN, IKEv2, L2TP/IPsec, OpenConnect: профили, connect/disconnect, статус, ошибки | План | План |
| PVE-01 | Proxmox: список VM/LXC, power actions с подтверждением, консоль, TLS, API token | План | План |
| ZBX-01 | Zabbix: узлы, проблемы, фильтры, права API, opt-in polling и backoff | План | План |
| MT-01 | MikroTik: RouterOS SSH/API, каталог, состояние, безопасная auth, журнал действий | План | План |
| MON-01 | Необязательный мониторинг CPU/RAM/disk/network; выключен до выбора пользователя | Частично: локальные показатели по opt-in, native приёмка ожидается | Частично: локальные показатели по opt-in, native приёмка ожидается |

## Условия закрытия строки

Для каждого ID нужны: сценарий и ожидаемый результат, тестовый сервер/версия,
проверки ошибок/отмены/reconnect, результат отдельно W/L, ограничения и ссылка
на доказательство (тест/issue/PR). UI-заглушка или запуск внешнего клиента сами
по себе не подтверждают встроенный паритет. Использование внешних компонентов
явно описывается вместе с установкой, правами и лицензиями.

## Платформенные вопросы

На Windows отдельно выбрать источник Unix-инструментов и X-сервер. На Linux
проверить X11/Wayland и доступность Xwayland; наличие X-сервера не подразумевается.
RDP/VNC, serial permissions и системные VPN требуют разных backend-реализаций.
Ничего из этих компонентов пока не включено. MobaXterm — товарный знак Mobatek;
матрица описывает совместимые возможности, не копирование кода или ресурсов.


## v0.3 SSH vertical slice (review branch)

Real interactive SSH via OpenSSH + native PTY + xterm.js is implemented in this branch. Explicit connect/reconnect, resize, tab lifecycle and strict known_hosts trust are included; key/agent authentication only. Arch manual acceptance is required before merge. See [architecture, limits and acceptance steps](V0.3-SSH.md). Passwords, SFTP and tunnels remain deferred.

## Уточнение паритета и UX — 2026-11-06

Источники для сравнения: [официальный перечень функций MobaXterm](https://mobaxterm.mobatek.net/features.html), [документация и конфигурация MobaXterm](https://mobaxterm.mobatek.net/documentation.html), [страница плагинов](https://mobaxterm.mobatek.net/plugins.html). Сравнение должно фиксировать конкретную версию/редакцию MobaXterm; публичные страницы не гарантируют полноту опций и различий Home/Professional. **MobaXterm — Windows-приложение; NodeDesk должен предложить аналогичную практическую функциональность на Windows и Linux, но не копировать код, бренд или интерфейс 1:1.**

Сейчас статус SSH-01 — **частичный key-only MVP** в draft PR #4: в Arch видны подтверждение SHA256 host-key и `Permission denied (publickey,password)`, то есть **вход по SSH ещё не доказан**. В v0.3 отключены password и keyboard-interactive. Проверка пароля и успешной интерактивной сессии требуется отдельно. Пункты UI-02, UI-03 и CAT-01 из ранней таблицы имеют частичную реализацию в v0.2/PR #4, но полный комплекс функций (перестановка вкладок, resize split, дублирование и т.д.) не закрыт.

### Новые строки требований / приоритет

| ID | Приоритет | Возможность, критерий приёмки | Windows | Linux | Задача |
| --- | --- | --- | --- | --- | --- |
| SSH-06 | P0 | Password + keyboard-interactive/PAM/2FA, скрытый ввод и отмена, host-key trust до секретов, никаких сохранённых паролей по умолчанию | План | План | [#5](https://github.com/RYLE-307/NodeDesk/issues/5) |
| UX-01 | P0 | Контекстное меню дерева: right-click пустая область/группа/сессия, новое подключение/группа, edit/duplicate/move/delete, Shift+F10 | План | План | [#6](https://github.com/RYLE-307/NodeDesk/issues/6) |
| UX-02 | P0 | Resize sidebar мышью за разделитель, пределы ширины, сохранение, keyboard resize | План | План | [#7](https://github.com/RYLE-307/NodeDesk/issues/7) |
| UI-06 | P1 | Quick Connect (без сохранения), recent, дерево по типам/клиентам, клавиатурная навигация, контекстные действия | Частично: Quick Connect/recent | Частично: Quick Connect/recent | UX |
| UI-07 | P1 | Drag/drop вкладок, упорядочивание, split в 2/4 панели с resize и корректным переносом активной сессии | Реализация: drag/drop, 2/4, resize | Реализация: drag/drop, 2/4, resize | Workspace; native приёмка ожидается |
| FS-04 | P1 | Автоматический SFTP browser при SSH + отдельные SFTP-подключения, двусторонний DnD, статус передачи, pause/cancel, права | Частично: очередь/retry, byte-verified upload/download resume, guarded SFTP chmod, opt-in checkpoint для ручного восстановления после перезапуска | Частично: очередь/retry, byte-verified upload/download resume, opt-in checkpoint для ручного восстановления после перезапуска | Нативная приёмка, постоянный фоновый движок, pause, массовые/локальные права, многоочередная история и стресс-тесты остаются |
| TERM-03 | P1 | Прозрачный clipboard, поиск/выделение, zoom/fonts, настройки кодировки, ссылки, colors/themes, safe paste | План | План | Terminal |
| CAT-04 | P1 | Управление сессиями: recent, duplicate, bulk edit, group import/export, backup/restore, формат MobaXterm где лицензия позволяет | План | План | Catalog |
| SSH-07 | P1 | Выбор файла ключа, ssh config, gateway/ProxyJump/proxy, agent forwarding с подтверждением рисков | Частично: просмотр Host/HostName/User/Port и ручной одношаговый console ProxyJump | Частично: просмотр Host/HostName/User/Port и ручной одношаговый console ProxyJump | Нет полного импорта и применения config, IdentityFile, цепочек, GUI gateway или agent forwarding |
| SSH-08 | P1 | Tunnels manager, отдельный UI local/remote/dynamic forward, ports/status/reconnect и safety restrictions | План | План | SSH |
| RDP-03 | P1 | RDP clipboard, multi-monitor, динамический DPI/resize, звук, drive/printer redirection, security profiles | План | План | Remote |
| VNC-02 | P1 | VNC clipboard, encoding/compression, scaling, fullscreen и gateway | План | План | Remote |
| AUTO-03 | P2 | Интерактивные макросы, snippets/variables, подтверждение multi-execution и аудит опасных команд | План | План | Tools |
| SRV-02 | P2 | Встроенные серверы SSH/SFTP/TFTP/FTP/HTTP и др. *только после инвентаризации официальной документации по версии*; start/stop/firewall | План | План | Servers |
| DIST-02 | P2 | Portable mode и установщик, плагинная архитектура и безопасная установка инструментов, список сторонних notices | План | План | Release |

### Acceptance для цели «как MobaXterm и лучше»

1. Сравнивать не только наличие пункта меню: проверить подключение, шифрование, auth, ошибки, reconnect, входящие и исходящие файлы, resize, keyboard input и настройки.
2. В UX проверять плотность информации, context menu, resize sidebar, DnD каталога, скорость работы клавиатурой и доступность. Не копировать точные стили/ресурсы MobaXterm.
3. Windows/Linux тестируются раздельно: Windows OpenSSH/ConPTY, FreeRDP/RDP engine, X server, Unix tools; Linux PTY, X11/Wayland/Xwayland и системные VPN. Наличие библиотеки не равно реализованной функции.
4. Не сохранять SSH/RDP/VPN пароли, ключи, токены или логи с секретами в WebView storage. Разрешать сохранение только в отдельном защищённом vault после аудита, opt-in и явного управления экспортом.
5. Перепроверять официальные источники при планировании каждой подсистемы; эта таблица не гарантирует, что перечислены **абсолютно все** настройки каждой редакции MobaXterm.


### SSH-06 implementation note (PR #4, pending manual acceptance)

Auto / Key / Password-PAM selection and native hidden OpenSSH PTY prompts implemented. Password is not stored, but passes transiently through terminal input IPC. This is **not** proof of a successful password login on Arch/Windows; remain in review status until wrong/correct password, PAM, cancellation and strict host-key checks are confirmed. See [#5](https://github.com/RYLE-307/NodeDesk/issues/5).

## SFTP delivery split (v0.4 draft)

- **FS-00 (partial implementation / manual acceptance pending):** user-launched OpenSSH `sftp` in a built-in PTY console with remote navigation and `get` / `put`. Requires OS OpenSSH with the `sftp` executable. Safe host-key policy retained. Passwords are not saved. No automatic sessions.
- **FS-01/FS-04 (still planned):** GUI remote filesystem browser alongside SSH, independent local folder, two-pane drag-and-drop, progress/error/cancel, permissions, symlinks, timestamp and filename correctness, background transfer and remote editor. An interactive command-line `sftp>` is not equivalent to MobaXterm's SFTP browser.


## v0.5 SFTP GUI — review slice / срез для проверки

Two panels, binary SFTP v3 listing/navigation and upload/download; bounded
mkdir, no-overwrite rename, delete with confirmation, internal one-file drag/drop.
GUI Linux: OpenSSH password/PAM; Windows: native password/keyboard-interactive or direct OpenSSH key/agent.
Issue #9 stays open pending full Arch/Windows acceptance.

Две панели, SFTP v3, навигация, бинарная передача без перезаписи, mkdir,
rename, удаление с подтверждением и Drag & Drop одного файла.
GUI Linux: пароль/PAM; Windows: native пароль/keyboard-interactive или OpenSSH ключ/агент.

See [V0.5-SFTP-GUI.md](V0.5-SFTP-GUI.md).


### FS-01 / FS-04 follow-up in draft PR #10 (pending acceptance)

Native SFTP v3 mkdir, rename, remove file, rmdir empty directory and internal single-file cross-pane drag/drop added, with explicit delete/transfer confirmation and backend type checks. Portable name validation, no-overwrite checks and cancellation remain. Local regular files can be renamed via exclusive hardlink/unlink on supporting filesystems; local directory rename now uses native no-replace on Linux/Windows. Context menus support right-click and Shift+F10. No recursive operations, multi-select, external OS drag/drop or transfer queue. **Not marked complete** until latest CI and real Arch/Windows GUI tests pass.

### FS-04 review update: multi-file batch (not full parity)

Checkbox multi-selection with a 50-file cap and one-at-a-time upload/download
added in draft PR #10. Entire preflight fails on collision or invalid name,
backend still prevents overwrite, and cancel stops later jobs. No recursive
folder transfers, resume, progress across sessions or background queue.


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

## v0.6 review slice: remote desktops

- RDP catalog entries start external `mstsc.exe` (Windows) or `sdl-freerdp3`
  (Arch) on explicit click. Not embedded; credentials belong to the viewer.
- VNC catalog entries start external TigerVNC Viewer (Arch/Windows), restricting
  direct negotiation to X509Vnc/X509Plain. No unencrypted or anonymous-VNC
  fallback, clipboard, automatic reconnect, saved passwords or installed viewer
  bundling. May not connect to legacy VNC-only servers without an audited tunnel.
- Native GUI/manual connection and trust acceptance on Windows/Arch remain
  outstanding. No claims of built-in RDP/VNC screens or session parity.
- See [RDP](V0.6-RDP.md) and [VNC](V0.6-VNC.md).

## v0.6 review slice: system VPN integration

NodeDesk now has a dedicated System VPN tool for existing operating-system
profiles, not new VPN configuration management. Linux: NetworkManager
VPN/WireGuard. Windows: current-user built-in IKEv2, L2TP and SSTP profiles;
only Required/Maximum encryption profiles allow control, while others are
read-only. It lists OS-reported status and requests
confirmation before activating or deactivating by OS-assigned identifier.
Secrets, keys and routes remain with the OS; third-party VPN clients, Windows
all-user phonebook entries, PPTP and automatic tunnel type are unsupported.
No background monitoring, VPN-before-RDP orchestration, in-app credentials
or independent proof of route/DNS isolation. No native desktop test yet.
[Acceptance and security notes](V0.6-VPN.md).

## Embedded VNC WSS-only slice (v0.6 draft)

A separate noVNC 1.7.0 (MPL-2.0) viewer renders RFB frames **inside**
NodeDesk tabs over an explicitly configured `wss://` WebSocket-to-RFB
gateway with valid OS-trusted TLS. Manual password input, framebuffer and
remote keyboard/mouse are supported in code. This is **not** the raw TCP
VNC external X.509 launcher and does **not** enforce that same RFB
authentication type or guarantee the origin's access policy. Credentials
are transiently handled in the WebView and not persisted. Real Arch/Windows
WSS desktop tests remain pending. **RDP is embedded via a separate Guacamole
gateway, not a native Rust RDP engine**. The gateway authentication session
must be configured separately; no live RDP tests yet.
[Architecture / acceptance](V0.6-EMBEDDED-DESKTOP.md).

## In-tab Guacamole RDP (draft PR #11)

The RDP workspace contains a Guacamole 1.6 browser client rendering remote
canvas layers and forwarding keyboard/mouse inside the NodeDesk tab. It now
supports standard HTTPS account login, enumerates authorized RDP profiles and
opens an explicit Guacamole WSS tunnel. Apache Guacamole + guacd must
be deployed and trusted separately; exact-origin CORS is required and
WSS URL query strings containing session tokens must be redacted by proxies. This is **not a native RDP TCP client**;
NodeDesk uses short-lived Guacamole tokens in memory; the upstream gateway
still governs RDP target identity, NLA and server trust.
The existing external FreeRDP/mstsc launcher remains unchanged.
No real RDP screen or server-certificate identity has been manually accepted.
[Architecture, native TLS blocker and QA](V0.6-RDP-EMBEDDED.md).
