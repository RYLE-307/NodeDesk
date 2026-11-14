import {useEffect,useRef,useState} from "react";
import {isTauri} from "@tauri-apps/api/core";
import RFB from "@novnc/novnc";
import type {Connection} from "./catalog";
import {boundedRemoteClipboard} from "./remoteClipboard";
import {vncWebsocketEndpoint} from "./vncWebsocket";

type Phase = "idle"|"connecting"|"credentials"|"connected";

/**
 * Actual framebuffer + keyboard/mouse renderer in the NodeDesk WebView.
 * Requires an operator-provided, TLS-verified wss:// RFB stream endpoint.
 * This does NOT proxy raw TCP 5900 or weaken the external TigerVNC policy.
 */
export function EmbeddedVnc({connection,language}:{connection:Connection;language:"ru"|"en"}){
  const ru=language==="ru";
  const [endpoint,setEndpoint]=useState("");
  const [phase,setPhase]=useState<Phase>("idle");
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [viewOnly,setViewOnly]=useState(false);
  const [clipboardEnabled,setClipboardEnabled]=useState(false);
  const [remoteClipboardReady,setRemoteClipboardReady]=useState(false);
  const surface=useRef<HTMLDivElement>(null);
  const client=useRef<RFB|null>(null);
  const passwordInput=useRef<HTMLInputElement>(null);
  const phaseRef=useRef<Phase>("idle");
  const clipboardEnabledRef=useRef(false);
  const remoteClipboard=useRef("");

  function clearClipboard(){
    clipboardEnabledRef.current=false;setClipboardEnabled(false);
    remoteClipboard.current="";setRemoteClipboardReady(false);
  }

  const setPhaseBoth=(next:Phase)=>{phaseRef.current=next;setPhase(next);};
  function disconnect(){
    clearClipboard();
    const current=client.current;
    client.current=null;
    if(current){
      try{current.disconnect();}catch{/* already closed by peer */}
    }
    if(passwordInput.current)passwordInput.current.value="";
    setPhaseBoth("idle");
  }
  useEffect(()=>{
    setPhaseBoth("idle");
    clearClipboard();
    setError("");setMessage("");
    return ()=>{
      const current=client.current;
      client.current=null;
      remoteClipboard.current="";
      try{current?.disconnect();}catch{/* window or tab was destroyed */}
    };
  },[connection.id,connection.host,connection.port]);

  function connect(){
    if(phaseRef.current!=="idle")return;
    setError("");setMessage("");
    if(!isTauri()){
      setError(ru?"Встроенный VNC доступен только в настольном NodeDesk.":
        "Embedded VNC requires the NodeDesk desktop application.");
      return;
    }
    let url:string;
    try{url=vncWebsocketEndpoint(endpoint);}
    catch(e){setError(String(e));return;}
    if(!surface.current)return;
    setPhaseBoth("connecting");
    try{
      // WebView/browser verifies the wss certificate. We never request
      // ws://, override its TLS validation, or transmit a URL credential.
      const rfb=new RFB(surface.current,url,{shared:true});
      client.current=rfb;
      rfb.scaleViewport=true;
      rfb.clipViewport=true;
      rfb.resizeSession=false;
      rfb.viewOnly=viewOnly;
      let challenged=false;
      rfb.addEventListener("connect",()=>{
        if(client.current!==rfb)return;
        // WSS authenticates the gateway, not necessarily the RFB origin.
        // Reject servers that offered an unauthenticated RFB session.
        if(!challenged){
          setError(ru?"VNC-сервер не запросил пароль. Встроенное соединение отклонено.":
            "VNC server did not request authentication. Embedded connection refused.");
          disconnect();
          return;
        }
        setPhaseBoth("connected");
        setMessage(ru?"VNC-подключение установлено. Экран внутри NodeDesk.":
          "VNC connected. Remote framebuffer is inside NodeDesk.");
      });
      rfb.addEventListener("clipboard",(event:Event)=>{
        if(client.current!==rfb||!clipboardEnabledRef.current)return;
        try{
          remoteClipboard.current=boundedRemoteClipboard(
            (event as CustomEvent<{text:string}>).detail?.text??"");
          setRemoteClipboardReady(true);
        }catch{
          remoteClipboard.current="";setRemoteClipboardReady(false);
          setError(ru?"Удалённый буфер обмена пуст, небезопасен или слишком велик.":
            "Remote clipboard is empty, unsafe or too large.");
        }
      });
      rfb.addEventListener("credentialsrequired",()=>{
        if(client.current!==rfb)return;
        challenged=true;
        setPhaseBoth("credentials");
        setMessage(ru?"Введите пароль VNC для этого соединения.":
          "Enter the VNC password for this connection.");
      });
      rfb.addEventListener("securityfailure",()=>{
        if(client.current!==rfb)return;
        setError(ru?"Сервер отклонил согласование безопасности или авторизацию VNC.":
          "VNC server rejected authentication or security negotiation.");
        disconnect();
      });
      rfb.addEventListener("serververification",()=>{
        if(client.current!==rfb)return;
        // noVNC offers RSA fingerprint confirmation for some protocols. Do
        // not implicitly approve an identity we cannot safely present.
        setError(ru?"Сервер требует отдельной проверки ключа. Соединение отклонено.":
          "The server requires a separate identity verification. Connection refused.");
        disconnect();
      });
      rfb.addEventListener("disconnect",(e:Event)=>{
        if(client.current!==rfb)return;
        const clean=(e as CustomEvent<{clean?:boolean}>).detail?.clean;
        client.current=null;
        clearClipboard();
        setPhaseBoth("idle");
        if(passwordInput.current)passwordInput.current.value="";
        if(!clean)setError(ru?"VNC-соединение оборвалось. Проверьте сервер и WSS-сертификат.":
          "VNC connection failed. Check the server and WSS certificate.");
        else setMessage(ru?"VNC отключён.":"VNC disconnected.");
      });
    }catch(cause){
      setPhaseBoth("idle");
      const kind=cause instanceof Error?cause.name:"UnknownError";
      // Do not expose the URL, credentials or exception messages to UI/logs.
      setError((ru?"Не удалось открыть защищённый VNC WebSocket.":
        "Could not open a secure VNC WebSocket.")+" ["+kind+"]");
    }
  }
  function authenticate(){
    if(phaseRef.current!=="credentials"||!client.current)return;
    const input=passwordInput.current;
    if(!input)return;
    const password=input.value;
    input.value=""; // no localStorage, URL, catalog, shell, console or telemetry
    if(!password){
      setError(ru?"Введите пароль VNC.":"Enter the VNC password.");
      return;
    }
    setError("");
    try{
      client.current.sendCredentials({
        username:connection.username||undefined,
        password,
      });
      setPhaseBoth("connecting");
    }catch{
      setError(ru?"Не удалось передать пароль VNC.":"VNC credential submission failed.");
      disconnect();
    }
  }
  async function copyRemoteClipboard(){
    if(phaseRef.current!=="connected"||!clipboardEnabledRef.current||!remoteClipboard.current)return;
    try{
      await navigator.clipboard.writeText(boundedRemoteClipboard(remoteClipboard.current));
      setMessage(ru?"Удалённый текст скопирован по вашему запросу.":"Remote text copied on request.");
    }catch{setError(ru?"Локальный буфер обмена недоступен.":"Local clipboard unavailable.");}
  }
  async function sendLocalClipboard(){
    const rfb=client.current;
    if(phaseRef.current!=="connected"||!rfb||!clipboardEnabledRef.current||rfb.viewOnly)return;
    if(!window.confirm(ru?"Передать текст из локального буфера обмена на удалённый компьютер?":
      "Send local clipboard text to the remote desktop?"))return;
    try{
      const value=boundedRemoteClipboard(await navigator.clipboard.readText());
      if(client.current!==rfb||!clipboardEnabledRef.current||rfb.viewOnly)return;
      rfb.clipboardPasteFrom(value);
      setMessage(ru?"Локальный текст отправлен по вашему запросу.":"Local text sent on request.");
    }catch{setError(ru?"Буфер обмена недоступен или текст небезопасен/слишком велик.":
      "Clipboard unavailable or text unsafe/too large.");}
  }
  return <div className="vnc-embedded" aria-label={ru?"Встроенный просмотр VNC":"Embedded VNC viewer"}>
    <h3>{ru?"Встроенный VNC (защищённый WSS)":"Embedded VNC (secure WSS)"}</h3>
    <p className="ssh-help">{ru
      ?"Укажите адрес WSS-прокси VNC/RFB с действительным TLS-сертификатом (например, wss://vnc.example.org/websockify). Обычный TCP:5900 напрямую не подходит. Адрес и пароль не сохраняются."
      :"Enter an RFB-over-WSS proxy URL with a valid TLS certificate (e.g. wss://vnc.example.org/websockify). Raw TCP:5900 cannot connect directly. The URL and password are not saved."}</p>
    <div className="vnc-embedded-controls">
      <label>{ru?"WSS-адрес":"WSS endpoint"}
        <input aria-label={ru?"WSS-адрес":"WSS endpoint"} type="url"
          value={endpoint} onChange={e=>setEndpoint(e.target.value)}
          placeholder="wss://vnc.example.org/websockify"
          disabled={phase!=="idle"} autoComplete="off" spellCheck={false}/>
      </label>
      <button type="button" onClick={phase==="idle"?connect:disconnect}>
        {phase==="idle"?(ru?"Подключить внутри":"Connect embedded"):
          (ru?"Отключить":"Disconnect")}
      </button>
      <label className="check"><input type="checkbox" checked={viewOnly}
        onChange={e=>{setViewOnly(e.target.checked);if(client.current)client.current.viewOnly=e.target.checked;}}/>
        {ru?"Только просмотр":"View only"}
      </label>
      {phase==="connected"&&<button type="button"
        onClick={()=>client.current?.sendCtrlAltDel()}>Ctrl+Alt+Del</button>}
      {phase==="connected"&&<>
        <label className="check"><input type="checkbox" checked={clipboardEnabled}
          onChange={e=>{clipboardEnabledRef.current=e.target.checked;setClipboardEnabled(e.target.checked);
            remoteClipboard.current="";setRemoteClipboardReady(false);}}/>
          {ru?"Буфер обмена в этой сессии":"Clipboard in this session"}
        </label>
        <button type="button" disabled={!clipboardEnabled||!remoteClipboardReady}
          onClick={()=>void copyRemoteClipboard()}>{ru?"Копировать удалённый текст":"Copy remote text"}</button>
        <button type="button" disabled={!clipboardEnabled||viewOnly}
          onClick={()=>void sendLocalClipboard()}>{ru?"Отправить локальный текст":"Send local text"}</button>
      </>}
    </div>
    {phase==="credentials"&&<form className="vnc-embedded-password" onSubmit={e=>{e.preventDefault();authenticate();}}>
      <label>{ru?"Пароль VNC":"VNC password"}
        <input type="password" aria-label={ru?"Пароль VNC":"VNC password"}
          ref={passwordInput} autoComplete="off" required/>
      </label>
      <button type="submit">{ru?"Войти":"Authenticate"}</button>
    </form>}
    {error&&<p role="alert" className="error">{error}</p>}
    {message&&<p role="status">{message}</p>}
    <div className="vnc-embedded-surface" aria-label={ru?"Экран VNC":"VNC screen"} ref={surface}/>
    <p className="ssh-help">{ru
      ?"Данные экрана и ввода передаются через WSS в WebView. Проверку TLS выполняет система, но сервер должен требовать аутентификацию. Пароль временно обрабатывается noVNC в памяти. Буфер обмена выключен до включения; копирование и отправка текста требуют отдельных действий и ограничены 64 КиБ."
      :"Screen and input travel through WSS in the WebView. TLS is verified by the OS, but the server must enforce authentication. noVNC processes the password transiently in memory. Clipboard sharing is off until enabled; each text copy or send is explicit and limited to 64 KiB."}</p>
  </div>;
}
