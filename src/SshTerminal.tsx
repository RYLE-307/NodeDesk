import { useEffect, useRef, useState } from "react";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import type { Connection } from "./catalog";
import { FileBrowser } from "./FileBrowser";
import { TunnelWorkspace } from "./TunnelWorkspace";

type AuthMode = "auto" | "key" | "password";
export type TerminalKind = "ssh" | "sftp" | "filesauth" | "local" | "localcmd";
type Event = { kind: "data"; value: number[] } | { kind: "exit"; value: number } | { kind: "error"; value: string };
export function SshTerminal({ connection: c, language, kind = "ssh", passwordOnly = false, onSession }: { connection: Connection; language: "ru" | "en"; kind?: TerminalKind; passwordOnly?: boolean; onSession?: (id: string | null) => void }) {
  const local = kind === "local" || kind === "localcmd";
  const sessionCallback = useRef(onSession); sessionCallback.current = onSession;
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const searchAddon = useRef<SearchAddon | null>(null);
  const currentLanguage=useRef(language); currentLanguage.current=language;
  const session = useRef<string | null>(null);
  const pending = useRef<Promise<unknown>>(Promise.resolve());
  const [status, setStatus] = useState(""), [busy, setBusy] = useState(false);
  const [auth, setAuth] = useState<AuthMode>(passwordOnly ? "password" : "auto");
  const [query,setQuery]=useState("");
  const [fontSize,setFontSize]=useState(13);
  const ru = language === "ru";
  useEffect(() => {
    const term = new Terminal({ cursorBlink: true, scrollback: 2000, fontSize: 13, theme: { background: "#11151b", foreground: "#e2e8f0" } });
    const fit = new FitAddon(); term.loadAddon(fit);
    const search = new SearchAddon(); term.loadAddon(search); searchAddon.current=search;
    term.open(container.current!); terminal.current = term;
    const input = term.onData(data => {
      const id = session.current;
      if (id) pending.current = pending.current.then(() => invoke("ssh_write", { id, data })).catch(() => { setStatus("Terminal input failed"); });
    });
    const observer = new ResizeObserver(() => {
      if (!container.current?.clientWidth || !container.current.clientHeight) return;
      fit.fit();
      if (session.current) void invoke("ssh_resize", { id: session.current, cols: term.cols, rows: term.rows }).catch(() => {});
    });
    observer.observe(container.current!);
    const screen=container.current!;
    const guardPaste=(event:ClipboardEvent)=>{
      const value=event.clipboardData?.getData("text/plain")??"";
      if (!value.includes("\n") && !value.includes("\r")) return;
      if (!window.confirm(currentLanguage.current==="ru"
        ? "Вставить несколько строк в терминал? Команды могут выполниться сразу."
        : "Paste multiple lines into the terminal? Commands may run immediately.")) event.preventDefault();
    };
    screen.addEventListener("paste",guardPaste,true);
    return () => {
      const id = session.current; session.current = null; sessionCallback.current?.(null);
      // Also close after an in-flight connect finishes: cancellation cannot orphan a process.
      if (id) void invoke("ssh_disconnect", { id });
      screen.removeEventListener("paste",guardPaste,true);
      observer.disconnect(); input.dispose(); term.dispose(); terminal.current = null; searchAddon.current=null;
    };
  }, []);
  async function stop() {
    const id = session.current; session.current = null;
    sessionCallback.current?.(null);
    setBusy(false); setStatus(ru ? "Отключено" : "Disconnected");
    if (id) await invoke("ssh_disconnect", { id }).catch(e => setStatus(String(e)));
  }
  async function connect() {
    if (!isTauri()) { setStatus(ru ? "Терминал доступен в настольном приложении" : "Terminal requires the desktop app"); return; }
    const term = terminal.current!;
    const id = crypto.randomUUID(); session.current = id;
    setBusy(true); setStatus(local ? (ru ? "Локальная оболочка запущена" : "Local shell started") : kind === "sftp"
      ? (ru ? "SFTP запущен; ожидайте приглашение sftp>" : "SFTP started; waiting for sftp> prompt")
      : (ru ? "SSH запущен; ожидайте приглашение сервера" : "SSH started; waiting for server prompt")); term.reset(); term.focus();
    const events = new Channel<Event>();
    events.onmessage = event => {
      if (session.current !== id) return;
      if (event.kind === "data") term.write(new Uint8Array(event.value));
      else {
        session.current = null; sessionCallback.current?.(null); setBusy(false);
        setStatus(event.kind === "exit" ? `${ru ? "Сессия завершена, код" : "Session exited, code"} ${event.value}` : event.value);
        void invoke("ssh_disconnect", { id });
      }
    };
    try {
      await invoke("ssh_connect", { id, host: local ? "" : c.host, port: local ? 0 : c.port, username: local ? "" : c.username, auth, kind, cols: Math.min(500, Math.max(2, term.cols)), rows: Math.min(300, Math.max(2, term.rows)), events });
      if (session.current !== id) await invoke("ssh_disconnect", { id });
      else sessionCallback.current?.(id);
    } catch (e) { if (session.current === id) { session.current = null; setBusy(false); setStatus(String(e)); } }
  }
  function changeFont(delta:number) {
    setFontSize(current=>{
      const next=Math.min(24,Math.max(10,current+delta));
      if(terminal.current)terminal.current.options.fontSize=next;
      return next;
    });
  }
  return <section className="ssh-pane" aria-label={c.name}>
    <div className="ssh-toolbar"><strong>{local ? (kind === "localcmd" ? "CMD" : navigator.userAgent.includes("Windows") ? "PowerShell" : (ru ? "Локальная оболочка" : "Local shell")) : kind === "filesauth" ? (ru ? "Вход для файлов" : "Files login") : kind === "sftp" ? "SFTP" : "SSH"} · {c.name}</strong>{!local && <span>{c.username}@{c.host}:{c.port}</span>}
      {!local && <label className="ssh-auth">
        <span>{ru ? "Вход" : "Authentication"}</span>
        <select aria-label={ru ? "Способ SSH-авторизации" : "SSH authentication method"} disabled={busy} value={auth} onChange={e => setAuth(e.target.value as AuthMode)}>
          <option value="auto">{ru ? "Авто" : "Auto"}</option>
          <option value="key" disabled={passwordOnly}>{ru ? "SSH-ключ / агент" : "SSH key / agent"}</option>
          <option value="password">{ru ? "Пароль / PAM" : "Password / PAM"}</option>
        </select>
      </label>}
      <button disabled={busy} onClick={() => void connect()}>{local ? (ru ? "Запустить" : "Start") : (ru ? "Подключить / повторить" : "Connect / reconnect")}</button>
      <button disabled={!busy} onClick={() => void stop()}>{local ? (ru ? "Остановить" : "Stop") : (ru ? "Отключить / отменить" : "Disconnect / cancel")}</button>
    </div>
    <div className="ssh-toolbar terminal-tools">
      <label>{ru?"Поиск в выводе":"Find in output"} <input aria-label={ru?"Поиск в выводе":"Find in output"} value={query}
        onChange={event=>{setQuery(event.target.value);if(event.target.value)searchAddon.current?.findNext(event.target.value);else searchAddon.current?.clearDecorations();}}
        onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();searchAddon.current?.findNext(query);}}}/></label>
      <button type="button" disabled={!query} onClick={()=>searchAddon.current?.findPrevious(query)} aria-label={ru?"Предыдущее совпадение":"Previous match"}>↑</button>
      <button type="button" disabled={!query} onClick={()=>searchAddon.current?.findNext(query)} aria-label={ru?"Следующее совпадение":"Next match"}>↓</button>
      <button type="button" onClick={()=>changeFont(-1)} aria-label={ru?"Уменьшить шрифт":"Decrease font size"}>−</button>
      <span aria-label={ru?"Размер шрифта":"Font size"}>{fontSize}px</span>
      <button type="button" onClick={()=>changeFont(1)} aria-label={ru?"Увеличить шрифт":"Increase font size"}>+</button>
    </div>
    <p className="ssh-help">{local ? (ru ? "Оболочка запускается только по нажатию. Команды выполняются на этом компьютере с вашими правами; закрытие вкладки завершает процесс. PowerShell запускается без профиля." : "The shell starts only when you click Start. Commands run on this computer with your permissions; closing the tab ends the process. PowerShell starts without a profile.") : kind === "filesauth" ? (ru ? "Войдите здесь, затем используйте панели ниже. Ввод пароля/PAM скрыт. Linux использует OpenSSH; Windows — встроенный адаптер с заранее доверенным host key. На Windows режим Авто также использует пароль/PAM; для ключа/агента снимите галочку интерактивного входа. Отключение завершает доступ к файлам." : "Log in here, then use the panels below. Password/PAM input is hidden. Linux uses OpenSSH; Windows uses the native adapter with a previously trusted host key. On Windows Auto also uses password/PAM; for key/agent uncheck interactive login. Disconnect closes Files access.") : kind === "sftp"
      ? (ru
        ? "Настоящий OpenSSH SFTP. После входа используйте pwd, ls, cd, get, put и help. Сначала проверьте SHA256 ключа сервера; пароли не сохраняются. Локальный каталог передачи задавайте командой lcd — по умолчанию он зависит от запуска NodeDesk. Для графического управления файлами откройте вкладку «Файлы»."
        : "Real OpenSSH SFTP. After login use pwd, ls, cd, get, put and help. Independently verify the SHA256 host fingerprint. Passwords are not saved. Set the local transfer directory using lcd; otherwise it depends on how NodeDesk was started. For the graphical file manager, open the Files tab.")
      : (ru
        ? "SSH-ключи, агент или пароль/PAM. Сначала сверьте SHA256 нового ключа сервера по доверенному каналу. Пароль и passphrase вводятся скрыто прямо в терминале и не сохраняются."
        : "SSH keys, agent or password/PAM. Independently verify a new host SHA256 fingerprint. Passwords and passphrases are entered directly at the hidden terminal prompt and are never saved.")}</p>
    <div className="ssh-screen" ref={container}/><div role="status">{status || (ru ? "Не подключено" : "Disconnected")}</div>
  </section>;
}

