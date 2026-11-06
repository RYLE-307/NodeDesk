import { useEffect, useRef, useState } from "react";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { Connection } from "./catalog";

type Event = { kind: "data"; value: number[] } | { kind: "exit"; value: number } | { kind: "error"; value: string };
export function SshTerminal({ connection: c, language }: { connection: Connection; language: "ru" | "en" }) {
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const session = useRef<string | null>(null);
  const pending = useRef<Promise<unknown>>(Promise.resolve());
  const [status, setStatus] = useState(""), [busy, setBusy] = useState(false);
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
    setBusy(true); setStatus(ru ? "SSH запущен; ожидайте приглашение сервера" : "SSH started; waiting for server prompt"); term.reset(); term.focus();
    const events = new Channel<Event>();
    events.onmessage = event => {
      if (session.current !== id) return;
      if (event.kind === "data") term.write(new Uint8Array(event.value));
      else {
        session.current = null; setBusy(false);
        setStatus(event.kind === "exit" ? `${ru ? "SSH завершён, код" : "SSH exited, code"} ${event.value}` : event.value);
        void invoke("ssh_disconnect", { id });
      }
    };
    try {
      await invoke("ssh_connect", { id, host: c.host, port: c.port, username: c.username, cols: Math.min(500, Math.max(2, term.cols)), rows: Math.min(300, Math.max(2, term.rows)), events });
      if (session.current !== id) await invoke("ssh_disconnect", { id });
    } catch (e) { if (session.current === id) { session.current = null; setBusy(false); setStatus(String(e)); } }
  }
  return <section className="ssh-pane" aria-label={c.name}>
    <div className="ssh-toolbar"><strong>{c.name}</strong><span>{c.username}@{c.host}:{c.port}</span>
      <button disabled={busy} onClick={() => void connect()}>{ru ? "Подключить / повторить" : "Connect / reconnect"}</button>
      <button disabled={!busy} onClick={() => void stop()}>{ru ? "Отключить / отменить" : "Disconnect / cancel"}</button>
    </div>
    <p className="ssh-help">{ru ? "Только SSH-ключи / agent. Новый ключ: сверьте SHA256 с администратором и подтвердите в терминале. Изменившийся ключ блокируется. Passphrase вводится в терминале без сохранения." : "SSH keys / agent only. For a new host verify SHA256 with your administrator, then confirm in the terminal. Changed keys are blocked. Enter key passphrases in the terminal; they are never saved."}</p>
    <div className="ssh-screen" ref={container}/><div role="status">{status || (ru ? "Не подключено" : "Disconnected")}</div>
  </section>;
}
