import {useEffect,useRef,useState,type MouseEvent} from "react";
import {Channel,invoke,isTauri} from "@tauri-apps/api/core";
import type {Connection} from "./catalog";

type NativeEvent={type:"status";phase:string}|{type:"error";message:string}|
  {type:"frame";width:number;height:number;png:string};
type Phase="idle"|"connecting"|"connected"|"reconnecting";

/** Native IronRDP session. Password and framebuffer never enter WebView storage. */
export function DirectRdp({connection,language}:{connection:Connection;language:"ru"|"en"}){
  const ru=language==="ru";
  const [phase,setPhase]=useState<Phase>("idle");
  const [error,setError]=useState("");
  const [viewOnly,setViewOnly]=useState(false);
  const [clipboard,setClipboard]=useState(false);
  const [saved,setSaved]=useState(false);
  const password=useRef<HTMLInputElement>(null);
  const surface=useRef<HTMLDivElement>(null);
  const canvas=useRef<HTMLCanvasElement>(null);
  const generation=useRef(0);
  const lastMouse=useRef(0);
  const connected=useRef(false);
  const started=useRef(false);
  const id=connection.id;

  async function draw(event:Extract<NativeEvent,{type:"frame"}>,token:number){
    if(event.width<1||event.height<1||event.width>4096||event.height>2160||
        event.png.length>16*1024*1024)return;
    try{
      const bytes=Uint8Array.from(atob(event.png),char=>char.charCodeAt(0));
      const bitmap=await createImageBitmap(new Blob([bytes],{type:"image/png"}));
      if(token===generation.current&&canvas.current){
        const element=canvas.current;
        element.width=event.width;element.height=event.height;
        element.getContext("2d",{alpha:false})?.drawImage(bitmap,0,0);
      }
      bitmap.close();
    }catch{if(token===generation.current)setError(ru?"Ошибка кадра RDP.":"RDP frame decode failed.");}
  }
  function close(){
    generation.current++;
    connected.current=false;
    setPhase("idle");
    if(password.current)password.current.value="";
    if(started.current&&isTauri())void invoke("rdp_direct_disconnect",{id}).catch(()=>{});
    started.current=false;
  }
  useEffect(()=>()=>{generation.current++;connected.current=false;
    if(started.current&&isTauri())void invoke("rdp_direct_disconnect",{id}).catch(()=>{});
    started.current=false;},[id]);
  useEffect(()=>{
    if(phase!=="connected"||!surface.current)return;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const observer=new ResizeObserver(()=>{
      clearTimeout(timer);
      timer=setTimeout(()=>{
        if(!surface.current||!connected.current)return;
        const width=Math.max(320,Math.min(1920,Math.round(surface.current.clientWidth)));
        const height=Math.max(240,Math.min(1080,Math.round(surface.current.clientHeight)));
        void invoke("rdp_direct_resize",{id,width,height}).catch(()=>{});
      },300);
    });
    observer.observe(surface.current);
    return ()=>{observer.disconnect();clearTimeout(timer);};
  },[phase,id]);
  async function open(){
    if(phase!=="idle"||!isTauri())return;
    if(connection.rdpSha256Fingerprint){
      setError(ru?"Для прямого RDP пока не поддерживается проверка сохранённого SHA256 pin. Удалите pin только после отдельной проверки сертификата.":
        "Direct RDP cannot yet enforce the saved SHA256 pin. Review the certificate before changing the profile.");
      return;
    }
    const secret=password.current?.value??"";
    if(password.current)password.current.value="";
    if(!secret&&!saved){setError(ru?"Введите пароль RDP.":"Enter the RDP password.");return;}
    setError("");setPhase("connecting");connected.current=false;
    started.current=true;
    const token=++generation.current;
    const events=new Channel<NativeEvent>();
    events.onmessage=event=>{
      if(token!==generation.current)return;
      if(event.type==="frame")void draw(event,token);
      else if(event.type==="error"){
        setError(ru?"RDP-соединение или авторизация не удались.":event.message);
        if(started.current)void invoke("rdp_direct_disconnect",{id}).catch(()=>{});
        connected.current=false;started.current=false;setPhase("idle");generation.current++;
      }else if(event.phase==="connected"){
        connected.current=true;setPhase("connected");
      }else if(event.phase==="reconnecting"){
        connected.current=false;setPhase("reconnecting");
      }else if(event.phase==="closed"){
        connected.current=false;started.current=false;setPhase("idle");generation.current++;
      }
    };
    try{
      const width=Math.max(320,Math.min(1920,Math.round(surface.current?.clientWidth||1280)));
      const height=Math.max(240,Math.min(1080,Math.round(surface.current?.clientHeight||720)));
      await invoke(saved?"rdp_direct_connect_saved":"rdp_direct_connect",{
        target:{id,host:connection.host,port:connection.port,username:connection.username},
        ...(saved?{}:{password:secret}),width,height,clipboard,events});
    }catch{
      if(token===generation.current){setPhase("idle");
        started.current=false;
        setError(ru?"Не удалось открыть прямой RDP-сеанс.":"Could not start direct RDP session.");}
    }
  }
  function input(data:Record<string,unknown>){
    if(!connected.current||viewOnly)return;
    void invoke("rdp_direct_input",{id,input:data}).catch(()=>{});
  }
  function releaseInput(){
    if(connected.current)void invoke("rdp_direct_release_input",{id}).catch(()=>{});
  }
  function pointer(event:MouseEvent<HTMLCanvasElement>,button?:number,down?:boolean){
    const element=canvas.current;if(!element)return;
    const box=element.getBoundingClientRect();
    if(!box.width||!box.height)return;
    const x=Math.min(element.width-1,Math.max(0,Math.floor((event.clientX-box.left)*element.width/box.width)));
    const y=Math.min(element.height-1,Math.max(0,Math.floor((event.clientY-box.top)*element.height/box.height)));
    input({type:"mouse",x,y,...(button===undefined?{}:{button,down})});
  }
  return <section className="rdp-embedded" aria-label={ru?"Прямой RDP":"Direct RDP"}>
    <h3>{ru?"Прямой RDP (IronRDP)":"Direct RDP (IronRDP)"}</h3>
    <p className="ssh-help">{ru?"Соединение напрямую с сохранённым хостом. Требуются доверенный TLS-сертификат с именем хоста и CredSSP. Самоподписанный или неверный сертификат отклоняется.":
      "Connect directly to the saved host. A trusted TLS certificate matching the host and CredSSP are required. Untrusted or mismatched certificates are rejected."}</p>
    <label className="check"><input type="checkbox" checked={saved} disabled={phase!=="idle"}
      onChange={e=>{if(password.current)password.current.value="";setSaved(e.target.checked);}}/>
      {ru?"Использовать секрет из разблокированного хранилища ОС":"Use credential from unlocked OS vault"}</label>
    {!saved&&<label>{ru?"Пароль RDP для этого сеанса":"RDP password for this session"}
      <input ref={password} type="password" autoComplete="off" disabled={phase!=="idle"}/></label>}
    <div className="rdp-embedded-controls">
      <button type="button" onClick={()=>void open()} disabled={phase!=="idle"}>{ru?"Подключить напрямую":"Connect directly"}</button>
      <button type="button" onClick={close} disabled={phase==="idle"}>{ru?"Отключить":"Disconnect"}</button>
      <label className="check"><input type="checkbox" checked={clipboard} disabled={phase!=="idle"}
        onChange={e=>setClipboard(e.target.checked)}/>{ru?"Синхронизировать clipboard ОС":"Sync OS clipboard"}</label>
      <label className="check"><input type="checkbox" checked={viewOnly}
        onChange={e=>{if(e.target.checked)releaseInput();setViewOnly(e.target.checked);}}/>{ru?"Только просмотр":"View only"}</label>
      <button type="button" disabled={phase!=="connected"} onClick={()=>void surface.current?.requestFullscreen()}>
        {ru?"Во весь экран":"Fullscreen"}</button>
    </div>
    {error&&<p role="alert" className="error">{error}</p>}
    {phase!=="idle"&&<p role="status">{phase==="connected"?(ru?"Подключено":"Connected"):
      phase==="reconnecting"?(ru?"Восстановление…":"Reconnecting…"):(ru?"Подключение…":"Connecting…")}</p>}
    <div className="rdp-embedded-surface" ref={surface}>
      <canvas ref={canvas} tabIndex={0} aria-label={ru?"Прямой экран RDP":"Direct RDP screen"}
        style={{maxWidth:"100%",height:"auto"}}
        onContextMenu={e=>e.preventDefault()}
        onKeyDown={e=>{if(connected.current&&!viewOnly){e.preventDefault();input({type:"key",code:e.code,down:true});}}}
        onKeyUp={e=>{if(connected.current&&!viewOnly){e.preventDefault();input({type:"key",code:e.code,down:false});}}}
        onBlur={releaseInput}
        onMouseMove={e=>{if(Date.now()-lastMouse.current>=30){lastMouse.current=Date.now();pointer(e);}}}
        onMouseDown={e=>{e.currentTarget.focus();pointer(e,e.button,true);}}
        onMouseUp={e=>pointer(e,e.button,false)}/>
    </div>
    <p className="ssh-help">{ru?"При включении clipboard удалённый компьютер может читать и изменять clipboard ОС. По умолчанию выключено. Сохранённый секрет передаётся из хранилища прямо в RDP-клиент, минуя WebView; при закрытии вкладки сеанс завершается.":
      "When OS clipboard sync is enabled, the remote computer can read and change your clipboard. It is off by default. A saved credential goes from the vault directly to the RDP client without entering the WebView; closing the tab ends the session."}</p>
  </section>;
}
