import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Connection } from "./catalog";

type LaunchInfo = {client:string;externalWindow:boolean;security:string};

/** Deliberately external TigerVNC window; trust and credentials stay in viewer. */
export function VncWorkspace({connection,language}:{connection:Connection;language:"ru"|"en"}) {
  const ru=language==="ru";
  const [launching,setLaunching]=useState(false);
  const [error,setError]=useState("");
  const [status,setStatus]=useState("");
  useEffect(()=>{setError("");setStatus("");},[connection.host,connection.port,connection.username]);

  async function launch(){
    if(launching)return;
    setError("");setStatus("");
    if(!isTauri()){
      setError(ru ? "VNC доступен только в приложении NodeDesk для компьютера." : "VNC requires the NodeDesk desktop application.");
      return;
    }
    setLaunching(true);
    try {
      const result=await invoke<LaunchInfo>("vnc_launch",{target:{
        host:connection.host,port:connection.port
      }});
      setStatus(ru
        ? `Запущен ${result.client}. Ввод пароля и проверка X.509-сертификата выполняются в его окне; вход ещё не подтверждён.`
        : `${result.client} launched. Enter your password and verify the X.509 certificate in its window; login is not yet confirmed.`);
    }catch(cause){setError(String(cause));}
    finally{setLaunching(false);}
  }

  return <section className="rdp-workspace vnc-workspace"
    aria-label={ru?"Удалённый рабочий стол VNC":"VNC remote desktop"}>
    <h2>{connection.name}</h2>
    <p>{ru?"Адрес":"Host"}: <strong>{connection.host}:{connection.port}</strong></p>
    <button type="button" disabled={launching} onClick={()=>void launch()}>
      {launching?(ru?"Запуск…":"Launching…"):(ru?"Открыть VNC":"Open VNC")}
    </button>
    {error && <p role="alert" className="error">{error}</p>}
    {status && <p role="status">{status}</p>}
    <p className="ssh-help">{ru
      ? "v0.6: отдельное окно TigerVNC Viewer; экран пока не встроен в NodeDesk. Пароль вводите только в TigerVNC. Сервер должен поддерживать X509Vnc или X509Plain. Проверьте подлинность сертификата перед входом."
      : "v0.6: opens a separate TigerVNC Viewer window; the desktop is not embedded in NodeDesk. Enter the password only in TigerVNC. The server must support X509Vnc or X509Plain. Verify the certificate before signing in."}
    </p>
    <p className="ssh-help">{ru
      ? "Незащищённый VNCAuth и анонимный TLS не используются. Для старого VNC-сервера потребуется будущий SSH/VPN-туннель. Буфер обмена отключён. Закрытие вкладки NodeDesk не завершает внешнее VNC-подключение."
      : "Unencrypted VncAuth and anonymous TLS are disabled. Legacy VNC needs a future SSH/VPN tunnel. Clipboard sharing is disabled. Closing the NodeDesk tab does not close the external VNC session."}
    </p>
    <p className="ssh-help">{ru
      ? "Arch: пакет tigervnc. Windows: установите TigerVNC Viewer с официального сайта. Имя пользователя из каталога пока не передаётся программе просмотра."
      : "Arch: install tigervnc. Windows: install the official TigerVNC Viewer. The catalog username is not passed to the viewer in this slice."}
    </p>
  </section>;
}
