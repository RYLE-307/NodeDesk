import { useEffect, useRef, useState } from "react";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { SshTerminal } from "./SshTerminal";
import type { Connection } from "./catalog";
import { childPath, parentPath, portableName, progressPercent, transferAllowed, OperationGate } from "./filesModel";
import type { FileEntry, Listing, Progress } from "./filesModel";

export function FileBrowser({ connection, language }: { connection: Connection; language: "ru" | "en" }) {
  const ru = language === "ru";
  const [local, setLocal] = useState<Listing | null>(null), [remote, setRemote] = useState<Listing | null>(null);
  const [localPath, setLocalPath] = useState(""), [remotePath, setRemotePath] = useState(".");
  const [localSelection, selectLocal] = useState(""), [remoteSelection, selectRemote] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null), [cancelling, setCancelling] = useState(false);
  const gate = useRef(new OperationGate()), mounted = useRef(true);
  const [authSession, setAuthSession] = useState<string | null>(null), [authReady, setAuthReady] = useState(false);
  const [interactive, setInteractive] = useState(true);
  const [dropTarget, setDropTarget] = useState<"local" | "remote" | null>(null);
  const profile = JSON.stringify([connection.host,connection.port,connection.username]);
  const destination = {host:connection.host,port:connection.port,username:connection.username,authSession:interactive ? authSession : null};
  useEffect(() => {
    setAuthReady(false);
    if (!authSession || !interactive) return;
    let alive = true;
    const check = () => void invoke<boolean>("files_auth_ready",{id:authSession,host:connection.host,port:connection.port,username:connection.username})
      .then(ready => {if (alive) setAuthReady(ready);}).catch(() => {if (alive) setAuthReady(false);});
    check(); const timer = setInterval(check,1000);
    return () => {alive=false; clearInterval(timer);};
  }, [authSession,interactive,profile]);
  useEffect(() => {
    if (interactive && !authReady) {
      setRemote(null); selectRemote("");
      const id=gate.current.id; if (id) void invoke("files_cancel",{id}).catch(() => {});
    }
  }, [interactive,authReady]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; const id = gate.current.id; if (id) void invoke("files_cancel",{id}).catch(() => {}); };
  }, []);
  // Profile edits invalidate the previous host's listing. No automatic reconnect.
  const previous = useRef(JSON.stringify(destination));
  useEffect(() => {
    const next = JSON.stringify(destination);
    if (next === previous.current) return;
    previous.current = next; setRemote(null); selectRemote(""); setRemotePath(".");
    const id = gate.current.id; if (id) void invoke("files_cancel",{id}).catch(() => {});
  }, [connection.host, connection.port, connection.username, authSession, interactive]);
  async function run<T>(task: (id: string) => Promise<T>, success: (value:T) => void) {
    if (!isTauri()) { setError(ru ? "Файлы доступны в приложении Tauri." : "Files require the Tauri desktop app."); return; }
    const id = crypto.randomUUID(); if (!gate.current.begin(id)) return;
    const host = JSON.stringify(destination);
    setBusy(true); setError(""); setStatus(""); setProgress(null); setCancelling(false);
    try {
      const result = await task(id);
      if (mounted.current && gate.current.owns(id) && previous.current === host) success(result);
    } catch (e) { if (mounted.current && gate.current.owns(id)) setError(String(e)); }
    finally {
      // Close a late registration too if the component was destroyed during invoke.
      if (!mounted.current) void invoke("files_cancel",{id}).catch(() => {});
      if (gate.current.finish(id) && mounted.current) { setBusy(false); setCancelling(false); }
    }
  }
  function list(isRemote: boolean, path: string) {
    if (isRemote && interactive && !authReady) { setError(ru ? "Сначала завершите вход для файлов." : "Complete Files login first."); return; }
    void run(id => invoke<Listing>("files_list",{id,destination:isRemote ? destination : null,path}), listing => {
      if (isRemote) { setRemote(listing); setRemotePath(listing.path); selectRemote(""); }
      else { setLocal(listing); setLocalPath(listing.path); selectLocal(""); }
      setStatus(ru ? "Каталог прочитан" : "Directory loaded");
    });
  }
  function transfer(upload: boolean, draggedName?: string) {
    const entry = (upload ? local : remote)?.entries.find(e => e.name === (draggedName ?? (upload ? localSelection : remoteSelection)));
    if (!transferAllowed(entry,local,remote,busy) || (interactive && !authReady)) return;
    const name = entry!.name;
    const target = upload ? remote! : local!;
    if (target.entries.some(e => e.name === name)) { setError(ru ? "Имя уже существует. Перезапись отключена." : "Destination name exists. Overwrite is disabled."); return; }
    if (!window.confirm(`${upload ? (ru ? "Загрузить на сервер" : "Upload to remote") : (ru ? "Скачать локально" : "Download locally")}\n${name}\n→ ${target.path}\n${ru ? "Без перезаписи" : "No overwrite"}?`)) return;
    void run(id => {
      const events = new Channel<Progress>();
      events.onmessage = p => { if (mounted.current && gate.current.owns(id)) setProgress(p); };
      return invoke("files_transfer",{id,request:{destination,localDirectory:local!.path,remoteDirectory:remote!.path,name,upload},events});
    }, () => {
      // Invalidate the destination after mutation; user refreshes to see current server state.
      if (upload) { setRemote(null); selectRemote(""); } else { setLocal(null); selectLocal(""); }
      setStatus(ru ? "Передача завершена. Обновите панель назначения." : "Transfer completed. Refresh the destination pane.");
    });
  }
  function mutate(isRemote: boolean, action: "mkdir" | "rename" | "delete") {
    const listing = isRemote ? remote : local;
    if (!listing || busy || (isRemote && interactive && !authReady)) return;
    const nameSelected = isRemote ? remoteSelection : localSelection;
    const entry = listing.entries.find(e => e.name === nameSelected);
    if (action !== "mkdir" && (!entry || !portableName(entry.name) || !["file","directory"].includes(entry.kind))) return;
    if (action === "rename" && !isRemote && entry?.kind === "directory") {
      setError(ru ? "Безопасное переименование локальной папки ещё не поддерживается." : "Safe local directory rename is not yet supported.");
      return;
    }
    let name = entry?.name ?? "";
    let newName: string | null = null;
    if (action === "mkdir") {
      name = window.prompt(ru ? "Название новой папки:" : "New folder name:", "") ?? "";
      if (!name) return;
    } else if (action === "rename") {
      newName = window.prompt(ru ? "Новое имя:" : "New name:", name);
      if (newName === null || newName === name) return;
    } else if (action === "delete") {
      const confirmText = ru
        ? `Безвозвратно удалить ${entry!.kind === "directory" ? "ПУСТУЮ папку" : "файл"}?\n${name}\n${listing.path}\nОперацию нельзя отменить.`
        : `Permanently delete ${entry!.kind === "directory" ? "EMPTY directory" : "file"}?\n${name}\n${listing.path}\nThis cannot be undone.`;
      if (!window.confirm(confirmText)) return;
    }
    if (!portableName(name) || (newName !== null && !portableName(newName))) {
      setError(ru ? "Недопустимое имя файла или папки." : "Invalid file or directory name."); return;
    }
    const existing = newName ?? name;
    if (action !== "delete" && listing.entries.some(e => e.name === existing)) {
      setError(ru ? "Имя уже существует. Перезапись запрещена." : "Destination already exists; no overwrite."); return;
    }
    void run(id => invoke("files_mutate",{id,request:{
      destination:isRemote ? destination : null,
      directory:listing.path, name, action, newName,
      expectedKind:entry?.kind ?? null,
    }}), () => {
      if (isRemote) {setRemote(null); selectRemote("");} else {setLocal(null); selectLocal("");}
      setStatus(ru ? "Изменение выполнено. Обновите панель." : "Change completed. Refresh the pane.");
    });
  }
  function dragFile(event: React.DragEvent, isRemote: boolean, entry: FileEntry, folder: string) {
    if (busy || !portableName(entry.name) || entry.kind !== "file") {event.preventDefault();return;}
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-nodedesk-file",JSON.stringify({source:isRemote ? "remote" : "local",name:entry.name,folder}));
  }
  function dropFile(event: React.DragEvent, isRemote: boolean) {
    event.preventDefault(); event.stopPropagation(); setDropTarget(null);
    const raw = event.dataTransfer.getData("application/x-nodedesk-file");
    if (!raw || !local || !remote || busy || (interactive && !authReady)) return;
    try {
      const payload = JSON.parse(raw) as {source?:unknown;name?:unknown;folder?:unknown};
      const sourceRemote = payload.source === "remote";
      if (sourceRemote === isRemote || typeof payload.name !== "string" || !portableName(payload.name)) return;
      const source = sourceRemote ? remote : local;
      if (payload.folder !== source.path || !source.entries.some(e => e.name === payload.name && e.kind === "file")) return;
      transfer(!sourceRemote,payload.name);
    } catch { /* ignore external and invalid drops */ }
  }
  async function cancel() {
    const id = gate.current.id; if (!id) return; setCancelling(true);
    try { await invoke("files_cancel",{id}); } catch(e) { setError(String(e)); }
  }
  function panel(isRemote: boolean) {
    const listing = isRemote ? remote : local, draft = isRemote ? remotePath : localPath;
    const selection = isRemote ? remoteSelection : localSelection, select = isRemote ? selectRemote : selectLocal;
    const title = isRemote ? (ru ? "Удалённая FS" : "Remote filesystem") : (ru ? "Локальная FS" : "Local filesystem");
    const kinds = ru ? {file:"Файл",directory:"Папка",symlink:"Ссылка",other:"Другой"} : {file:"File",directory:"Folder",symlink:"Link",other:"Other"};
    return <section className={`files-panel ${dropTarget === (isRemote ? "remote" : "local") ? "files-drop-target" : ""}`}
      aria-label={title}
      onDragOver={e => {
        if (busy || !local || !remote || (interactive && !authReady) || !e.dataTransfer.types.includes("application/x-nodedesk-file")) return;
        e.preventDefault(); e.dataTransfer.dropEffect="copy";
        setDropTarget(isRemote ? "remote" : "local");
      }}
      onDragLeave={e => {if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null);}}
      onDrop={e => dropFile(e,isRemote)}>
      <h3>{title}</h3>
      <form className="files-path" onSubmit={e => {e.preventDefault(); list(isRemote,draft);}}>
        <input aria-label={title + (ru ? ": путь" : ": path")} value={draft} disabled={busy} placeholder={isRemote ? "." : (ru ? "Пусто = домашняя папка" : "Empty = home directory")} onChange={e => isRemote ? setRemotePath(e.target.value) : setLocalPath(e.target.value)}/>
        <button disabled={busy} type="submit">{ru ? "Открыть / обновить" : "Open / refresh"}</button>
        <button disabled={busy || !listing} type="button" onClick={() => listing && list(isRemote,parentPath(listing.path,isRemote))}>{ru ? "Вверх" : "Up"}</button>
      </form>
      <p className="files-current">{listing?.path ?? (ru ? "Панель не загружена" : "Pane not loaded")}</p>
      <div className="files-ops">
        <button type="button" disabled={busy || !listing || (isRemote && interactive && !authReady)} onClick={() => mutate(isRemote,"mkdir")}>{ru ? "Новая папка" : "New folder"}</button>
        <button type="button" disabled={busy || !listing || !listing.entries.some(e => e.name === selection && ["file","directory"].includes(e.kind)) || (!isRemote && listing.entries.some(e => e.name===selection && e.kind==="directory"))} onClick={() => mutate(isRemote,"rename")}>{ru ? "Переименовать" : "Rename"}</button>
        <button type="button" disabled={busy || !listing || !listing.entries.some(e => e.name===selection && ["file","directory"].includes(e.kind))} onClick={() => mutate(isRemote,"delete")}>{ru ? "Удалить" : "Delete"}</button>
      </div>
      <div className="files-table-scroll"><table><thead><tr><th>{ru ? "Имя" : "Name"}</th><th>{ru ? "Тип" : "Type"}</th><th>{ru ? "Байт" : "Bytes"}</th><th>{ru ? "Изменён" : "Modified"}</th><th>{ru ? "Права" : "Mode"}</th></tr></thead>
        <tbody>{listing?.entries.map((e: FileEntry) => <tr key={e.name} className={selection === e.name ? "selected" : ""}
          draggable={!busy && e.kind === "file" && portableName(e.name)}
          onDragStart={event => dragFile(event,isRemote,e,listing.path)}
          onDragEnd={() => setDropTarget(null)}
          onContextMenu={event => {event.preventDefault();select(e.name);}}
        >
          <td><button disabled={busy || !portableName(e.name)} aria-pressed={selection === e.name} onClick={() => select(e.name)} onDoubleClick={() => {if (e.kind === "directory") list(isRemote,childPath(listing.path,e.name,isRemote));}} title={e.name}>{e.name}</button>
            {e.kind === "directory" && <button disabled={busy || !portableName(e.name)} aria-label={`${ru ? "Открыть папку" : "Open folder"}: ${e.name}`} onClick={() => list(isRemote,childPath(listing.path,e.name,isRemote))}>↳</button>}</td>
          <td>{kinds[e.kind]}</td><td>{e.size ?? "—"}</td><td>{e.modified == null ? "—" : new Date(e.modified * 1000).toLocaleString(ru ? "ru-RU" : "en-US")}</td><td>{e.permissions == null ? "—" : (e.permissions & 0o7777).toString(8)}</td>
        </tr>)}</tbody></table>{listing && !listing.entries.length && <p>{ru ? "Пустая папка" : "Empty directory"}</p>}</div>
    </section>;
  }
  return <section className="file-browser" aria-label={ru ? "Файловый менеджер SFTP" : "SFTP file manager"}>
    <label><input type="checkbox" checked={interactive} disabled={busy} onChange={e => setInteractive(e.target.checked)}/>{ru ? "Вход по паролю/PAM или ключу (Linux)" : "Password/PAM or key login (Linux)"}</label>
    {interactive && <div className="files-login"><SshTerminal key={profile} connection={connection} language={language} kind="filesauth" onSession={setAuthSession}/><p role="status">{authReady ? (ru ? "Вход выполнен — панели готовы" : "Authenticated — panes ready") : (ru ? "Ожидается вход" : "Waiting for login")}</p></div>}
    <p className="ssh-help">{ru ? "При снятой галочке: ключ/агент и ранее доверенный host key (Linux/Windows). Перезапись запрещена. Отмена upload может оставить .nodedesk-*.part. Лимит операции 120 секунд." : "Unchecked: key/agent and previously trusted host key (Linux/Windows). No overwrite. Cancelled uploads may leave .nodedesk-*.part. Operation timeout: 120 seconds."}</p>
    <div className="files-actions">
      <button disabled={!transferAllowed(local?.entries.find(e => e.name === localSelection),local,remote,busy)} onClick={() => transfer(true)}>{ru ? "Загрузить → сервер" : "Upload → remote"}</button>
      <button disabled={!transferAllowed(remote?.entries.find(e => e.name === remoteSelection),local,remote,busy)} onClick={() => transfer(false)}>{ru ? "← Скачать локально" : "← Download locally"}</button>
      <button disabled={!busy || cancelling} onClick={() => void cancel()}>{cancelling ? (ru ? "Отменяется…" : "Cancelling…") : (ru ? "Отменить операцию" : "Cancel operation")}</button>
    </div>
    {progress && <div className="files-progress"><progress aria-label={ru ? "Передано" : "Transferred"} max={100} value={progressPercent(progress)}/><span>{progress.bytes} / {progress.total ?? "?"} {ru ? "байт" : "bytes"}</span></div>}
    {error && <p className="error" role="alert">{ru ? "Ошибка операции" : "Operation failed"}: {error}</p>}
    <p role="status">{busy ? (ru ? "Операция выполняется…" : "Operation in progress…") : status}</p>
    <div className="files-panels">{panel(false)}{panel(true)}</div>
  </section>;
}
