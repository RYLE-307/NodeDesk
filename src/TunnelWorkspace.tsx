import {useEffect,useRef,useState} from "react";
import {Channel,invoke,isTauri} from "@tauri-apps/api/core";
import type {Connection} from "./catalog";

type Event={kind:"exit"|"error";value:number|string};
export function TunnelWorkspace({connection,language}:{connection:Connection;language:"ru"|"en"}){
  const ru=language==="ru";
  const [kind,setKind]=useState<"local"|"dynamic"|"remote">("local");
  const [localPort,setLocalPort]=useState("15432"),[remotePort,setRemotePort]=useState("15432"),[targetHost,setTargetHost]=useState("127.0.0.1"),[targetPort,setTargetPort]=useState("5432");
  const [running,setRunning]=useState(false),[status,setStatus]=useState("");
  const idRef=useRef<string|null>(null);
  useEffect(()=>()=>{const id=idRef.current;idRef.current=null;if(id)void invoke("tunnel_stop",{id}).catch(()=>{});},[]);
  async function start(){
    if(!isTauri()){setStatus(ru?"Туннель доступен в настольном приложении":"Tunnel requires the desktop app");return;}
    if(idRef.current)return;
    if(kind==="remote" && !window.confirm(ru
      ?"Открыть обратный туннель SSH? Удалённый сервер может изменить адрес прослушивания через GatewayPorts. После запуска обязательно проверьте доступность порта на удалённом сервере."
      :"Start remote SSH forwarding? The SSH server may override the bind address via GatewayPorts. Verify remote port exposure immediately after connecting."))return;
    const id=crypto.randomUUID();idRef.current=id;setRunning(true);setStatus(ru?"Запуск туннеля":"Starting tunnel");
    const events=new Channel<Event>();
    events.onmessage=event=>{
      if(idRef.current!==id)return;
      idRef.current=null;setRunning(false);
      setStatus(event.kind==="exit"?`${ru?"SSH завершился, код":"SSH exited, code"} ${event.value}`:String(event.value));
    };
    try{
      await invoke("tunnel_start",{id,spec:{sshHost:connection.host,sshPort:connection.port,username:connection.username,
        localPort:kind==="remote"?0:Number(localPort),remotePort:kind==="remote"?Number(remotePort):null,kind,
        targetHost:kind==="local"?targetHost:kind==="remote"?"127.0.0.1":"",
        targetPort:kind==="dynamic"?0:Number(targetPort)},events});
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
      onChange={event=>setKind(event.target.value as "local"|"dynamic"|"remote")}>
      <option value="local">{ru?"Локальный порт → один адрес":"Local port → one target"}</option>
      <option value="dynamic">{ru?"Динамический SOCKS5":"Dynamic SOCKS5"}</option>
      <option value="remote">{ru?"Обратный SSH-туннель":"Remote forward"}</option>
    </select></label>
    {kind==="remote"&&<p className="ssh-help">{ru
      ?"Удалённый SSH-сервер откроет запрошенный порт на 127.0.0.1 и направит трафик на 127.0.0.1 локального компьютера. GatewayPorts на сервере может расширить доступ; проверьте слушающий адрес. Для публикации в интернет не предназначено."
      :"The SSH server is asked to listen on its own 127.0.0.1 and forward to your local machine's 127.0.0.1. Server-side GatewayPorts may widen access; verify the actual listener. Not designed for public internet exposure."}</p>}
    {kind==="dynamic"&&<p className="ssh-help">{ru?
      "Локальные программы смогут направлять через SSH-хост запросы SOCKS5 к адресам, которые они выберут. Запускайте только для доверенных локальных программ и остановите после работы.":
      "Local programs can use this SOCKS5 port to reach destinations they choose through the SSH host. Use it only with trusted local programs and stop it when done."}</p>}
    <div className="tunnel-fields">
      {kind!=="remote"&&<label>{ru?"Локальный порт":"Local port"}<input type="number" min="1024" max="65535" value={localPort} disabled={running} onChange={event=>setLocalPort(event.target.value)}/></label>}
      {kind==="remote"&&<label>{ru?"Удалённый порт":"Remote port"}<input aria-label="Remote port" type="number" min="1024" max="65535" value={remotePort} disabled={running} onChange={event=>setRemotePort(event.target.value)}/></label>}
      {kind==="local"&&<label>{ru?"Адрес назначения":"Target host"}<input value={targetHost} disabled={running} onChange={event=>setTargetHost(event.target.value)}/></label>}
      {kind!=="dynamic"&&<label>{kind==="remote"?(ru?"Локальный целевой порт":"Local target port"):(ru?"Порт назначения":"Target port")}<input aria-label={kind==="remote"?"Local target port":"Target port"} type="number" min="1" max="65535" value={targetPort} disabled={running} onChange={event=>setTargetPort(event.target.value)}/></label>}
    </div>
    <div className="actions"><button disabled={running} onClick={()=>void start()}>{ru?"Запустить туннель":"Start tunnel"}</button>
      <button disabled={!running} onClick={()=>void stop()}>{ru?"Остановить":"Stop tunnel"}</button></div>
    <p role="status">{status|| (ru?"Туннель выключен":"Tunnel stopped")}</p>
  </section>;
}
