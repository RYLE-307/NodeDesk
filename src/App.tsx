import { useEffect, useRef, useState } from "react";
import logo from "./assets/nodedesk-logo.svg";
import {
  Catalog,
  Connection,
  Group,
  decode,
  descendants,
  emptyCatalog,
  load,
  removeGroup,
  save,
} from "./catalog";

const labels = {
  ru: {
    navigation: "Навигация",
    connections: "Подключения",
    empty: "Каталог пока пуст",
    workspace: "Рабочая область",
    tabs: "Вкладки",
    add: "Подключение",
    group: "Группа",
    search: "Поиск по имени, адресу, пользователю и группе",
    all: "Все подключения",
    favorites: "Избранное",
    edit: "Изменить",
    delete: "Удалить",
    name: "Название",
    host: "Адрес хоста",
    port: "Порт",
    username: "Пользователь",
    protocol: "Протокол",
    parent: "Родительская группа",
    root: "Без группы",
    save: "Сохранить",
    cancel: "Отмена",
    dark: "Тёмная",
    light: "Светлая",
    system: "Системная",
    theme: "Тема",
    language: "Язык",
    monitoring: "Мониторинг",
    unavailable: "Источники мониторинга ещё не подключены.",
    offline: "Не подключено",
    info: "Карточка подключения. Сетевые сессии SSH/RDP появятся позже.",
    close: "Закрыть",
    split: "Разделить",
    unsplit: "Одна панель",
    loadError:
      "Не удалось прочитать каталог. Исходные данные сохранены; изменения заблокированы. Исправьте хранилище и повторите загрузку.",
    saveError:
      "Не удалось сохранить изменения. Каталог не изменён. Проверьте доступность локального хранилища.",
    retry: "Повторить загрузку",
    invalid:
      "Проверьте поля: название обязательно, адрес без URL и пробелов, порт 1–65535. Циклические группы запрещены.",
    confirmConnection: "Удалить подключение?",
    confirmGroup:
      "Удалить группу и вложенные группы? Подключения переместятся в корень.",
    none: "Ничего не найдено",
    stage: "Локальный каталог · без автоподключений",
  },
  en: {
    navigation: "Navigation",
    connections: "Connections",
    empty: "No connections yet",
    workspace: "Workspace",
    tabs: "Tabs",
    add: "Connection",
    group: "Group",
    search: "Search names, hosts, users and groups",
    all: "All connections",
    favorites: "Favorites",
    edit: "Edit",
    delete: "Delete",
    name: "Name",
    host: "Host address",
    port: "Port",
    username: "Username",
    protocol: "Protocol",
    parent: "Parent group",
    root: "Ungrouped",
    save: "Save",
    cancel: "Cancel",
    dark: "Dark",
    light: "Light",
    system: "System",
    theme: "Theme",
    language: "Language",
    monitoring: "Monitoring",
    unavailable: "Monitoring sources are not connected yet.",
    offline: "Disconnected",
    info: "Connection details. SSH/RDP network sessions will be added later.",
    close: "Close",
    split: "Split",
    unsplit: "Single pane",
    loadError:
      "Could not read catalog. Original data is preserved; changes are blocked. Repair storage and reload.",
    saveError:
      "Could not save changes. Catalog was not changed. Check local storage availability.",
    retry: "Reload",
    invalid:
      "Check fields: name required, host without URL or spaces, port 1–65535. Group cycles are forbidden.",
    confirmConnection: "Delete connection?",
    confirmGroup:
      "Delete this group and descendants? Connections will move to root.",
    none: "No results",
    stage: "Local catalog · no automatic connections",
  },
};
type Editor =
  | { kind: "group"; value: Group }
  | { kind: "connection"; value: Connection };
