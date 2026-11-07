import {useState} from "react";
import {invoke,isTauri} from "@tauri-apps/api/core";

type ProbeResult={addresses:string[];tcpReachable:boolean;elapsedMs:number};
type PingResult={reachable:boolean;elapsedMs:number;output:string};
type TraceResult={elapsedMs:number;output:string};
type PortScanResult={addresses:string[];results:{port:number;reachable:boolean}[];elapsedMs:number};

function parseExplicitPorts(text:string):number[]|null {
  const tokens=text.split(",").map(value=>value.trim());
  if(!tokens.length||tokens.length>12||tokens.some(value=>!/^[0-9]{1,5}$/.test(value)))return null;
  const ports=tokens.map(Number);
  if(ports.some(port=>port<1||port>65535)||new Set(ports).size!==ports.length)return null;
  return ports;
}

export function NetworkWorkspace({language}:{language:"ru"|"en"}) {
  const ru=language==="ru";
  const [host,setHost]=useState("");
  const [port,setPort]=useState(443);
  const [busy,setBusy]=useState(false);
  const [result,setResult]=useState<ProbeResult|null>(null);
  const [error,setError]=useState("");
  const [pingBusy,setPingBusy]=useState(false);
  const [pingResult,setPingResult]=useState<PingResult|null>(null);
  const [pingError,setPingError]=useState("");
  const [traceBusy,setTraceBusy]=useState(false);
  const [traceResult,setTraceResult]=useState<TraceResult|null>(null);
  const [traceError,setTraceError]=useState("");
  const [portsText,setPortsText]=useState("22,80,443");
  const [scanBusy,setScanBusy]=useState(false);
  const [scanResult,setScanResult]=useState<PortScanResult|null>(null);
  const [scanError,setScanError]=useState("");

  async function run(){
    if(busy)return;
    setResult(null);setError("");
    if(!isTauri()){setError(ru?"Нужна настольная версия NodeDesk":"NodeDesk desktop app required");return;}
    setBusy(true);
    try{setResult(await invoke<ProbeResult>("network_probe",{target:{host:host.trim(),port}}));}
    catch(e){setError(String(e));}
    finally{setBusy(false);}
  }
  async function runPing(){
    if(pingBusy)return;
    setPingResult(null);setPingError("");
    if(!isTauri()){setPingError(ru?"Нужна настольная версия NodeDesk":"NodeDesk desktop app required");return;}
    setPingBusy(true);
    try{setPingResult(await invoke<PingResult>("network_ping",{target:{host:host.trim()}}));}
    catch(e){setPingError(String(e));}
    finally{setPingBusy(false);}
  }

  async function runTrace(){
    if(traceBusy)return;
    setTraceResult(null);setTraceError("");
    if(!isTauri()){setTraceError(ru?"Нужна настольная версия NodeDesk":"NodeDesk desktop app required");return;}
    setTraceBusy(true);
    try{setTraceResult(await invoke<TraceResult>("network_trace",{target:{host:host.trim()}}));}
    catch(e){setTraceError(String(e));}
    finally{setTraceBusy(false);}
  }

  async function runScan(){
    if(scanBusy)return;
    setScanResult(null);setScanError("");
    const ports=parseExplicitPorts(portsText);
    if(!ports){setScanError(ru?"Укажи от 1 до 12 уникальных TCP-портов через запятую без диапазонов":"Enter 1–12 distinct TCP ports separated by commas; no ranges");return;}
    if(!isTauri()){setScanError(ru?"Нужна настольная версия NodeDesk":"NodeDesk desktop app required");return;}
    setScanBusy(true);
    try{setScanResult(await invoke<PortScanResult>("network_scan_ports",{target:{host:host.trim(),ports}}));}
    catch(e){setScanError(String(e));}
    finally{setScanBusy(false);}
  }

  return <section className="vpn-workspace" aria-label={ru?"Диагностика сети":"Network diagnostics"}>
    <h2>{ru?"Диагностика сети":"Network diagnostics"}</h2>
    <p className="ssh-help">{ru?"DNS, TCP, Ping, трассировка и проверка до 12 явно указанных TCP-портов запускаются только по нажатию. Диапазоны и фоновые запросы не поддерживаются.":"DNS, TCP, Ping, traceroute and up to 12 explicitly specified TCP ports run only on click. No ranges or background requests."}</p>
    <div className="network-fields">
      <label>{ru?"Хост":"Host"}<input value={host} onChange={e=>{setHost(e.target.value);setResult(null);setPingResult(null);setTraceResult(null);setScanResult(null);}} maxLength={253} autoComplete="off"/></label>
      <label>{ru?"Порт":"Port"}<input type="number" min={1} max={65535} value={port} onChange={e=>{setPort(Number(e.target.value));setResult(null);}}/></label>
      <button type="button" disabled={busy||!host.trim()||!Number.isInteger(port)||port<1||port>65535} onClick={()=>void run()}>{busy?(ru?"Проверка…":"Checking…"):(ru?"Проверить TCP":"Check TCP")}</button>
      <button type="button" disabled={pingBusy||!host.trim()} onClick={()=>void runPing()}>{pingBusy?(ru?"Ping…":"Pinging…"):"Ping"}</button>
      <button type="button" disabled={traceBusy||!host.trim()} onClick={()=>void runTrace()}>{traceBusy?(ru?"Трассировка…":"Tracing…"):(ru?"Трассировка":"Traceroute")}</button>
    </div>
    <div className="network-fields">
      <label>{ru?"TCP-порты (через запятую)":"TCP ports (comma-separated)"}
        <input value={portsText} maxLength={100} autoComplete="off"
          placeholder="22,80,443" onChange={e=>{setPortsText(e.target.value);setScanResult(null);setScanError("");}}/>
      </label>
      <button type="button" disabled={scanBusy||!host.trim()} onClick={()=>void runScan()}>
        {scanBusy?(ru?"Проверка портов…":"Checking ports…"):(ru?"Проверить порты":"Check ports")}
      </button>
    </div>
    {scanError&&<p role="alert" className="error">{scanError}</p>}
    {scanResult&&<div role="status" aria-label={ru?"Результат проверки портов":"Port check result"}>
      <p>{ru?"Адреса":"Addresses"}: {scanResult.addresses.join(", ")} ({scanResult.elapsedMs} ms)</p>
      <ul className="network-port-results">{scanResult.results.map(entry=><li key={entry.port}>
        TCP {entry.port}: {entry.reachable?(ru?"доступен":"reachable"):(ru?"нет ответа":"no response")}
      </li>)}</ul>
    </div>}
    {error&&<p role="alert" className="error">{error}</p>}
    {result&&<div role="status"><p>{ru?"Адреса DNS":"DNS addresses"}: {result.addresses.join(", ")}</p>
      <p>{ru?"TCP-порт":"TCP port"} {port}: {result.tcpReachable?(ru?"доступен":"reachable"):(ru?"не ответил":"no response")} ({result.elapsedMs} ms)</p></div>}
    {pingError&&<p role="alert" className="error">{pingError}</p>}
    {pingResult&&<div role="status" aria-label={ru?"Результат Ping":"Ping result"}>
      <p>Ping: {pingResult.reachable?(ru?"ответ получен":"reply received"):(ru?"ответ не получен":"no reply")} ({pingResult.elapsedMs} ms)</p>
      {pingResult.output&&<pre className="network-ping-output">{pingResult.output}</pre>}
    </div>}
    {traceError&&<p role="alert" className="error">{traceError}</p>}
    {traceResult&&<div role="status" aria-label={ru?"Результат трассировки":"Traceroute result"}>
      <p>{ru?"Трассировка завершена":"Traceroute finished"} ({traceResult.elapsedMs} ms)</p>
      {traceResult.output&&<pre className="network-ping-output">{traceResult.output}</pre>}
    </div>}
  </section>;
}
