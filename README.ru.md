# NodeDesk

> Current review / Текущая проверяемая версия: **v0.5 SFTP GUI slice**.
> GUI: Linux password/PAM via OpenSSH auth bridge; Windows key/agent. No mkdir/rename/delete/DnD.
> Full scope and acceptance: [V0.5](docs/V0.5-SFTP-GUI.md). Historical notes below may describe older releases.

**RU** · [English](README.md)

Локальное приложение для работы с инфраструктурой на Windows и Linux.
Tauri 2 + React + TypeScript + Rust. Версия: **0.2.0-alpha.0**.

## Реализовано

- Создание, изменение, перемещение и удаление подключений и вложенных групп.
- Поиск по имени, адресу, пользователю и пути группы; избранное.
- Локальное сохранение каталога и настроек с проверкой формата и обработкой ошибок.
- RU/EN, темы dark/light/system, раскрываемая навигация Tech Dark.
- Пустая область при запуске, закрываемые верхние вкладки и две панели карточек.
- Опциональная панель мониторинга, выключенная по умолчанию, без источников данных.

Реальные SSH/SFTP/RDP, мониторинг и защищённое хранилище секретов ещё впереди.
Карточки показывают только параметры. Автоподключений, имитации терминала и
телеметрии нет. Поля паролей и ключей отсутствуют. Каталог хранится в локальном
профиле WebView; это не шифрование и не резервная копия.
[Контракт хранения и сценарии проверки](docs/V0.2.md).

## Разработка

Нужен Node 24 LTS и npm. Для desktop также Rust stable и
[системные зависимости Tauri 2](https://v2.tauri.app/start/prerequisites/).
На Windows — MSVC Build Tools и WebView2, на Linux — WebKitGTK и инструменты сборки.

```sh
npm ci
npm test
npm run build
npm run dev          # веб-интерфейс
npm run tauri dev    # desktop-окно
npm run tauri build -- --no-bundle
```

Сохраняйте `package-lock.json` и используйте `npm ci` на Arch и Windows.
Перед обновлением проверяйте `git status`: свои изменения закоммитьте или уберите
в stash, не удаляйте конфликтующие иконки и lock-файлы. Установка зависимостей
требует интернета, работа каталога — нет. Установщики пока отключены.

CI проверяет frontend и сборку Tauri на Windows и Ubuntu. Запуск v0.1 на Arch
подтверждён пользователем; v0.2 требует отдельной проверки desktop на Arch.
В локальной среде агента Rust отсутствует; Cargo.lock пока не зафиксирован.

[План](docs/ROADMAP.md) · [Архитектура](docs/ARCHITECTURE.md) ·
[Цели паритета MobaXterm](docs/MOBAXTERM-PARITY.md) · [MIT](LICENSE)


## v0.5 SFTP GUI — review slice / срез для проверки

Two panels, real structured SFTP v3 listing/navigation and binary upload/download
with no overwrite, confirmation, progress/cancel. GUI: Linux password/PAM via the Files login panel; Windows key/agent. No mkdir, rename,
delete or drag/drop yet. Issue #9 remains open. Arch/Windows manual acceptance
is pending; no merge before verification.

Две панели, настоящий SFTP v3, навигация и бинарная передача без перезаписи,
с подтверждением, прогрессом и отменой. GUI Linux: пароль/PAM через панель входа OpenSSH. Windows: ключ/агент. mkdir/rename/delete/DnD отложены.

See [security, limitations and acceptance](docs/V0.5-SFTP-GUI.md).