export default function App() {
  const [initial] = useState(() => {
    try {
      return { data: load(window.localStorage), failed: false };
    } catch {
      return { data: emptyCatalog(), failed: true };
    }
  });
  const [data, setData] = useState(initial.data),
    [blocked, setBlocked] = useState(initial.failed);
  const [error, setError] = useState<"loadError" | "saveError" | null>(
    initial.failed ? "loadError" : null,
  );
  const [expanded, setExpanded] = useState(true),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all");
  const [folded, setFolded] = useState<Set<string>>(new Set()),
    [editor, setEditor] = useState<Editor | null>(null),
    [invalid, setInvalid] = useState(false);
  const [tabs, setTabs] = useState<string[]>([]),
    [active, setActive] = useState(""),
    [secondary, setSecondary] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    t = labels[data.language];
  useEffect(() => {
    document.documentElement.lang = data.language;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        data.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : data.theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [data.language, data.theme]);
  useEffect(() => {
    if (editor) dialog.current?.showModal();
    else dialog.current?.close();
  }, [!!editor]);
  function commit(next: Catalog) {
    if (blocked) return false;
    try {
      save(window.localStorage, next);
      setData(next);
      setError(null);
      return true;
    } catch {
      setError("saveError");
      return false;
    }
  }
  function reload() {
    try {
      setData(load(window.localStorage));
      setBlocked(false);
      setError(null);
      setTabs([]);
      setActive("");
      setSecondary("");
      setFilter("all");
    } catch {
      setError("loadError");
    }
  }
  function edit(value: Editor) {
    setInvalid(false);
    setEditor(value);
  }
  function open(id: string) {
    setTabs((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setActive(id);
  }
  function close(id: string) {
    setTabs((prev) => prev.filter((x) => x !== id));
    if (active === id) setActive(tabs.find((x) => x !== id) ?? "");
    if (secondary === id) setSecondary("");
  }
  function path(id: string | null): string {
    const parts: string[] = [];
    let g = data.groups.find((g) => g.id === id);
    while (g) {
      parts.unshift(g.name);
      g = data.groups.find((x) => x.id === g!.parentId);
    }
    return parts.join(" / ");
  }
  const selectedGroups = descendants(data.groups, filter);
  const connections = data.connections.filter(
    (c) =>
      (filter === "all" ||
        (filter === "favorites"
          ? c.favorite
          : selectedGroups.has(c.groupId ?? ""))) &&
      `${c.name} ${c.host} ${c.username} ${c.protocol} ${path(c.groupId)}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase().trim()),
  );
  const options = (excluded = new Set<string>()) => (
    <>
      <option value="">{t.root}</option>
      {data.groups
        .filter((g) => !excluded.has(g.id))
        .map((g) => (
          <option key={g.id} value={g.id}>
            {path(g.id)}
          </option>
        ))}
    </>
  );
  function tree(parent: string | null, depth = 0): React.ReactNode {
    return data.groups
      .filter((g) => g.parentId === parent)
      .map((g) => (
        <div key={g.id}>
          <div className="group-row" style={{ paddingLeft: depth * 12 }}>
            <button
              aria-label={g.name}
              aria-expanded={!folded.has(g.id)}
              onClick={() =>
                setFolded((prev) => {
                  const n = new Set(prev);
                  n.has(g.id) ? n.delete(g.id) : n.add(g.id);
                  return n;
                })
              }
            >
              {folded.has(g.id) ? "▸" : "▾"}
            </button>
            <button
              className={filter === g.id ? "selected grow" : "grow"}
              onClick={() => setFilter(g.id)}
            >
              ▱ {g.name}
            </button>
            <button
              disabled={blocked}
              aria-label={`${t.edit}: ${g.name}`}
              onClick={() => edit({ kind: "group", value: { ...g } })}
            >
              ✎
            </button>
            <button
              disabled={blocked}
              aria-label={`${t.delete}: ${g.name}`}
              onClick={() => {
                if (
                  window.confirm(t.confirmGroup) &&
                  commit(removeGroup(data, g.id))
                )
                  setFilter("all");
              }}
            >
              ×
            </button>
          </div>
          {!folded.has(g.id) && tree(g.id, depth + 1)}
        </div>
      ));
  }
  function pane(id: string) {
    const c = data.connections.find((c) => c.id === id);
    return c ? (
      <section className="pane" aria-label={c.name}>
        <span className="badge">
          {c.protocol} · {t.offline}
        </span>
        <h1>{c.name}</h1>
        <dl>
          <dt>{t.host}</dt>
          <dd>{c.host}</dd>
          <dt>{t.port}</dt>
          <dd>{c.port}</dd>
          <dt>{t.username}</dt>
          <dd>{c.username || "—"}</dd>
          <dt>{t.group}</dt>
          <dd>{path(c.groupId) || t.root}</dd>
        </dl>
        <p>{t.info}</p>
        <button
          disabled={blocked}
          onClick={() => edit({ kind: "connection", value: { ...c } })}
        >
          {t.edit}
        </button>
      </section>
    ) : null;
  }
  return (
    <div className={`app ${expanded ? "" : "collapsed"}`}>
      <aside aria-label={t.navigation}>
        <header>
          <img className="logo" src={logo} alt="" />
          {expanded && (
            <strong>
              NodeDesk <small>0.2</small>
            </strong>
          )}
          <button
            aria-label={t.navigation}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            ☰
          </button>
        </header>
        {expanded && (
          <>
            <div className="catalog-tools">
              <h2>{t.connections}</h2>
              <div className="actions">
                <button
                  disabled={blocked}
                  onClick={() =>
                    edit({
                      kind: "connection",
                      value: {
                        id: crypto.randomUUID(),
                        name: "",
                        host: "",
                        port: 22,
                        username: "",
                        protocol: "SSH",
                        groupId: data.groups.some((g) => g.id === filter)
                          ? filter
                          : null,
                        favorite: false,
                      },
                    })
                  }
                >
                  ＋ {t.add}
                </button>
                <button
                  disabled={blocked}
                  onClick={() =>
                    edit({
                      kind: "group",
                      value: {
                        id: crypto.randomUUID(),
                        name: "",
                        parentId: data.groups.some((g) => g.id === filter)
                          ? filter
                          : null,
                      },
                    })
                  }
                >
                  ＋ {t.group}
                </button>
              </div>
              <input
                type="search"
                aria-label={t.search}
                placeholder={t.search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                className={filter === "all" ? "selected" : ""}
                onClick={() => setFilter("all")}
              >
                {t.all} <small>{data.connections.length}</small>
              </button>
              <button
                className={filter === "favorites" ? "selected" : ""}
                onClick={() => setFilter("favorites")}
              >
                ☆ {t.favorites}
              </button>
              {tree(null)}
            </div>
            <div className="connection-list">
              {connections.map((c) => (
                <article className="connection" key={c.id}>
                  <button
                    className="connection-open"
                    onClick={() => open(c.id)}
                  >
                    <span className="protocol">{c.protocol}</span>
                    <strong>{c.name}</strong>
                    <small>
                      {c.host}:{c.port}
                    </small>
                  </button>
                  <div className="actions">
                    <button
                      disabled={blocked}
                      aria-label={`${t.favorites}: ${c.name}`}
                      aria-pressed={c.favorite}
                      onClick={() =>
                        commit({
                          ...data,
                          connections: data.connections.map((x) =>
                            x.id === c.id ? { ...x, favorite: !x.favorite } : x,
                          ),
                        })
                      }
                    >
                      {c.favorite ? "★" : "☆"}
                    </button>
                    <button
                      disabled={blocked}
                      aria-label={`${t.edit}: ${c.name}`}
                      onClick={() =>
                        edit({ kind: "connection", value: { ...c } })
                      }
                    >
                      ✎
                    </button>
                    <button
                      disabled={blocked}
                      aria-label={`${t.delete}: ${c.name}`}
                      onClick={() => {
                        if (
                          window.confirm(t.confirmConnection) &&
                          commit({
                            ...data,
                            connections: data.connections.filter(
                              (x) => x.id !== c.id,
                            ),
                          })
                        )
                          close(c.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                </article>
              ))}
              {!connections.length && (
                <p className="muted">
                  {data.connections.length ? t.none : t.empty}
                </p>
              )}
            </div>
          </>
        )}
        <footer>
          <label>
            {expanded && t.language}
            <select
              disabled={blocked}
              aria-label={t.language}
              value={data.language}
              onChange={(e) =>
                commit({
                  ...data,
                  language: e.target.value as Catalog["language"],
                })
              }
            >
              <option value="ru">RU</option>
              <option value="en">EN</option>
            </select>
          </label>
          {expanded && (
            <>
              <label>
                {t.theme}
                <select
                  disabled={blocked}
                  value={data.theme}
                  onChange={(e) =>
                    commit({
                      ...data,
                      theme: e.target.value as Catalog["theme"],
                    })
                  }
                >
                  {(["dark", "light", "system"] as const).map((x) => (
                    <option key={x} value={x}>
                      {t[x]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  disabled={blocked}
                  checked={data.monitoring}
                  onChange={(e) =>
                    commit({ ...data, monitoring: e.target.checked })
                  }
                />
                {t.monitoring}
              </label>
            </>
          )}
        </footer>
      </aside>
      <main aria-label={t.workspace}>
        {error && (
          <div role="alert" className="error">
            {t[error]} <button onClick={reload}>{t.retry}</button>
          </div>
        )}
        <div className="tabs" aria-label={t.tabs}>
          {tabs.map((id) => (
            <div className="tab" key={id}>
              <button
                aria-pressed={active === id}
                onClick={() => setActive(id)}
              >
                {data.connections.find((c) => c.id === id)?.name}
              </button>
              <button
                aria-label={`${t.close}: ${data.connections.find((c) => c.id === id)?.name}`}
                onClick={() => close(id)}
              >
                ×
              </button>
            </div>
          ))}
          {active && (
            <button
              className="split"
              onClick={() => setSecondary(secondary ? "" : active)}
            >
              {secondary ? t.unsplit : t.split}
            </button>
          )}
        </div>
        <div className={`workspace ${secondary ? "split-workspace" : ""}`}>
          {pane(active)}
          {secondary && (
            <div className="secondary">
              <select
                aria-label={t.tabs}
                value={secondary}
                onChange={(e) => setSecondary(e.target.value)}
              >
                {tabs.map((id) => (
                  <option key={id} value={id}>
                    {data.connections.find((c) => c.id === id)?.name}
                  </option>
                ))}
              </select>
              {pane(secondary)}
            </div>
          )}
        </div>
        {data.monitoring && (
          <section className="monitor">
            <strong>{t.monitoring}</strong>
            <p>{t.unavailable}</p>
          </section>
        )}
        <div className="status">{t.stage}</div>
      </main>
      <dialog
        ref={dialog}
        onCancel={() => setEditor(null)}
        onClose={() => setEditor(null)}
      >
        {editor && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const value = { ...editor.value, name: editor.value.name.trim() };
              const next =
                editor.kind === "group"
                  ? {
                      ...data,
                      groups: [
                        ...data.groups.filter((g) => g.id !== value.id),
                        value as Group,
                      ],
                    }
                  : {
                      ...data,
                      connections: [
                        ...data.connections.filter((c) => c.id !== value.id),
                        {
                          ...value,
                          host: (value as Connection).host.trim(),
                          username: (value as Connection).username.trim(),
                        } as Connection,
                      ],
                    };
              try {
                decode(JSON.stringify(next));
              } catch {
                setInvalid(true);
                return;
              }
              if (commit(next)) setEditor(null);
            }}
          >
            <h2>{editor.kind === "group" ? t.group : t.add}</h2>
            {error === "saveError" && (
              <p role="alert" className="error">
                {t.saveError}
              </p>
            )}
            {invalid && (
              <p role="alert" className="error">
                {t.invalid}
              </p>
            )}
            <label>
              {t.name}
              <input
                autoFocus
                required
                maxLength={200}
                value={editor.value.name}
                onChange={(e) =>
                  setEditor({
                    ...editor,
                    value: { ...editor.value, name: e.target.value },
                  } as Editor)
                }
              />
            </label>
            {editor.kind === "group" ? (
              <label>
                {t.parent}
                <select
                  value={editor.value.parentId ?? ""}
                  onChange={(e) =>
                    setEditor({
                      ...editor,
                      value: {
                        ...editor.value,
                        parentId: e.target.value || null,
                      },
                    })
                  }
                >
                  {options(descendants(data.groups, editor.value.id))}
                </select>
              </label>
            ) : (
              <>
                <label>
                  {t.protocol}
                  <select
                    value={editor.value.protocol}
                    onChange={(e) => {
                      const protocol = e.target.value as Connection["protocol"];
                      setEditor({
                        ...editor,
                        value: {
                          ...editor.value,
                          protocol,
                          port: protocol === "SSH" ? 22 : 3389,
                        },
                      });
                    }}
                  >
                    <option>SSH</option>
                    <option>RDP</option>
                  </select>
                </label>
                <label>
                  {t.host}
                  <input
                    required
                    maxLength={253}
                    value={editor.value.host}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        value: { ...editor.value, host: e.target.value },
                      })
                    }
                  />
                </label>
                <label>
                  {t.port}
                  <input
                    type="number"
                    required
                    min={1}
                    max={65535}
                    value={editor.value.port}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        value: {
                          ...editor.value,
                          port: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <label>
                  {t.username}
                  <input
                    maxLength={200}
                    value={editor.value.username}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        value: { ...editor.value, username: e.target.value },
                      })
                    }
                  />
                </label>
                <label>
                  {t.group}
                  <select
                    value={editor.value.groupId ?? ""}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        value: {
                          ...editor.value,
                          groupId: e.target.value || null,
                        },
                      })
                    }
                  >
                    {options()}
                  </select>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={editor.value.favorite}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        value: { ...editor.value, favorite: e.target.checked },
                      })
                    }
                  />
                  {t.favorites}
                </label>
              </>
            )}
            <div className="actions">
              <button type="button" onClick={() => setEditor(null)}>
                {t.cancel}
              </button>
              <button type="submit">{t.save}</button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
