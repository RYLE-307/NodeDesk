import { useEffect, useRef, useState } from "react";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
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
  const destination = {host:connection.host,port:connection.port,username:connection.username};
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
  }, [connection.host, connection.port, connection.username]);
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
    void run(id => invoke<Listing>("files_list",{id,destination:isRemote ? destination : null,path}), listing => {
      if (isRemote) { setRemote(listing); setRemotePath(listing.path); selectRemote(""); }
      else { setLocal(listing); setLocalPath(listing.path); selectLocal(""); }
      setStatus(ru ? "Каталог прочитан" : "Directory loaded");
    });
  }
  function transfer(upload: boolean) {
    const entry = (upload ? local : remote)?.entries.find(e => e.name === (upload ? localSelection : remoteSelection));
    if (!transferAllowed(entry,local,remote,busy)) return;
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
  async function cancel() {
    const id = gate.current.id; if (!id) return; setCancelling(true);
    try { await invoke("files_cancel",{id}); } catch(e) { setError(String(e)); }
  }
  function panel(isRemote: boolean) {
    const listing = isRemote ? remote : local, draft = isRemote ? remotePath : localPath;
    const selection = isRemote ? remoteSelection : localSelection, select = isRemote ? selectRemote : selectLocal;
    const title = isRemote ? (ru ? "Удалённая FS" : "Remote filesystem") : (ru ? "Локальная FS" : "Local filesystem");
    const kinds = ru ? {file:"Файл",directory:"Папка",symlink:"Ссылка",other:"Другой"} : {file:"File",directory:"Folder",symlink:"Link",other:"Other"};
    return <section className="files-panel" aria-label={title}>
      <h3>{title}</h3>
      <form className="files-path" onSubmit={e => {e.preventDefault(); list(isRemote,draft);}}>
        <input aria-label={title + (ru ? ": путь" : ": path")} value={draft} disabled={busy} placeholder={isRemote ? "." : (ru ? "Пусто = домашняя папка" : "Empty = home directory")} onChange={e => isRemote ? setRemotePath(e.target.value) : setLocalPath(e.target.value)}/>
        <button disabled={busy} type="submit">{ru ? "Открыть / обновить" : "Open / refresh"}</button>
        <button disabled={busy || !listing} type="button" onClick={() => listing && list(isRemote,parentPath(listing.path,isRemote))}>{ru ? "Вверх" : "Up"}</button>
      </form>
      <p className="files-current">{listing?.path ?? (ru ? "Панель не загружена" : "Pane not loaded")}</p>
      <div className="files-table-scroll"><table><thead><tr><th>{ru ? "Имя" : "Name"}</th><th>{ru ? "Тип" : "Type"}</th><th>{ru ? "Байт" : "Bytes"}</th><th>{ru ? "Изменён" : "Modified"}</th><th>{ru ? "Права" : "Mode"}</th></tr></thead>
        <tbody>{listing?.entries.map((e: FileEntry) => <tr key={e.name} className={selection === e.name ? "selected" : ""}>
          <td><button disabled={busy || !portableName(e.name)} aria-pressed={selection === e.name} onClick={() => select(e.name)} onDoubleClick={() => {if (e.kind === "directory") list(isRemote,childPath(listing.path,e.name,isRemote));}} title={e.name}>{e.name}</button>
            {e.kind === "directory" && <button disabled={busy || !portableName(e.name)} aria-label={`${ru ? "Открыть папку" : "Open folder"}: ${e.name}`} onClick={() => list(isRemote,childPath(listing.path,e.name,isRemote))}>↳</button>}</td>
          <td>{kinds[e.kind]}</td><td>{e.size ?? "—"}</td><td>{e.modified == null ? "—" : new Date(e.modified * 1000).toLocaleString(ru ? "ru-RU" : "en-US")}</td><td>{e.permissions == null ? "—" : (e.permissions & 0o7777).toString(8)}</td>
        </tr>)}</tbody></table>{listing && !listing.entries.length && <p>{ru ? "Пустая папка" : "Empty directory"}</p>}</div>
    </section>;
  }
  return <section className="file-browser" aria-label={ru ? "Файловый менеджер SFTP" : "SFTP file manager"}>
    <p className="ssh-help">{ru
      ? "SFTP GUI: ключ/агент, только уже доверенный host key. Для первого доверия, пароля/PAM и зашифрованных ключей используйте консоли SSH/SFTP. Ссылки не открываются; перезапись запрещена. Отмена загрузки может оставить .nodedesk-*.part на сервере. Лимит операции 120 секунд."
      : "SFTP GUI: key/agent, previously trusted host key only. Use SSH/SFTP consoles for first trust, password/PAM and encrypted keys. Links cannot be opened; overwrite is disabled. Cancelled uploads may leave .nodedesk-*.part on the server. Operations time out after 120 seconds."}</p>
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
