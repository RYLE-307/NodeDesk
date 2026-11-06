# План разработки

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
