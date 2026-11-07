import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Connection } from "./catalog";

type LaunchInfo = {client:string;externalWindow:boolean};

/**
 * v0.6 first slice: user-triggered external RDP client window.
 * No login fields or secrets in the catalog/JavaScript/argv.
 * This is deliberately not an embedded RDP renderer.
 */
export function RdpWorkspace({ connection, language }: {connection:Connection;language:"ru"|"en"}) {
  const ru=language==="ru";
  const [launching,setLaunching]=useState(false);
  const [error,setError]=useState("");
  const [status,setStatus]=useState("");
  useEffect(() => {
    setError("");setStatus("");
  },[connection.host,connection.port,connection.username]);
  async function launch() {
    if (launching) return;
    setError("");setStatus("");
    if (!isTauri()) {
      setError(ru ? "RDP доступен только в приложении NodeDesk для компьютера." : "RDP requires the NodeDesk desktop application.");
      return;
    }
    setLaunching(true);
    try {
      const result=await invoke<LaunchInfo>("rdp_launch",{target:{
        host:connection.host,port:connection.port,username:connection.username
      }});
      setStatus(ru
        ? `Запущен внешний RDP-клиент: ${result.client}. Вход и проверка сертификата выполняются в его окне.`
        : `External RDP client launched: ${result.client}. Sign in and verify the certificate in its window.`);
    } catch (cause) {
      setError(String(cause));
    } finally {setLaunching(false);}
  }
  return <section className="rdp-workspace" aria-label={ru ? "Удалённый рабочий стол RDP" : "RDP remote desktop"}>
    <h2>{connection.name}</h2>
    <p>{ru ? "Адрес" : "Host"}: <strong>{connection.host}:{connection.port}</strong></p>
    {connection.username && <p>{ru ? "Пользователь" : "Username"}: {connection.username}</p>}
    <button type="button" disabled={launching} onClick={() => void launch()}>
      {launching ? (ru ? "Запуск…" : "Launching…") : (ru ? "Открыть RDP" : "Open RDP")}
    </button>
    {error && <p role="alert" className="error">{error}</p>}
    {status && <p role="status">{status}</p>}
    <p className="ssh-help">{ru
      ? "v0.6: подключение открывается в отдельном окне системного RDP-клиента. Пароль вводится только там и не сохраняется в NodeDesk. Проверьте сертификат сервера перед входом. Закройте окно клиента для отключения; закрытие вкладки NodeDesk его не завершает."
      : "v0.6: opens a separate native RDP client window. Enter your password there; NodeDesk never saves it. Verify the server certificate before signing in. Close the client window to disconnect; closing this NodeDesk tab does not terminate it."}
    </p>
    <p className="ssh-help">{ru
      ? "Linux: нужен пакет freerdp (sdl-freerdp3). Windows: используется mstsc.exe. Экран пока не встроен в вкладку."
      : "Linux: install freerdp (sdl-freerdp3). Windows: uses mstsc.exe. The remote desktop is not embedded in this tab yet."}
    </p>
  </section>;
}
