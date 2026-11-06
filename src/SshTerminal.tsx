import { useEffect, useRef, useState } from "react";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { Connection } from "./catalog";

type AuthMode = "auto" | "key" | "password";
export type TerminalKind = "ssh" | "sftp";
type Event = { kind: "data"; value: number[] } | { kind: "exit"; value: number } | { kind: "error"; value: string };
export function SshTerminal({ connection: c, language, kind = "ssh" }: { connection: Connection; language: "ru" | "en"; kind?: TerminalKind }) {
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const session = useRef<string | null>(null);
  const pending = useRef<Promise<unknown>>(Promise.resolve());
  const [status, setStatus] = useState(""), [busy, setBusy] = useState(false);
  const [auth, setAuth] = useState<AuthMode>("auto");
  const ru = language === "ru";
  useEffect(() => {
    const term = new Terminal({ cursorBlink: true, scrollback: 2000, fontSize: 13, theme: { background: "#11151b", foreground: "#e2e8f0" } });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(container.current!); terminal.current = term;
    const input = term.onData(data => {
      const id = session.current;
      if (id) pending.current = pending.current.then(() => invoke("ssh_write", { id, data })).catch(() => { setStatus("SSH input failed"); });
    });
    const observer = new ResizeObserver(() => {
      if (!container.current?.clientWidth || !container.current.clientHeight) return;
      fit.fit();
      if (session.current) void invoke("ssh_resize", { id: session.current, cols: term.cols, rows: term.rows }).catch(() => {});
    });
    observer.observe(container.current!);
    return () => {
      const id = session.current; session.current = null;
      // Also close after an in-flight connect finishes: cancellation cannot orphan a process.
      if (id) void invoke("ssh_disconnect", { id });
      observer.disconnect(); input.dispose(); term.dispose(); terminal.current = null;
    };
  }, []);
  async function stop() {
    const id = session.current; session.current = null;
    setBusy(false); setStatus(ru ? "Отключено" : "Disconnected");
    if (id) await invoke("ssh_disconnect", { id }).catch(e => setStatus(String(e)));
  }
  async function connect() {
    if (!isTauri()) { setStatus(ru ? "SSH доступен в приложении Tauri" : "SSH requires the Tauri desktop app"); return; }
    const term = terminal.current!;
    const id = crypto.randomUUID(); session.current = id;
    setBusy(true); setStatus(kind === "sftp"
      ? (ru ? "SFTP запущен; ожидайте приглашение sftp>" : "SFTP started; waiting for sftp> prompt")
      : (ru ? "SSH запущен; ожидайте приглашение сервера" : "SSH started; waiting for server prompt")); term.reset(); term.focus();
    const events = new Channel<Event>();
    events.onmessage = event => {
      if (session.current !== id) return;
      if (event.kind === "data") term.write(new Uint8Array(event.value));
      else {
        session.current = null; setBusy(false);
        setStatus(event.kind === "exit" ? `${ru ? "Сессия завершена, код" : "Session exited, code"} ${event.value}` : event.value);
        void invoke("ssh_disconnect", { id });
      }
    };
    try {
      await invoke("ssh_connect", { id, host: c.host, port: c.port, username: c.username, auth, kind, cols: Math.min(500, Math.max(2, term.cols)), rows: Math.min(300, Math.max(2, term.rows)), events });
      if (session.current !== id) await invoke("ssh_disconnect", { id });
    } catch (e) { if (session.current === id) { session.current = null; setBusy(false); setStatus(String(e)); } }
  }
  return <section className="ssh-pane" aria-label={c.name}>
    <div className="ssh-toolbar"><strong>{kind === "sftp" ? "SFTP" : "SSH"} · {c.name}</strong><span>{c.username}@{c.host}:{c.port}</span>
      <label className="ssh-auth">
        <span>{ru ? "Вход" : "Authentication"}</span>
        <select aria-label={ru ? "Способ SSH-авторизации" : "SSH authentication method"} disabled={busy} value={auth} onChange={e => setAuth(e.target.value as AuthMode)}>
          <option value="auto">{ru ? "Авто" : "Auto"}</option>
          <option value="key">{ru ? "SSH-ключ / агент" : "SSH key / agent"}</option>
          <option value="password">{ru ? "Пароль / PAM" : "Password / PAM"}</option>
        </select>
      </label>
      <button disabled={busy} onClick={() => void connect()}>{ru ? "Подключить / повторить" : "Connect / reconnect"}</button>
      <button disabled={!busy} onClick={() => void stop()}>{ru ? "Отключить / отменить" : "Disconnect / cancel"}</button>
    </div>
    <p className="ssh-help">{kind === "sftp"
      ? (ru
        ? "Настоящий OpenSSH SFTP. После входа используйте pwd, ls, cd, get, put и help. Сначала проверьте SHA256 ключа сервера; пароли не сохраняются. Локальный каталог передачи задавайте командой lcd — по умолчанию он зависит от запуска NodeDesk. Встроенный файловый браузер появится в следующем этапе."
        : "Real OpenSSH SFTP. After login use pwd, ls, cd, get, put and help. Independently verify the SHA256 host fingerprint. Passwords are not saved. Set the local transfer directory using lcd; otherwise it depends on how NodeDesk was started. The graphical file browser is a later step.")
      : (ru
        ? "SSH-ключи, агент или пароль/PAM. Сначала сверьте SHA256 нового ключа сервера по доверенному каналу. Пароль и passphrase вводятся скрыто прямо в терминале и не сохраняются."
        : "SSH keys, agent or password/PAM. Independently verify a new host SHA256 fingerprint. Passwords and passphrases are entered directly at the hidden terminal prompt and are never saved.")}</p>
    <div className="ssh-screen" ref={container}/><div role="status">{status || (ru ? "Не подключено" : "Disconnected")}</div>
  </section>;
}

export function SshWorkspace({ connection, language }: { connection: Connection; language: "ru" | "en" }) {
  const [active, setActive] = useState<TerminalKind>("ssh");
  return <section className="ssh-tools-workspace">
    <div className="ssh-tool-switcher" role="tablist" aria-label={language === "ru" ? "Инструменты подключения" : "Connection tools"}>
      {(["ssh", "sftp"] as const).map(kind => <button key={kind} type="button" role="tab" aria-selected={active === kind}
        onClick={() => setActive(kind)}>{kind.toUpperCase()}</button>)}
    </div>
    <div role="tabpanel" className="ssh-tool-panel" hidden={active !== "ssh"}>
      <SshTerminal connection={connection} language={language} kind="ssh" />
    </div>
    <div role="tabpanel" className="ssh-tool-panel" hidden={active !== "sftp"}>
      <SshTerminal connection={connection} language={language} kind="sftp" />
    </div>
  </section>;
}
