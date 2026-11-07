import {useEffect,useRef,useState} from "react";
import Guacamole from "@pelotech/guacamole-common-js";
import {isTauri} from "@tauri-apps/api/core";
import {guacamoleWssEndpoint} from "./guacamoleTunnel";

type Phase="idle"|"connecting"|"connected";

/**
 * The actual RDP pixels and input are rendered by the Apache Guacamole
 * protocol in this Tauri tab. The remote RDP protocol runs in an already
 * configured, independently authenticated guacd gateway (not in NodeDesk).
 */
export function EmbeddedRdp({language}:{language:"ru"|"en"}){
  const ru=language==="ru";
  const [endpoint,setEndpoint]=useState("");
  const [phase,setPhase]=useState<Phase>("idle");
  const [viewOnly,setViewOnly]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const surface=useRef<HTMLDivElement>(null);
  const session=useRef<Guacamole.Client|null>(null);
  const keyboard=useRef<Guacamole.Keyboard|null>(null);
  const mouse=useRef<Guacamole.Mouse|null>(null);
  const phaseRef=useRef<Phase>("idle");
  const viewOnlyRef=useRef(false);

  function setCurrentPhase(p:Phase){phaseRef.current=p;setPhase(p);}
  function disconnect(){
    // Null first so late callbacks from an old session cannot update a newer one.
    const active=session.current;
    session.current=null;
    if(keyboard.current){
      keyboard.current.onkeydown=null;
      keyboard.current.onkeyup=null;
      keyboard.current=null;
    }
    if(mouse.current){
      mouse.current.reset();
      mouse.current=null;
    }
    try{active?.disconnect();}catch{/* already disconnected */}
    if(surface.current)surface.current.replaceChildren();
    setCurrentPhase("idle");
  }
  useEffect(()=>()=>{disconnect();},[]);

  function connect(){
    if(phaseRef.current!=="idle")return;
    setError("");setMessage("");
    if(!isTauri()){
      setError(ru?"Встроенный RDP доступен только в приложении NodeDesk.":
        "Embedded RDP is only available in the NodeDesk desktop application.");
      return;
    }
    let url:string;
    try{url=guacamoleWssEndpoint(endpoint);}
    catch(e){setError(String(e));return;}
    if(!surface.current)return;
    setCurrentPhase("connecting");
    try{
      // This is the Guacamole protocol WebSocket tunnel, not raw RDP TCP.
      // Gateway authentication MUST already be configured; never insert RDP
      // credentials or bearer tokens into the WebSocket URL / query string.
      const tunnel=new Guacamole.WebSocketTunnel(url);
      const client=new Guacamole.Client(tunnel);
      const display=client.getDisplay().getElement();
      session.current=client;
      surface.current.replaceChildren(display);
      display.tabIndex=0;
      display.addEventListener("mousedown",()=>display.focus());
      client.onstatechange=(state)=>{
        if(session.current!==client)return;
        // Guacamole.Client.State.CONNECTED=3, DISCONNECTED=5.
        if(state===3){
          setCurrentPhase("connected");
          setMessage(ru?"RDP-поток подключён через шлюз Guacamole.":
            "RDP stream connected through Guacamole gateway.");
        }else if(state===5){
          disconnect();
          setMessage(ru?"RDP-шлюз отключён.":"RDP gateway disconnected.");
        }
      };
      client.onerror=()=>{
        if(session.current!==client)return;
        // Guacamole error descriptions can include host names and secrets.
        // Do not expose them to UI or logs.
        disconnect();
        setError(ru?"RDP-шлюз отказал в соединении или завершил сеанс.":
          "RDP gateway rejected or terminated the session.");
      };
      const m=new Guacamole.Mouse(display);
      mouse.current=m;
      m.onEach(["mousedown","mouseup","mousemove"],(event)=>{
        if(session.current===client && !viewOnlyRef.current)
          client.sendMouseState((event as Guacamole.Mouse.Event).state);
      });
      const k=new Guacamole.Keyboard(display);
      keyboard.current=k;
      k.onkeydown=(keysym)=>{
        if(session.current!==client||viewOnlyRef.current)return false;
        client.sendKeyEvent(1,keysym);
        return false; // avoid sending remote shortcuts to the host page
      };
      k.onkeyup=(keysym)=>{
        if(session.current!==client||viewOnlyRef.current)return;
        client.sendKeyEvent(0,keysym);
      };
      // No clipboard, file, audio or local device redirection is requested.
      // No WebView storage of credentials / endpoint across tab reloads.
      client.connect();
    }catch{
      disconnect();
      setError(ru?"Не удалось начать сеанс Guacamole.":
        "Could not start the Guacamole session.");
    }
  }
  function updateViewOnly(value:boolean){
    if(!value) {viewOnlyRef.current=false;setViewOnly(false);return;}
    // On entering read-only mode, synthesize key release via disconnect:
    // avoid a remote keyboard with keys held when input is disabled.
    if(session.current) {
      const current=session.current;
      const kb=keyboard.current;
      kb?.reset();
      if(session.current!==current)return;
    }
    viewOnlyRef.current=true;
    setViewOnly(true);
  }

  return <section className="rdp-embedded" aria-label={ru?"Встроенный RDP":"Embedded RDP"}>
    <h3>{ru?"Встроенный RDP через Guacamole":"Embedded RDP through Guacamole"}</h3>
    <p className="ssh-help">{ru
      ?"Требуется заранее установленный и авторизованный шлюз Apache Guacamole с защищённым WebSocket-туннелем. Не вводите IP:3389, логин, пароль или токен в URL. Настоящий RDP-сервер подключается к шлюзу, а экран отображается внутри NodeDesk."
      :"Requires a preinstalled, authenticated Apache Guacamole gateway exposing a secure WebSocket tunnel. Do not enter an IP:3389, username, password or token in the URL. Guacamole connects to the RDP server and renders its screen inside NodeDesk."}</p>
    <div className="rdp-embedded-controls">
      <label>{ru?"WSS-туннель Guacamole":"Guacamole WSS tunnel"}
        <input type="url" aria-label={ru?"WSS-туннель Guacamole":"Guacamole WSS tunnel"}
          value={endpoint} onChange={e=>setEndpoint(e.target.value)}
          placeholder="wss://guacamole.example.org/websocket-tunnel"
          autoComplete="off" spellCheck={false} disabled={phase!=="idle"}/>
      </label>
      <button type="button" onClick={phase==="idle"?connect:disconnect}>
        {phase==="idle"?(ru?"Подключить внутри":"Connect embedded"):
          (ru?"Отключить":"Disconnect")}
      </button>
      <label className="check">
        <input type="checkbox" checked={viewOnly}
          onChange={e=>updateViewOnly(e.target.checked)}/>
        {ru?"Только просмотр":"View only"}
      </label>
    </div>
    {error&&<p role="alert" className="error">{error}</p>}
    {message&&<p role="status">{message}</p>}
    <div className="rdp-embedded-surface" ref={surface} tabIndex={0}
      aria-label={ru?"Удалённый экран RDP":"RDP remote screen"}/>
    <p className="ssh-help">{ru
      ?"Проверку TLS и авторизацию выполняет сам шлюз. NodeDesk не настраивает guacd, не обходит предупреждения о сертификатах и не сохраняет URL. Состояние «Подключено» подтверждает Guacamole-поток, но не проверяет RDP-хост независимо."
      :"TLS verification and authentication belong to the gateway. NodeDesk does not configure guacd, bypass certificate warnings or persist the URL. Connected status means Guacamole stream established, not independent verification of RDP host identity."}</p>
  </section>;
}