export function LocalWorkspace({language}:{language:"ru"|"en"}) {
  const windows=navigator.userAgent.includes("Windows");
  const [kind,setKind]=useState<"local"|"localcmd">("local");
  const connection:Connection={id:"__local_shell__",name:language==="ru"?"Локальный терминал":"Local terminal",host:"",port:0,username:"",protocol:"SSH",groupId:null,favorite:false};
  return <section className="ssh-tools-workspace">
    {windows && <div className="ssh-tool-switcher" role="tablist" aria-label={language==="ru"?"Локальные оболочки":"Local shells"}>
      <button type="button" role="tab" aria-selected={kind==="local"} onClick={()=>setKind("local")}>PowerShell</button>
      <button type="button" role="tab" aria-selected={kind==="localcmd"} onClick={()=>setKind("localcmd")}>CMD</button>
    </div>}
    <SshTerminal key={kind} connection={connection} language={language} kind={kind}/>
  </section>;
}

export function SshWorkspace({ connection, language }: { connection: Connection; language: "ru" | "en" }) {
  const [active, setActive] = useState<TerminalKind | "files" | "tunnel">("ssh");
  return <section className="ssh-tools-workspace">
    <div className="ssh-tool-switcher" role="tablist" aria-label={language === "ru" ? "Инструменты подключения" : "Connection tools"}>
      {(["ssh", "sftp", "files", "tunnel"] as const).map(kind => <button key={kind} type="button" role="tab" aria-selected={active === kind}
        onClick={() => setActive(kind)}>{kind === "files" ? (language === "ru" ? "Файлы" : "Files") : kind === "tunnel" ? (language === "ru" ? "Туннель" : "Tunnel") : kind.toUpperCase()}</button>)}
    </div>
    <div role="tabpanel" className="ssh-tool-panel" hidden={active !== "ssh"}>
      <SshTerminal connection={connection} language={language} kind="ssh" />
    </div>
    <div role="tabpanel" className="ssh-tool-panel" hidden={active !== "sftp"}>
      <SshTerminal connection={connection} language={language} kind="sftp" />
    </div>
    <div role="tabpanel" className="ssh-tool-panel" hidden={active !== "files"}>
      <FileBrowser connection={connection} language={language}/>
    </div>
    <div role="tabpanel" className="ssh-tool-panel" hidden={active !== "tunnel"}>
      <TunnelWorkspace connection={connection} language={language}/>
    </div>
  </section>;
}
