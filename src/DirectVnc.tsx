import {useEffect,useRef,useState,type MouseEvent} from "react";
import {Channel,invoke,isTauri} from "@tauri-apps/api/core";
import type {Connection} from "./catalog";
import {vncKeysym} from "./vncKeysym";

type NativeEvent={type:"status";phase:string}|{type:"error";message:string}|
  {type:"resize";width:number;height:number}|
  {type:"frame";x:number;y:number;width:number;height:number;png:string}|
  {type:"clipboard";text:string};
type Phase="idle"|"connecting"|"connected"|"reconnecting";

/** Native VNC session. The SPKI fingerprint must come from a trusted source. */
export function DirectVnc({connection,language}:{connection:Connection;language:"ru"|"en"}){
  const ru=language==="ru";
  const [phase,setPhase]=useState<Phase>("idle");
  const [error,setError]=useState("");
  const [viewOnly,setViewOnly]=useState(false);
  const [clipboard,setClipboard]=useState(false);
  const [saved,setSaved]=useState(false);
  const password=useRef<HTMLInputElement>(null);
  const pin=useRef<HTMLInputElement>(null);
  const canvas=useRef<HTMLCanvasElement>(null);
  const surface=useRef<HTMLDivElement>(null);
  const remoteClipboard=useRef("");
  const generation=useRef(0);
  const started=useRef(false);
  const connected=useRef(false);
  const buttons=useRef(0);
  const id=connection.id;

  function send(input:Record<string,unknown>){
    if(!connected.current)return;
    void invoke("vnc_direct_input",{id,input}).catch(()=>{});
  }
  function close(){
    generation.current++;connected.current=false;setPhase("idle");
    remoteClipboard.current="";buttons.current=0;
    if(password.current)password.current.value="";
    if(started.current&&isTauri())void invoke("vnc_direct_disconnect",{id}).catch(()=>{});
    started.current=false;
  }
  useEffect(()=>()=>{generation.current++;connected.current=false;
    if(started.current&&isTauri())void invoke("vnc_direct_disconnect",{id}).catch(()=>{});
    started.current=false;remoteClipboard.current="";},[id]);
  useEffect(()=>{
    if(phase!=="connected"||!surface.current)return;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const observer=new ResizeObserver(()=>{
      clearTimeout(timer);
      timer=setTimeout(()=>{
        if(!surface.current||!connected.current)return;
        const width=Math.max(320,Math.min(4096,Math.round(surface.current.clientWidth)));
        const height=Math.max(240,Math.min(2160,Math.round(surface.current.clientHeight)));
        send({type:"resize",width,height});
      },300);
    });
    observer.observe(surface.current);
    return ()=>{observer.disconnect();clearTimeout(timer);};
  },[phase,id]);

  async function draw(event:Extract<NativeEvent,{type:"frame"}>,token:number){
    if(event.width<1||event.height<1||event.png.length>24*1024*1024)return;
    try{
      const bytes=Uint8Array.from(atob(event.png),char=>char.charCodeAt(0));
      const bitmap=await createImageBitmap(new Blob([bytes],{type:"image/png"}));
      if(token===generation.current&&canvas.current)
        canvas.current.getContext("2d",{alpha:false})?.drawImage(bitmap,event.x,event.y);
      bitmap.close();
    }catch{if(token===generation.current)setError(ru?"Ошибка кадра VNC.":"VNC frame decode failed.");}
  }
  async function open(){
    if(phase!=="idle"||!isTauri())return;
    const secret=password.current?.value??"";
    if(password.current)password.current.value="";
    const fingerprint=(pin.current?.value??"").replaceAll(":","").trim();
    if((!secret&&!saved)||!/^[a-fA-F0-9]{64}$/.test(fingerprint)){
      setError(ru?"Введите пароль (или выберите Vault) и проверенный SHA256 SPKI отпечаток сервера.":
        "Enter a password (or select Vault) and a verified SHA256 SPKI server fingerprint.");return;
    }
    setError("");setPhase("connecting");started.current=true;connected.current=false;
    const token=++generation.current;
    const events=new Channel<NativeEvent>();
    events.onmessage=event=>{
      if(token!==generation.current)return;
      if(event.type==="frame")void draw(event,token);
      else if(event.type==="resize"){
        if(canvas.current){canvas.current.width=event.width;canvas.current.height=event.height;}
      }else if(event.type==="clipboard"){
        if(clipboard&&event.text.length<=65536)remoteClipboard.current=event.text;
      }else if(event.type==="error"){
        setError(ru?"VNC-соединение, сертификат или авторизация не прошли.":event.message);
        close();
      }else if(event.phase==="connected"){
        connected.current=true;setPhase("connected");
      }else if(event.phase==="reconnecting"){
        connected.current=false;setPhase("reconnecting");
      }else if(event.phase==="closed")close();
    };
    try{
      await invoke(saved?"vnc_direct_connect_saved":"vnc_direct_connect",{
        target:{id,host:connection.host,port:connection.port,username:connection.username},
        ...(saved?{}:{password:secret}),spkiSha256:fingerprint,clipboard,events});
    }catch{
      if(token===generation.current){close();setError(ru?"Не удалось открыть прямой VNC-сеанс.":
        "Could not start direct VNC session.");}
    }
  }
  function pointer(event:MouseEvent<HTMLCanvasElement>,mask:number){
    if(viewOnly||!canvas.current)return;
    const box=canvas.current.getBoundingClientRect();
    if(!box.width||!box.height)return;
    const x=Math.min(canvas.current.width-1,Math.max(0,Math.floor(
      (event.clientX-box.left)*canvas.current.width/box.width)));
    const y=Math.min(canvas.current.height-1,Math.max(0,Math.floor(
      (event.clientY-box.top)*canvas.current.height/box.height)));
    send({type:"pointer",x,y,buttonMask:mask});
  }
  return <section className="rdp-embedded" aria-label={ru?"Прямой VNC":"Direct VNC"}>
    <h3>{ru?"Прямой VNC (VeNCrypt X509)":"Direct VNC (VeNCrypt X509)"}</h3>
    <p className="ssh-help">{ru?"Требуется SHA256 отпечаток открытого ключа TLS-сертификата сервера (SPKI), полученный из доверенного источника. Проверка выполняется до передачи пароля. Не используйте отпечаток, полученный из этого же неподтверждённого соединения.":
      "Enter the server TLS certificate public-key SHA256 fingerprint (SPKI) from a trusted source. Identity is checked before the password is sent. Do not copy a fingerprint from this unverified connection."}</p>
    <label>{ru?"Проверенный SHA256 SPKI отпечаток":"Verified SHA256 SPKI fingerprint"}
      <input ref={pin} type="text" autoComplete="off" spellCheck={false} disabled={phase!=="idle"}/></label>
    {!saved&&<label>{ru?"Пароль VNC для этого сеанса":"VNC password for this session"}
      <input ref={password} type="password" autoComplete="off" disabled={phase!=="idle"}/></label>}
    <label className="check"><input type="checkbox" checked={saved} disabled={phase!=="idle"}
      onChange={e=>{if(password.current)password.current.value="";setSaved(e.target.checked);}}/>
      {ru?"Использовать пароль из разблокированного системного Vault":"Use password from unlocked OS vault"}</label>
    <div className="rdp-embedded-controls">
      <button type="button" onClick={()=>void open()} disabled={phase!=="idle"}>{ru?"Подключить напрямую":"Connect directly"}</button>
      <button type="button" onClick={close} disabled={phase==="idle"}>{ru?"Отключить":"Disconnect"}</button>
      <label className="check"><input type="checkbox" checked={clipboard} disabled={phase!=="idle"}
        onChange={e=>{remoteClipboard.current="";setClipboard(e.target.checked);}}/>
        {ru?"Разрешить текстовый clipboard":"Enable text clipboard"}</label>
      <label className="check"><input type="checkbox" checked={viewOnly}
        onChange={e=>{if(e.target.checked)send({type:"releaseKeys"});setViewOnly(e.target.checked);}}/>
        {ru?"Только просмотр":"View only"}</label>
      <button type="button" disabled={phase!=="connected"} onClick={()=>void surface.current?.requestFullscreen()}>
        {ru?"Во весь экран":"Fullscreen"}</button>
      {clipboard&&<>
        <button type="button" disabled={phase!=="connected"} onClick={()=>void navigator.clipboard.readText()
          .then(text=>send({type:"clipboard",text})).catch(()=>{})}>{ru?"Отправить текст clipboard":"Send clipboard text"}</button>
        <button type="button" disabled={phase!=="connected"} onClick={()=>void navigator.clipboard.writeText(remoteClipboard.current)
          .catch(()=>{})}>{ru?"Скопировать текст сервера":"Copy remote text"}</button>
      </>}
    </div>
    {error&&<p role="alert" className="error">{error}</p>}
    {phase!=="idle"&&<p role="status">{phase==="connected"?(ru?"Подключено":"Connected"):
      phase==="reconnecting"?(ru?"Восстановление…":"Reconnecting…"):(ru?"Подключение…":"Connecting…")}</p>}
    <div className="rdp-embedded-surface" ref={surface}>
      <canvas ref={canvas} tabIndex={0} aria-label={ru?"Прямой экран VNC":"Direct VNC screen"}
        style={{maxWidth:"100%",height:"auto"}} onContextMenu={e=>e.preventDefault()}
        onKeyDown={e=>{const code=vncKeysym(e.key);if(code&&connected.current&&!viewOnly){e.preventDefault();send({type:"key",keysym:code,down:true});}}}
        onKeyUp={e=>{const code=vncKeysym(e.key);if(code&&connected.current&&!viewOnly){e.preventDefault();send({type:"key",keysym:code,down:false});}}}
        onBlur={()=>send({type:"releaseKeys"})}
        onMouseMove={e=>pointer(e,buttons.current)}
        onMouseDown={e=>{if(e.button>2)return;e.currentTarget.focus();buttons.current|=1<<e.button;pointer(e,buttons.current);}}
        onMouseUp={e=>{if(e.button>2)return;buttons.current&=~(1<<e.button);pointer(e,buttons.current);}}/>
    </div>
  </section>;
}
