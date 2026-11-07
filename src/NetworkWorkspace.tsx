import {useState} from "react";
import {invoke,isTauri} from "@tauri-apps/api/core";

type ProbeResult={addresses:string[];tcpReachable:boolean;elapsedMs:number};
export function NetworkWorkspace({language}:{language:"ru"|"en"}) {
  const ru=language==="ru";
  const [host,setHost]=useState("");
  const [port,setPort]=useState(443);
  const [busy,setBusy]=useState(false);
  const [result,setResult]=useState<ProbeResult|null>(null);
  const [error,setError]=useState("");
  async function run(){
    if(busy)return;
    setResult(null);setError("");
    if(!isTauri()){setError(ru?"Нужна настольная версия NodeDesk":"NodeDesk desktop app required");return;}
    setBusy(true);
    try{setResult(await invoke<ProbeResult>("network_probe",{target:{host:host.trim(),port}}));}
    catch(e){setError(String(e));}
    finally{setBusy(false);}
  }
  return <section className="vpn-workspace" aria-label={ru?"Диагностика сети":"Network diagnostics"}>
    <h2>{ru?"Диагностика сети":"Network diagnostics"}</h2>
    <p className="ssh-help">{ru?"По нажатию выполняются DNS-поиск и проверка одного TCP-порта. Сканирование диапазона и фоновые запросы не запускаются.":"On click, resolve DNS and check one TCP port. No range scan or background requests."}</p>
    <div className="network-fields">
      <label>{ru?"Хост":"Host"}<input value={host} onChange={e=>{setHost(e.target.value);setResult(null);}} maxLength={253} autoComplete="off"/></label>
      <label>{ru?"Порт":"Port"}<input type="number" min={1} max={65535} value={port} onChange={e=>{setPort(Number(e.target.value));setResult(null);}}/></label>
      <button type="button" disabled={busy||!host.trim()||!Number.isInteger(port)||port<1||port>65535} onClick={()=>void run()}>{busy?(ru?"Проверка…":"Checking…"):(ru?"Проверить":"Check")}</button>
    </div>
    {error&&<p role="alert" className="error">{error}</p>}
    {result&&<div role="status"><p>{ru?"Адреса DNS":"DNS addresses"}: {result.addresses.join(", ")}</p>
      <p>{ru?"TCP-порт":"TCP port"} {port}: {result.tcpReachable?(ru?"доступен":"reachable"):(ru?"не ответил":"no response")} ({result.elapsedMs} ms)</p></div>}
  </section>;
}
