import {useEffect,useRef,useState} from "react";
import {Channel,invoke,isTauri} from "@tauri-apps/api/core";
import type {Connection} from "./catalog";

type Event={kind:"exit"|"error";value:number|string};
export function TunnelWorkspace({connection,language}:{connection:Connection;language:"ru"|"en"}){
  const ru=language==="ru";
  const [kind,setKind]=useState<"local"|"dynamic">("local");
  const [localPort,setLocalPort]=useState("15432"),[targetHost,setTargetHost]=useState("127.0.0.1"),[targetPort,setTargetPort]=useState("5432");
  const [running,setRunning]=useState(false),[status,setStatus]=useState("");
  const idRef=useRef<string|null>(null);
  useEffect(()=>()=>{const id=idRef.current;idRef.current=null;if(id)void invoke("tunnel_stop",{id}).catch(()=>{});},[]);
  async function start(){
    if(!isTauri()){setStatus(ru?"Туннель доступен в настольном приложении":"Tunnel requires the desktop app");return;}
    if(idRef.current)return;
    const id=crypto.randomUUID();idRef.current=id;setRunning(true);setStatus(ru?"Запуск туннеля":"Starting tunnel");
    const events=new Channel<Event>();
    events.onmessage=event=>{
      if(idRef.current!==id)return;
      idRef.current=null;setRunning(false);
      setStatus(event.kind==="exit"?`${ru?"SSH завершился, код":"SSH exited, code"} ${event.value}`:String(event.value));
    };
    try{
      await invoke("tunnel_start",{id,spec:{sshHost:connection.host,sshPort:connection.port,username:connection.username,
        localPort:Number(localPort),kind,targetHost:kind==="local"?targetHost:"",
        targetPort:kind==="local"?Number(targetPort):0},events});
      if(idRef.current===id)setStatus(ru?"Туннель запущен. Проверьте доступ через локальный порт.":"Tunnel started. Check access through the local port.");
      else await invoke("tunnel_stop",{id}).catch(()=>{});
    }catch(error){if(idRef.current===id){idRef.current=null;setRunning(false);setStatus(String(error));}}
  }
  async function stop(){const id=idRef.current;idRef.current=null;setRunning(false);setStatus(ru?"Туннель остановлен":"Tunnel stopped");if(id)await invoke("tunnel_stop",{id}).catch(error=>setStatus(String(error)));}
  return <section className="tunnel-workspace" aria-label={ru?"Локальный SSH-туннель":"Local SSH tunnel"}>
    <h3>{ru?"Локальный SSH-туннель":"Local SSH tunnel"}</h3>
    <p>{ru?"Только 127.0.0.1, вход по SSH-ключу или агенту и уже доверенный ключ сервера. Подключение начинается только по нажатию. Закрытие вкладки останавливает туннель.":
      "Loopback 127.0.0.1 only, SSH key or agent authentication and an already trusted server key. Starts only on click. Closing the tab stops the tunnel."}</p>
    <label>{ru?"Режим туннеля":"Tunnel mode"}<select value={kind} disabled={running}
      onChange={event=>setKind(event.target.value as "local"|"dynamic")}>
      <option value="local">{ru?"Локальный порт → один адрес":"Local port → one target"}</option>
      <option value="dynamic">{ru?"Динамический SOCKS5":"Dynamic SOCKS5"}</option>
    </select></label>
    {kind==="dynamic"&&<p className="ssh-help">{ru?
      "Локальные программы смогут направлять через SSH-хост запросы SOCKS5 к адресам, которые они выберут. Запускайте только для доверенных локальных программ и остановите после работы.":
      "Local programs can use this SOCKS5 port to reach destinations they choose through the SSH host. Use it only with trusted local programs and stop it when done."}</p>}
    <div className="tunnel-fields">
      <label>{ru?"Локальный порт":"Local port"}<input type="number" min="1024" max="65535" value={localPort} disabled={running} onChange={event=>setLocalPort(event.target.value)}/></label>
      {kind==="local"&&<><label>{ru?"Адрес назначения":"Target host"}<input value={targetHost} disabled={running} onChange={event=>setTargetHost(event.target.value)}/></label>
      <label>{ru?"Порт назначения":"Target port"}<input type="number" min="1" max="65535" value={targetPort} disabled={running} onChange={event=>setTargetPort(event.target.value)}/></label></>}
    </div>
    <div className="actions"><button disabled={running} onClick={()=>void start()}>{ru?"Запустить туннель":"Start tunnel"}</button>
      <button disabled={!running} onClick={()=>void stop()}>{ru?"Остановить":"Stop tunnel"}</button></div>
    <p role="status">{status|| (ru?"Туннель выключен":"Tunnel stopped")}</p>
  </section>;
}
