import { useEffect, useRef, useState } from "react";
import {invoke,isTauri} from "@tauri-apps/api/core";
import { LocalWorkspace, SshWorkspace } from "./SshTerminal";
import { RdpWorkspace } from "./RdpWorkspace";
import { VncWorkspace } from "./VncWorkspace";
import { VpnWorkspace } from "./VpnWorkspace";
import { VaultWorkspace } from "./VaultWorkspace";
import { NetworkWorkspace } from "./NetworkWorkspace";
import { MonitorPanel } from "./MonitorPanel";
import { Icon } from "./Icon";
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
  moveConnection,
  save,
} from "./catalog";

const labels = {
  ru: {
    move: "Переместить в группу…",
    newGroup: "Новая группа",
    newConnection: "Новое подключение",
    quickConnect: "Быстрое подключение",
    exportCatalog: "Экспорт каталога",
    importCatalog: "Импорт каталога",
    importFailed: "Файл каталога не прошёл проверку; данные не изменены.",
    importConfirm: "Заменить текущий каталог данными из файла? Открытые сессии будут закрыты. Системные секреты не импортируются, но записи с тем же ID и адресом могут использовать уже сохранённый секрет после разблокировки хранилища.",
    importDone: "Каталог импортирован",
    openConnection: "Открыть вкладку",
    duplicate: "Дублировать",
    sidebarResize: "Ширина панели подключений",
    paneWidth: "Ширина рабочих панелей",
    paneHeight: "Высота рабочих панелей",
    actions: "Действия",
    moved: "Подключение перемещено",
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
    recent: "Недавние",
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
    info: "Карточка подключения. Другие протоколы удалённого доступа появятся позже.",
    close: "Закрыть",
    split: "Разделить",
    unsplit: "Одна панель",
    quad: "Четыре панели",
    emptyPane: "Выберите вкладку",
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
    move: "Move to group…",
    newGroup: "New group",
    newConnection: "New connection",
    quickConnect: "Quick Connect",
    exportCatalog: "Export catalog",
    importCatalog: "Import catalog",
    importFailed: "Catalog file failed validation; nothing changed.",
    importConfirm: "Replace the current catalog with this file? Open sessions will close. OS credentials are not imported, but entries with the same ID and endpoint may access an existing saved credential after vault unlock.",
    importDone: "Catalog imported",
    openConnection: "Open tab",
    duplicate: "Duplicate",
    sidebarResize: "Connection sidebar width",
    paneWidth: "Workspace pane width",
    paneHeight: "Workspace pane height",
    actions: "Actions",
    moved: "Connection moved",
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
    recent: "Recent",
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
    info: "Connection details. Additional remote protocols are planned for future versions.",
    close: "Close",
    split: "Split",
    unsplit: "Single pane",
    quad: "Four panes",
    emptyPane: "Choose a tab",
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
const SIDEBAR_WIDTH_KEY = "nodedesk.sidebar.width.v1";
const RECENT_KEY = "nodedesk.recent.v1";
function readPaneRatio(key:string):number {
  try {const value=Number(window.localStorage.getItem(key));return value>=20&&value<=80?value:50;}
  catch{return 50;}
}
function readRecent():string[] {
  try {
    const value=JSON.parse(window.localStorage.getItem(RECENT_KEY)??"[]");
    return Array.isArray(value)?[...new Set(value.filter((id):id is string=>typeof id==="string"&&id.length<=200))].slice(0,20):[];
  } catch {return [];}
}
function readSidebarWidth(): number {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
    const value = raw === null ? 310 : Number(raw);
    return Number.isFinite(value) && value >= 220 && value <= 640 ? value : 310;
  } catch { return 310; }
}
const SYSTEM_VPN_TAB = "__nodedesk_system_vpn__";
const VAULT_TAB = "__nodedesk_vault__";
const LOCAL_SHELL_TAB = "__nodedesk_local_shell__";
const NETWORK_TAB = "__nodedesk_network__";
type Editor =
  | { kind: "group"; value: Group }
  | { kind: "connection"; value: Connection }
  | { kind: "quick"; value: Connection };
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
    [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all");
  const [folded, setFolded] = useState<Set<string>>(new Set()),
    [editor, setEditor] = useState<Editor | null>(null),
    [invalid, setInvalid] = useState(false);
  const [tabs, setTabs] = useState<string[]>([]),
    [active, setActive] = useState(""),
    [secondary, setSecondary] = useState("");
  const [layout,setLayout]=useState<1|2|4>(1);
  const [extraPanes,setExtraPanes]=useState<[string,string]>(["",""]);
  const [columnRatio,setColumnRatio]=useState(()=>readPaneRatio("nodedesk.panes.column.v1"));
  const [rowRatio,setRowRatio]=useState(()=>readPaneRatio("nodedesk.panes.row.v1"));
  const [quickConnections,setQuickConnections] = useState<Record<string,Connection>>({});
  const [recentIds,setRecentIds] = useState(readRecent);
  const [menu, setMenu] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const sidebarWidthRef = useRef(sidebarWidth);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [sshConfigHosts,setSshConfigHosts]=useState<{alias:string;host:string;port:number;username:string}[]|null>(null);
  const [sshConfigError,setSshConfigError]=useState("");
  const [sshConfigBusy,setSshConfigBusy]=useState(false);
  const importInput=useRef<HTMLInputElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragActive = useRef(false);
  function showMenu(id: string, x: number, y: number) {
    setMenu(id);
    setMenuPos({
      x: Math.max(8, Math.min(x, window.innerWidth - 224)),
      y: Math.max(8, Math.min(y, window.innerHeight - 242)),
    });
  }
  function contextMenu(event: React.MouseEvent, id: string) {
    event.preventDefault(); event.stopPropagation();
    showMenu(id, event.clientX, event.clientY);
  }
  function keyboardMenu(event: React.KeyboardEvent, id: string) {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault(); event.stopPropagation();
    const box = event.currentTarget.getBoundingClientRect();
    showMenu(id, box.left + 24, box.bottom);
  }
  function menuFromButton(event: React.MouseEvent, id: string) {
    event.stopPropagation();
    if (menu === id) { setMenu(null); return; }
    const box = event.currentTarget.getBoundingClientRect();
    showMenu(id, box.right - 8, box.bottom);
  }
  const popupStyle = menuPos ? { left: menuPos.x, top: menuPos.y } : undefined;
  useEffect(() => {
    if (menu === null) return;
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && !target.closest(".row-menu, [aria-expanded='true']")) setMenu(null);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(null); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);
  function createConnection(groupId: string | null) {
    edit({kind:"connection",value:{
      id: crypto.randomUUID(), name:"",host:"",port:22,username:"",protocol:"SSH",groupId,favorite:false
    }});
    setMenu(null);
  }
  function quickConnect() {
    edit({kind:"quick",value:{id:crypto.randomUUID(),name:"",host:"",port:22,username:"",protocol:"SSH",groupId:null,favorite:false}});
  }
  function exportCatalog() {
    const content=JSON.stringify(decode(JSON.stringify(data)),null,2);
    const url=URL.createObjectURL(new Blob([content],{type:"application/json"}));
    const link=document.createElement("a");
    link.href=url; link.download="nodedesk-catalog.json";
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  async function importCatalog(file:File|undefined) {
    if(!file)return;
    try {
      if(file.size>2_000_000)throw new Error("Catalog too large");
      const imported=decode(await file.text());
      if(!window.confirm(t.importConfirm))return;
      if(commit(imported)) {
        setTabs([]);setActive("");setSecondary("");setQuickConnections({});
        setLayout(1);setExtraPanes(["",""]);
        setRecentIds([]);try{window.localStorage.removeItem(RECENT_KEY);}catch{/* preference only */}
        setNotice(t.importDone);
      }
    } catch {setNotice(t.importFailed);}
  }
  function createGroup(parentId: string | null) {
    edit({kind:"group",value:{id:crypto.randomUUID(),name:"",parentId}});
    setMenu(null);
  }
  function sidebarPointerMove(event: React.PointerEvent) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const left = event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0;
    const wanted = event.clientX - left;
    if (wanted < 130) { setExpanded(false); return; }
    const value = Math.max(220, Math.min(640, window.innerWidth - 250, wanted));
    sidebarWidthRef.current = value;
    setSidebarWidth(value);
    setExpanded(true);
  }
  function saveSidebarWidth() {
    try { window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidthRef.current)); } catch { /* preference only */ }
  }
  function sidebarKey(event: React.KeyboardEvent) {
    if (!["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") { setExpanded(false); return; }
    const value = event.key === "End" ? 500 :
      Math.max(220, Math.min(640, (expanded ? sidebarWidthRef.current : 220) + (event.key === "ArrowRight" ? 20 : -20)));
    sidebarWidthRef.current = value;
    setSidebarWidth(value);
    setExpanded(true);
    saveSidebarWidth();
  }
  function clearDrag() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setDragId(null); setDropTarget(null);
    setTimeout(() => { dragActive.current = false; }, 0);
  }
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);
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
      setLayout(1);setExtraPanes(["",""]);
      setFilter("all");
    } catch {
      setError("loadError");
    }
  }
  function edit(value: Editor) {
    setInvalid(false);setSshConfigHosts(null);setSshConfigError("");
    setEditor(value);
  }
  async function previewSshConfig(){
    if(!editor || editor.kind==="group" || sshConfigBusy)return;
    setSshConfigHosts(null);setSshConfigError("");
    if(!isTauri()){
      setSshConfigError(data.language==="ru"?"Нужна настольная версия NodeDesk":
        "NodeDesk desktop required");return;
    }
    setSshConfigBusy(true);
    try{
      const list=await invoke<{alias:string;host:string;port:number;username:string}[]>("ssh_config_preview");
      setSshConfigHosts(list);
    }catch(err){setSshConfigError(String(err));}
    finally{setSshConfigBusy(false);}
  }
  function open(id: string) {
    setTabs((prev) => (prev.includes(id) ? prev : [...prev, id]));
    activateTab(id);
    if(data.connections.some(c=>c.id===id)){
      const next=[id,...recentIds.filter(x=>x!==id)].slice(0,20);
      try{window.localStorage.setItem(RECENT_KEY,JSON.stringify(next));}catch{/* preference only */}
      setRecentIds(next);
    }
  }
  function close(id: string) {
    setTabs((prev) => prev.filter((x) => x !== id));
    setQuickConnections(prev => { const next={...prev}; delete next[id]; return next; });
    if (active === id) setActive(tabs.find((x) => x !== id && x !== secondary && !extraPanes.includes(x)) ?? "");
    if (secondary === id) setSecondary("");
    if(extraPanes.includes(id))setExtraPanes(prev=>prev.map(x=>x===id?"":x) as [string,string]);
  }
  function activateTab(id:string) {
    if(secondary===id)setSecondary(active);
    else if(extraPanes.includes(id))setExtraPanes(prev=>prev.map(x=>x===id?active:x) as [string,string]);
    setActive(id);
  }
  function setPane(index:number,id:string) {
    const current=[active,secondary,...extraPanes];
    if(id && current.some((value,i)=>i!==index&&value===id))return;
    if(index===0)setActive(id);
    else if(index===1)setSecondary(id);
    else setExtraPanes(prev=>index===2?[id,prev[1]]:[prev[0],id]);
  }
  function split() {
    if(layout!==1){setLayout(1);setSecondary("");setExtraPanes(["",""]);return;}
    setSecondary(tabs.find(id=>id!==active)??"");setLayout(2);
  }
  function fourPanes() {
    const used=new Set([active,secondary]);
    const available=tabs.filter(id=>!used.has(id));
    setExtraPanes([available[0]??"",available[1]??""]);setLayout(4);
  }
  function panePosition(index:number):React.CSSProperties {
    return layout===4?{gridColumn:index%2+1,gridRow:Math.floor(index/2)+1}:
      {gridColumn:layout===2?index+1:1,gridRow:1};
  }
  function resizePane(event:React.PointerEvent<HTMLDivElement>,axis:"column"|"row") {
    if(!event.currentTarget.hasPointerCapture(event.pointerId))return;
    const box=event.currentTarget.parentElement!.getBoundingClientRect();
    const fraction=axis==="column"?(event.clientX-box.left)/box.width:(event.clientY-box.top)/box.height;
    const value=Math.max(20,Math.min(80,Math.round(fraction*100)));
    if(axis==="column")setColumnRatio(value);else setRowRatio(value);
  }
  function paneResizeKey(event:React.KeyboardEvent<HTMLDivElement>,axis:"column"|"row") {
    const backward=axis==="column"?"ArrowLeft":"ArrowUp",forward=axis==="column"?"ArrowRight":"ArrowDown";
    if(![backward,forward,"Home"].includes(event.key))return;
    event.preventDefault();
    const current=axis==="column"?columnRatio:rowRatio;
    const next=event.key==="Home"?50:Math.max(20,Math.min(80,current+(event.key===forward?5:-5)));
    if(axis==="column")setColumnRatio(next);else setRowRatio(next);
    try{window.localStorage.setItem(`nodedesk.panes.${axis}.v1`,String(next));}catch{/* preference only */}
  }
  function savePaneRatio(axis:"column"|"row") {
    try{window.localStorage.setItem(`nodedesk.panes.${axis}.v1`,String(axis==="column"?columnRatio:rowRatio));}catch{/* preference only */}
  }
  function moveTab(source:string,target:string) {
    if(source===target)return;
    setTabs(prev=>{
      const from=prev.indexOf(source),to=prev.indexOf(target);
      if(from<0||to<0)return prev;
      const next=[...prev];next.splice(from,1);next.splice(to,0,source);
      return next;
    });
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
        (filter === "favorites" ? c.favorite :
         filter === "recent" ? recentIds.includes(c.id) :
         selectedGroups.has(c.groupId ?? ""))) &&
      `${c.name} ${c.host} ${c.username} ${c.protocol} ${path(c.groupId)}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase().trim()),
  ).sort((a,b)=>filter==="recent"?recentIds.indexOf(a.id)-recentIds.indexOf(b.id):0);
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
  function target(groupId: string | null) {
    const key = groupId ?? "root";
    return {
      onDragOver: (e: React.DragEvent) => {
        if (blocked || !dragId || !data.connections.some(c => c.id === dragId && c.groupId !== groupId)) return;
        e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move";
        if (dropTarget !== key) {
          if (hoverTimer.current) clearTimeout(hoverTimer.current);
          setDropTarget(key);
          if (groupId) hoverTimer.current = setTimeout(() => setFolded(prev => {
            const next = new Set(prev); next.delete(groupId); return next;
          }), 650);
        }
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setDropTarget(null);
          if (hoverTimer.current) clearTimeout(hoverTimer.current);
        }
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault(); e.stopPropagation();
        if (!blocked && dragId && e.dataTransfer.getData("application/x-nodedesk-connection") === dragId) {
          const next = moveConnection(data, dragId, groupId);
          if (next !== data && commit(next)) setNotice(t.moved);
        }
        clearDrag();
      },
    };
  }
  function connectionRow(c: Connection, depth: number) {
    return <div key={c.id} className={`connection-row ${active === c.id ? "selected" : ""} ${dragId === c.id ? "dragging" : ""}`} style={{paddingLeft: depth * 14}}
      draggable={!blocked} onDragStart={e => {
        if ((e.target as HTMLElement).closest(".row-menu")) { e.preventDefault(); return; }
        e.dataTransfer.setData("application/x-nodedesk-connection", c.id);
        e.dataTransfer.effectAllowed = "move"; dragActive.current = true; setDragId(c.id); setMenu(null);
      }} onDragEnd={clearDrag}
      onContextMenu={e => contextMenu(e,c.id)} onKeyDown={e => keyboardMenu(e,c.id)}>
      <button className="connection-open" title={`${c.name} — ${c.username ? c.username + "@" : ""}${c.host}:${c.port}`} onClick={() => { if (!dragActive.current) open(c.id); }}>
        <Icon name={c.protocol}/><span className="row-name">{c.name}</span><small>{c.protocol}</small>{c.favorite && <Icon name="star"/>}
      </button>
      <button aria-label={`${t.actions}: ${c.name}`} aria-expanded={menu === c.id} onClick={e => menuFromButton(e,c.id)}><Icon name="more"/></button>
      {menu === c.id && <div className="row-menu context-popup" role="menu" style={popupStyle} onKeyDown={e => { if (e.key === "Escape") { setMenu(null); (e.currentTarget.previousElementSibling as HTMLElement)?.focus(); } }}>
        <button onClick={() => {open(c.id);setMenu(null);}}>{t.openConnection}</button>
        <button disabled={blocked} onClick={() => { edit({kind:"connection", value:{...c}}); setMenu(null); }}>{t.edit} / {t.move}</button>
        <button disabled={blocked} onClick={() => {if(commit({...data,connections:[...data.connections,{...c,id:crypto.randomUUID(),name:c.name+" ("+t.duplicate+")"}]}))setMenu(null);}}>{t.duplicate}</button>
        <button disabled={blocked} aria-pressed={c.favorite} onClick={() => { commit({...data, connections:data.connections.map(x => x.id === c.id ? {...x, favorite:!x.favorite} : x)}); setMenu(null); }}>{t.favorites}</button>
        <button disabled={blocked} onClick={() => { if (window.confirm(t.confirmConnection) && commit({...data, connections:data.connections.filter(x => x.id !== c.id)})) close(c.id); setMenu(null); }}>{t.delete}</button>
      </div>}
    </div>;
  }
  function tree(parent: string | null, depth = 0): React.ReactNode {
    return <>
      {data.groups.filter(g => g.parentId === parent).map(g => <div key={g.id}>
        <div className={`group-row ${dropTarget === g.id ? "drop-target" : ""}`} style={{paddingLeft:depth * 14}} {...target(g.id)} onContextMenu={e => contextMenu(e,g.id)} onKeyDown={e => keyboardMenu(e,g.id)}>
          <button aria-label={g.name} aria-expanded={!folded.has(g.id)} onClick={() => setFolded(prev => { const n = new Set(prev); n.has(g.id) ? n.delete(g.id) : n.add(g.id); return n; })}><span className={!folded.has(g.id) ? "turned" : ""}><Icon name="chevron"/></span></button>
          <button className="grow" title={path(g.id)} onClick={() => { setFilter(g.id); setFolded(prev => { const n = new Set(prev); n.delete(g.id); return n; }); }}><Icon name="folder"/><span className="row-name">{g.name}</span></button>
          <button aria-label={`${t.actions}: ${g.name}`} aria-expanded={menu === g.id} onClick={e => menuFromButton(e,g.id)}><Icon name="more"/></button>
        </div>
        {menu === g.id && <div className="row-menu context-popup" role="menu" style={popupStyle} onKeyDown={e => { if (e.key === "Escape") setMenu(null); }}>
          <button disabled={blocked} onClick={() => createConnection(g.id)}>{t.newConnection}</button>
          <button disabled={blocked} onClick={() => createGroup(g.id)}>{t.newGroup}</button>
          <button disabled={blocked} onClick={() => {edit({kind:"group",value:{...g}});setMenu(null);}}>{t.edit}</button>
          <button disabled={blocked} onClick={() => {if(window.confirm(t.confirmGroup) && commit(removeGroup(data,g.id))) setFilter("all");setMenu(null);}}>{t.delete}</button>
        </div>}
        {(!folded.has(g.id) || query || filter === "favorites" || filter === "recent") && tree(g.id, depth + 1)}
      </div>)}
      {connections.filter(c => c.groupId === parent).map(c => connectionRow(c, depth))}
    </>;
  }
  function tabTitle(id: string) {
    return id === SYSTEM_VPN_TAB ? (data.language === "ru" ? "Системные VPN" : "System VPN") :
      id === VAULT_TAB ? (data.language === "ru" ? "Защищённое хранилище" : "Credential vault") :
      id === LOCAL_SHELL_TAB ? (data.language === "ru" ? "Локальный терминал" : "Local terminal") :
      id === NETWORK_TAB ? (data.language === "ru" ? "Диагностика сети" : "Network diagnostics") :
      (data.connections.find((c) => c.id === id)?.name ?? quickConnections[id]?.name ?? id);
  }
  function pane(id: string) {
    if (id === SYSTEM_VPN_TAB) return <VpnWorkspace language={data.language}/>;
    if (id === VAULT_TAB) return <VaultWorkspace connections={data.connections} language={data.language}/>;
    if (id === LOCAL_SHELL_TAB) return <LocalWorkspace language={data.language}/>;
    if (id === NETWORK_TAB) return <NetworkWorkspace language={data.language}/>;
    const c = data.connections.find((c) => c.id === id) ?? quickConnections[id];
    return c?.protocol === "SSH" ? <SshWorkspace connection={c} language={data.language}/> :
      c?.protocol === "RDP" ? <RdpWorkspace connection={c} language={data.language}/> :
      c?.protocol === "VNC" ? <VncWorkspace connection={c} language={data.language}/> : c ? (
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
    <div className={`app ${expanded ? "" : "collapsed"}`} style={{"--sidebar-width": `${sidebarWidth}px`} as React.CSSProperties}>
      <aside aria-label={t.navigation}>
        <header>
          <img className="logo" src={logo} alt="" />
          {expanded && (
            <strong>
              NodeDesk <small>0.9 QA</small>
            </strong>
          )}
          <button
            aria-label={t.navigation}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            <Icon name="menu"/>
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
                  <Icon name="plus"/> {t.add}
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
                  <Icon name="plus"/> {t.group}
                </button>
              </div>
              <button type="button" onClick={quickConnect}><Icon name="plus"/> {t.quickConnect}</button>
              <div className="actions">
                <button type="button" onClick={exportCatalog} disabled={blocked}>{t.exportCatalog}</button>
                <button type="button" onClick={()=>importInput.current?.click()} disabled={blocked}>{t.importCatalog}</button>
              </div>
              <input ref={importInput} type="file" accept=".json,application/json" hidden
                onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value="";void importCatalog(file);}}/>
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
                <Icon name="star"/> {t.favorites}
              </button>
              <button className={filter === "recent" ? "selected" : ""}
                onClick={() => setFilter("recent")}>{t.recent}</button>
              <button type="button" aria-label={data.language === "ru" ? "Системные VPN" : "System VPN"}
                className={active === SYSTEM_VPN_TAB ? "selected" : ""}
                onClick={() => open(SYSTEM_VPN_TAB)}>
                <Icon name="VPN"/> {data.language === "ru" ? "Системные VPN" : "System VPN"}
              </button>
              <button type="button" aria-label={data.language === "ru" ? "Защищённое хранилище" : "Credential vault"}
                className={active === VAULT_TAB ? "selected" : ""}
                onClick={() => open(VAULT_TAB)}>
                {data.language === "ru" ? "Защищённое хранилище" : "Credential vault"}
              </button>
              <button type="button" aria-label={data.language === "ru" ? "Локальный терминал" : "Local terminal"}
                className={active === LOCAL_SHELL_TAB ? "selected" : ""}
                onClick={() => open(LOCAL_SHELL_TAB)}>
                <Icon name="SSH"/> {data.language === "ru" ? "Локальный терминал" : "Local terminal"}
              </button>
              <button type="button" aria-label={data.language === "ru" ? "Диагностика сети" : "Network diagnostics"}
                className={active === NETWORK_TAB ? "selected" : ""}
                onClick={() => open(NETWORK_TAB)}>
                <Icon name="VPN"/> {data.language === "ru" ? "Диагностика сети" : "Network diagnostics"}
              </button>

            </div>
            <div className="connection-list" onContextMenu={e => {if(!(e.target as HTMLElement).closest(".group-row, .connection-row, .root-target, .row-menu")) contextMenu(e,"catalog");}} onDragOver={e => {
              if (!dragId) return;
              const bounds = e.currentTarget.getBoundingClientRect();
              if (e.clientY < bounds.top + 40) e.currentTarget.scrollTop -= 14;
              if (e.clientY > bounds.bottom - 40) e.currentTarget.scrollTop += 14;
            }}>
              <div className={`root-target ${dropTarget === "root" ? "drop-target" : ""}`} {...target(null)} onContextMenu={e => contextMenu(e,"catalog")} onKeyDown={e => keyboardMenu(e,"catalog")} tabIndex={0}><Icon name="folder"/>{t.root}</div>
              {menu === "catalog" && <div className="row-menu context-popup" role="menu" style={popupStyle} onKeyDown={e => {if(e.key==="Escape") setMenu(null);}}>
                <button disabled={blocked} onClick={() => createConnection(null)}>{t.newConnection}</button>
                <button disabled={blocked} onClick={() => createGroup(null)}>{t.newGroup}</button>
              </div>}
              {tree(null)}
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
      <div role="separator" className="sidebar-resize-handle" tabIndex={0}
        aria-orientation="vertical" aria-label={t.sidebarResize}
        aria-valuemin={76} aria-valuemax={640} aria-valuenow={expanded ? sidebarWidth : 76}
        onPointerDown={e => { if(e.button!==0) return; e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault(); }}
        onPointerMove={sidebarPointerMove}
        onPointerUp={e => { if(e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); saveSidebarWidth(); }}
        onPointerCancel={e => { if(e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); saveSidebarWidth(); }}
        onKeyDown={sidebarKey}
        onDoubleClick={() => { sidebarWidthRef.current=310; setSidebarWidth(310); setExpanded(true); saveSidebarWidth(); }}
      />
      <main aria-label={t.workspace}>
        {error && (
          <div role="alert" className="error">
            {t[error]} <button onClick={reload}>{t.retry}</button>
          </div>
        )}
        <div className="tabs" aria-label={t.tabs}>
          {tabs.map((id) => (
            <div className="tab" key={id} draggable
              onDragStart={e=>{e.dataTransfer.setData("application/x-nodedesk-tab",id);e.dataTransfer.effectAllowed="move";}}
              onDragOver={e=>{if(e.dataTransfer.types.includes("application/x-nodedesk-tab")){e.preventDefault();e.dataTransfer.dropEffect="move";}}}
              onDrop={e=>{e.preventDefault();moveTab(e.dataTransfer.getData("application/x-nodedesk-tab"),id);}}>
              <button
                aria-pressed={active === id}
                onKeyDown={e=>{if(e.altKey&&["ArrowLeft","ArrowRight"].includes(e.key)){e.preventDefault();const index=tabs.indexOf(id);const adjacent=tabs[index+(e.key==="ArrowLeft"?-1:1)];if(adjacent)moveTab(id,adjacent);}}}
                onClick={() => activateTab(id)}
              >
                {tabTitle(id)}
              </button>
              <button
                aria-label={`${t.close}: ${tabTitle(id)}`}
                onClick={() => close(id)}
              >
                ×
              </button>
            </div>
          ))}
          {active && (
            <button
              className="split"
              onClick={split}
            >
              {layout===1 ? t.split : t.unsplit}
            </button>
          )}
          {layout===2 && <button type="button" onClick={fourPanes}>{t.quad}</button>}
          {layout>1 && (layout===2?[secondary]:[secondary,...extraPanes]).map((id,offset)=><select key={offset} className="pane-choice"
            aria-label={`${t.tabs} ${offset+2}`} value={id} onChange={e=>setPane(offset+1,e.target.value)}>
            <option value="">{t.emptyPane}</option>
            {tabs.filter(tab=>tab===id||![active,secondary,...extraPanes].includes(tab)).map(tab=><option key={tab} value={tab}>{tabTitle(tab)}</option>)}
          </select>)}
        </div>
        <div className={`workspace ${layout===2?"split-workspace":layout===4?"quad-workspace":""}`}
          style={layout===1?undefined:{gridTemplateColumns:`minmax(0, ${columnRatio}fr) minmax(0, ${100-columnRatio}fr)`,
            ...(layout===4?{gridTemplateRows:`minmax(0, ${rowRatio}fr) minmax(0, ${100-rowRatio}fr)`}:{})}}>
          {tabs.map(id=>{
            const slots=layout===1?[active]:layout===2?[active,secondary]:[active,secondary,...extraPanes];
            const index=slots.indexOf(id);
            return <div className="tab-pane" key={id} hidden={index<0} data-slot={index} style={index<0?undefined:panePosition(index)}>{pane(id)}</div>;
          })}
          {(layout===1?[active]:layout===2?[active,secondary]:[active,secondary,...extraPanes]).map((id,index)=>!id&&
            <p className="pane-empty muted" key={index} style={panePosition(index)}>{t.emptyPane}</p>)}
          {layout>1&&<div className="pane-divider column-divider" role="separator" tabIndex={0}
            aria-label={t.paneWidth} aria-orientation="vertical" aria-valuemin={20} aria-valuemax={80} aria-valuenow={columnRatio}
            style={{left:`${columnRatio}%`}}
            onPointerDown={e=>{if(e.button===0)e.currentTarget.setPointerCapture(e.pointerId);}}
            onPointerMove={e=>resizePane(e,"column")}
            onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);savePaneRatio("column");}}
            onKeyDown={e=>paneResizeKey(e,"column")}/>}
          {layout===4&&<div className="pane-divider row-divider" role="separator" tabIndex={0}
            aria-label={t.paneHeight} aria-orientation="horizontal" aria-valuemin={20} aria-valuemax={80} aria-valuenow={rowRatio}
            style={{top:`${rowRatio}%`}}
            onPointerDown={e=>{if(e.button===0)e.currentTarget.setPointerCapture(e.pointerId);}}
            onPointerMove={e=>resizePane(e,"row")}
            onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);savePaneRatio("row");}}
            onKeyDown={e=>paneResizeKey(e,"row")}/>}
        </div>
        {data.monitoring && <MonitorPanel language={data.language}/>}
        <div className="status">{t.stage}<span role="status"> {notice}</span></div>
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
                          rdpSha256Fingerprint: (value as Connection).protocol === "RDP"
                            ? (value as Connection).rdpSha256Fingerprint : undefined,
                        } as Connection,
                      ],
                    };
              try {
                const validated = decode(JSON.stringify(next));
                if (editor.kind === "quick") {
                  const connection=validated.connections.find(c=>c.id===value.id);
                  if (!connection) throw new Error("Invalid quick connection");
                  setQuickConnections(prev=>({...prev,[connection.id]:connection}));
                  open(connection.id);
                  setEditor(null);
                } else if (commit(validated)) setEditor(null);
              } catch {
                setInvalid(true);
              }
            }}
          >
            <h2>{editor.kind === "group" ? t.group : editor.kind === "quick" ? t.quickConnect : t.add}</h2>
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
                          port: protocol === "SSH" ? 22 : protocol === "VNC" ? 5900 : 3389,
                        },
                      });
                    }}
                  >
                    <option>SSH</option>
                    <option>RDP</option>
                    <option>VNC</option>
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
                {editor.value.protocol === "SSH" && <div className="ssh-config-preview">
                  <button type="button" disabled={sshConfigBusy}
                    onClick={()=>void previewSshConfig()}>
                    {sshConfigBusy?(data.language==="ru"?"Чтение конфигурации…":"Reading config…"):
                      (data.language==="ru"?"Показать SSH config":"Preview local SSH config")}
                  </button>
                  {sshConfigError&&<p role="alert" className="error">{sshConfigError}</p>}
                  {sshConfigHosts&&<label>
                    {data.language==="ru"?"Выбрать запись Host":"Select SSH Host entry"}
                    <select aria-label="SSH config host" defaultValue="" onChange={e=>{
                      const record=sshConfigHosts.find(h=>h.alias===e.target.value);
                      if(record){
                        setEditor({...editor,value:{...editor.value,
                          name:record.alias,host:record.host,port:record.port,username:record.username
                        }} as Editor);
                      }
                    }}>
                      <option value="">{data.language==="ru"?"Не выбран":"Not selected"}</option>
                      {sshConfigHosts.map(h=><option key={h.alias} value={h.alias}>
                        {h.alias} → {h.username?h.username+"@":""}{h.host}:{h.port}
                      </option>)}
                    </select>
                  </label>}
                  <p className="ssh-help">{data.language==="ru"
                    ?"Читается только ~/.ssh/config. Подставляются Host, HostName, User и Port; Include, ProxyCommand, ключи и команды игнорируются. Соединение не начинается и конфигурация не исполняется."
                    :"Reads only ~/.ssh/config. Extracts Host, HostName, User and Port; Include, ProxyCommand, keys and commands are ignored. No connection or config execution."}</p>
                </div>}
                {editor.value.protocol === "RDP" && <label>
                  {data.language === "ru" ? "SHA256 отпечаток сертификата (Linux FreeRDP, необязательно)" : "Certificate SHA256 fingerprint (Linux FreeRDP, optional)"}
                  <input aria-label="RDP SHA256 fingerprint" autoComplete="off" spellCheck={false}
                    placeholder="64 hex or colon-separated pairs"
                    value={editor.value.rdpSha256Fingerprint ?? ""}
                    onChange={(e) => setEditor({ ...editor, value: { ...editor.value, rdpSha256Fingerprint: e.target.value || undefined } })}/>
                </label>}
                {editor.kind !== "quick" && <label>
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
                </label>}
                {editor.kind !== "quick" && <label className="check">
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
                </label>}
              </>
            )}
            <div className="actions">
              <button type="button" onClick={() => setEditor(null)}>
                {t.cancel}
              </button>
              <button type="submit">{editor.kind === "quick" ? t.openConnection : t.save}</button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
