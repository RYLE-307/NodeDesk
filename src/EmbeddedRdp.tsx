import {useEffect,useRef,useState} from "react";
import Guacamole from "@pelotech/guacamole-common-js";
import {isTauri} from "@tauri-apps/api/core";
import {
  guacBase, guacLogin, guacConnections, guacLogout, guacTunnelQuery,
  guacWssTunnel,
  type GuacAuth, type GuacConnection,
} from "./guacamoleAuth";

type Phase="idle"|"signing-in"|"ready"|"connecting"|"connected";

/**
 * Guacamole 1.6 user-session mode. The actual remote desktop renders inside
 * NodeDesk via the standard Guacamole WebSocket protocol. The gateway owns
 * RDP host trust, authorization and NLA; NodeDesk never stores credentials.
 */
export function EmbeddedRdp({language}:{language:"ru"|"en"}){
  const ru=language==="ru";
  const [server,setServer]=useState("");
  const [username,setUsername]=useState("");
  const [profiles,setProfiles]=useState<GuacConnection[]>([]);
  const [selected,setSelected]=useState("");
  const [phase,setPhase]=useState<Phase>("idle");
  const [viewOnly,setViewOnly]=useState(false);
  const [acknowledged,setAcknowledged]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const surface=useRef<HTMLDivElement>(null);
  const password=useRef<HTMLInputElement>(null);
  const session=useRef<Guacamole.Client|null>(null);
  const keyboard=useRef<Guacamole.Keyboard|null>(null);
  const mouse=useRef<Guacamole.Mouse|null>(null);
  const auth=useRef<GuacAuth|null>(null);
  const authenticatedBase=useRef("");
  const request=useRef<AbortController|null>(null);
  const phaseRef=useRef<Phase>("idle");
  const viewOnlyRef=useRef(false);

  function setCurrentPhase(p:Phase){phaseRef.current=p;setPhase(p);}
  function releaseClient(){
    const active=session.current;
    session.current=null;
    if(keyboard.current){
      keyboard.current.reset();
      keyboard.current.onkeydown=null;
      keyboard.current.onkeyup=null;
      keyboard.current=null;
    }
    mouse.current?.reset();
    mouse.current=null;
    try{active?.disconnect();}catch{/* idempotent teardown */}
    if(surface.current)surface.current.replaceChildren();
  }
  function disconnect(){
    releaseClient();
    setCurrentPhase(auth.current?"ready":"idle");
    setMessage(ru?"RDP-сеанс отключён.":"RDP session disconnected.");
  }
  async function signOut(){
    const active=auth.current, base=authenticatedBase.current;
    request.current?.abort();
    request.current=null;
    releaseClient();
    auth.current=null;authenticatedBase.current="";
    setProfiles([]);setSelected("");setCurrentPhase("idle");
    setError("");setMessage("");
    if(password.current)password.current.value="";
    if(active&&base)await guacLogout(base,active);
  }
  useEffect(()=>()=>{
    request.current?.abort();
    request.current=null;
    releaseClient();
    const active=auth.current,base=authenticatedBase.current;
    auth.current=null;authenticatedBase.current="";
    if(active&&base)void guacLogout(base,active);
  },[]);

  async function signIn(){
    if(phaseRef.current!=="idle"||!acknowledged)return;
    setError("");setMessage("");
    if(!isTauri()){
      setError(ru?"Встроенный RDP доступен только в приложении NodeDesk.":
        "Embedded RDP requires the NodeDesk desktop application.");
      return;
    }
    let base:string;
    try{base=guacBase(server);}catch(e){setError(String(e));return;}
    const secret=password.current?.value||"";
    if(password.current)password.current.value="";
    setCurrentPhase("signing-in");
    const ctl=new AbortController();
    request.current=ctl;
    let signed:GuacAuth|null=null;
    try{
      signed=await guacLogin(base,username,secret,ctl.signal);
      const available=await guacConnections(base,signed,ctl.signal);
      if(request.current!==ctl){
        await guacLogout(base,signed);
        return;
      }
      auth.current=signed;authenticatedBase.current=base;
      setProfiles(available);
      setSelected(available.length?available[0].source+":"+available[0].id:"");
      setCurrentPhase("ready");
      setMessage(available.length?(ru?
        "Guacamole авторизован. Выберите разрешённый RDP-хост и подключитесь.":
        "Guacamole signed in. Select an authorized RDP connection."):(ru?
        "Авторизация успешна, но доступных RDP-подключений нет.":
        "Signed in, but no authorized RDP connections are available."));
    }catch{
      if(signed)await guacLogout(base,signed);
      if(request.current===ctl){
        setCurrentPhase("idle");
        setError(ru?"Ошибка авторизации или запроса Guacamole. Проверьте HTTPS, учётные данные и CORS шлюза.":
          "Guacamole authentication or discovery failed. Check HTTPS, credentials and gateway CORS.");
      }
    }finally{if(request.current===ctl)request.current=null;}
  }

  function connect(){
    if(phaseRef.current!=="ready"||!auth.current||!surface.current)return;
    const profile=profiles.find(p=>p.source+":"+p.id===selected);
    if(!profile){setError(ru?"Выберите доступный RDP-хост.":"Select an authorized RDP host.");return;}
    setError("");setMessage("");
    let url:string, query:string;
    try {
      url=guacWssTunnel(authenticatedBase.current);
      const width=Math.max(320,Math.min(7680,Math.round(surface.current.clientWidth||1280)));
      const height=Math.max(240,Math.min(4320,Math.round(surface.current.clientHeight||720)));
      query=guacTunnelQuery(auth.current.authToken,profile,width,height);
    }catch{
      setError(ru?"Неверные параметры RDP-соединения.":"Invalid RDP connection parameters.");
      return;
    }
    setCurrentPhase("connecting");
    try{
      // The official Guacamole 1.6 protocol requires a temporary auth token
      // in its WSS tunnel query. Never display, log or persist that URL.
      // Gateway access logs MUST redact query strings; the user opts in.
      const tunnel=new Guacamole.WebSocketTunnel(url);
      const client=new Guacamole.Client(tunnel);
      const display=client.getDisplay().getElement();
      session.current=client;
      surface.current.replaceChildren(display);
      display.tabIndex=0;
      display.addEventListener("mousedown",()=>display.focus());
      client.onstatechange=(state)=>{
        if(session.current!==client)return;
        if(state===3){
          setCurrentPhase("connected");
          setMessage(ru?"Guacamole-поток подключён.":"Guacamole stream connected.");
        }else if(state===5)disconnect();
      };
      client.onerror=()=>{
        if(session.current!==client)return;
        releaseClient();
        setCurrentPhase("ready");
        setError(ru?"Шлюз отклонил или завершил RDP-сеанс.":
          "Guacamole gateway rejected or closed the RDP session.");
      };
      const m=new Guacamole.Mouse(display);
      mouse.current=m;
      m.onEach(["mousedown","mouseup","mousemove"],(event)=>{
        if(session.current===client&&!viewOnlyRef.current)
          client.sendMouseState((event as Guacamole.Mouse.Event).state);
      });
      const k=new Guacamole.Keyboard(display);
      keyboard.current=k;
      k.onkeydown=(keysym)=>{
        if(session.current!==client||viewOnlyRef.current)return false;
        client.sendKeyEvent(1,keysym);
        return false;
      };
      k.onkeyup=(keysym)=>{
        if(session.current!==client||viewOnlyRef.current)return;
        client.sendKeyEvent(0,keysym);
      };
      client.connect(query);
    }catch{
      releaseClient();setCurrentPhase("ready");
      setError(ru?"Не удалось открыть Guacamole WSS-туннель.":
        "Could not open Guacamole WSS tunnel.");
    }
  }
  function updateViewOnly(value:boolean){
    if(value){
      keyboard.current?.reset();
      mouse.current?.reset();
    }
    viewOnlyRef.current=value;
    setViewOnly(value);
  }

  return <section className="rdp-embedded" aria-label={ru?"Встроенный RDP":"Embedded RDP"}>
    <h3>{ru?"Встроенный RDP через Guacamole":"Embedded RDP through Guacamole"}</h3>
    <p className="ssh-help">{ru
      ?"Подключение к своему серверу Apache Guacamole 1.6 через HTTPS. После входа NodeDesk покажет доступные RDP-профили и откроет удалённый экран внутри вкладки. Сервер должен разрешать CORS для приложения NodeDesk."
      :"Sign in to your Apache Guacamole 1.6 server via HTTPS. NodeDesk lists authorized RDP connections and renders the desktop inside this tab. The server must allow CORS for the NodeDesk application."}</p>
    <div className="rdp-embedded-controls">
      <label>{ru?"Адрес Guacamole HTTPS":"Guacamole HTTPS URL"}
        <input type="url" aria-label={ru?"Адрес Guacamole HTTPS":"Guacamole HTTPS URL"}
          value={server} onChange={e=>setServer(e.target.value)}
          placeholder="https://guacamole.example.org/guacamole/"
          autoComplete="off" spellCheck={false} disabled={phase!=="idle"}/>
      </label>
      {phase==="idle"&&<label>{ru?"Логин Guacamole":"Guacamole username"}
        <input aria-label={ru?"Логин Guacamole":"Guacamole username"}
          value={username} onChange={e=>setUsername(e.target.value)}
          autoComplete="off" spellCheck={false}/></label>}
      {phase==="idle"&&<label>{ru?"Пароль Guacamole":"Guacamole password"}
        <input ref={password} type="password" autoComplete="off"
          aria-label={ru?"Пароль Guacamole":"Guacamole password"}/></label>}
      {phase==="idle"&&<button type="button" disabled={!acknowledged}
        onClick={()=>void signIn()}>{ru?"Войти в Guacamole":"Sign in to Guacamole"}</button>}
      {phase!=="idle"&&<button type="button" onClick={()=>void signOut()}>
        {ru?"Выйти":"Sign out"}</button>}
    </div>
    {phase==="idle"&&<label className="check">
      <input type="checkbox" checked={acknowledged}
        onChange={e=>setAcknowledged(e.target.checked)}/>
      {ru?"Понимаю: Guacamole передаёт временный токен в WSS URL. Шлюз должен удалять параметры запросов из журналов.":
        "I understand: Guacamole sends a temporary token in the WSS URL. Gateway logs must redact URL query strings."}
    </label>}
    {(phase==="ready"||phase==="connecting"||phase==="connected")&&<div className="rdp-embedded-controls">
      <label>{ru?"Разрешённый RDP-хост":"Authorized RDP connection"}
        <select aria-label={ru?"Разрешённый RDP-хост":"Authorized RDP connection"}
          value={selected} disabled={phase!=="ready"}
          onChange={e=>setSelected(e.target.value)}>
          {profiles.length===0&&<option value="">{ru?"Нет доступных RDP-профилей":"No RDP profiles"}</option>}
          {profiles.map(p=><option key={p.source+":"+p.id} value={p.source+":"+p.id}>
            {p.name} ({p.source})
          </option>)}
        </select>
      </label>
      {profiles.length>0&&<button type="button" onClick={phase==="ready"?connect:disconnect}>
        {phase==="ready"?(ru?"Подключить внутри":"Connect embedded"):(ru?"Отключить":"Disconnect")}
      </button>}
      <label className="check"><input type="checkbox" checked={viewOnly}
        onChange={e=>updateViewOnly(e.target.checked)}/>
        {ru?"Только просмотр":"View only"}
      </label>
    </div>}
    {error&&<p role="alert" className="error">{error}</p>}
    {message&&<p role="status">{message}</p>}
    <div className="rdp-embedded-surface" ref={surface} tabIndex={0}
      aria-label={ru?"Удалённый экран RDP":"RDP remote screen"}/>
    <p className="ssh-help">{ru
      ?"Пароль вводится только для текущего входа. Токен Guacamole временно хранится в памяти и передаётся по зашифрованному WSS. TLS проверяет WebView; подлинность целевого Windows-сервера и NLA контролирует шлюз. Пароль и токен не сохраняются."
      :"Credentials are used for this login only. Guacamole's token stays in memory and is sent over encrypted WSS. The WebView verifies gateway TLS; the gateway controls Windows host identity and NLA. Credentials and token are not stored."}</p>
  </section>;
}
