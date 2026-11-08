import {useEffect,useRef,useState} from "react";
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
  // Invalidate stale results and stop native diagnostic processes when the
  // target changes or the workspace closes.
  const targetVersion=useRef(0);
  const mounted=useRef(true);
  const probeId=useRef<string|null>(null);
  const pingId=useRef<string|null>(null);
  const traceId=useRef<string|null>(null);
  const scanId=useRef<string|null>(null);
  function cancelProbe(showMessage:boolean){
    const id=probeId.current;if(!id)return;
    probeId.current=null;
    void invoke("network_cancel",{id}).catch(()=>{});
    if(showMessage){setBusy(false);setError(ru?"Проверка TCP отменена":"TCP check cancelled");}
  }
  function cancelPing(showMessage:boolean){
    const id=pingId.current;if(!id)return;
    pingId.current=null;
    void invoke("network_cancel",{id}).catch(()=>{});
    if(showMessage){setPingBusy(false);setPingError(ru?"Ping отменён":"Ping cancelled");}
  }
  function cancelTrace(showMessage:boolean){
    const id=traceId.current;if(!id)return;
    traceId.current=null;
    void invoke("network_cancel",{id}).catch(()=>{});
    if(showMessage){setTraceBusy(false);setTraceError(ru?"Трассировка отменена":"Traceroute cancelled");}
  }
  function cancelScan(showMessage:boolean){
    const id=scanId.current;if(!id)return;
    scanId.current=null;
    void invoke("network_cancel",{id}).catch(()=>{});
    if(showMessage){setScanBusy(false);setScanError(ru?"Проверка портов отменена":"Port check cancelled");}
  }
  useEffect(()=>{
    mounted.current=true;
    return ()=>{
      mounted.current=false;targetVersion.current++;
      for(const id of [probeId.current,pingId.current,traceId.current,scanId.current]){
        if(id)void invoke("network_cancel",{id}).catch(()=>{});
      }
      probeId.current=null;pingId.current=null;traceId.current=null;scanId.current=null;
    };
  },[]);
  function changeTarget(){
    targetVersion.current++;
    cancelProbe(false);cancelPing(false);cancelTrace(false);cancelScan(false);
    setBusy(false);setPingBusy(false);setTraceBusy(false);setScanBusy(false);
    setResult(null);setPingResult(null);setTraceResult(null);setScanResult(null);
    setError("");setPingError("");setTraceError("");setScanError("");
  }
  function downloadReport(){
    if(!result && !pingResult && !traceResult && !scanResult)return;
    const report={version:1,createdAt:new Date().toISOString(),target:{host:host.trim()},
      tcp:result?{port, ...result}:null,ping:pingResult,trace:traceResult,
      ports:scanResult};
    const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:"application/json"}));
    const link=document.createElement("a");
    link.href=url;link.download="nodedesk-network-report.json";
    document.body.append(link);link.click();link.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),10000);
  }

  async function run(){
    if(probeId.current)return;
    setResult(null);setError("");
    if(!isTauri()){setError(ru?"Нужна настольная версия NodeDesk":"NodeDesk desktop app required");return;}
    const version=targetVersion.current;
    const request={host:host.trim(),port};
    const id=crypto.randomUUID();probeId.current=id;
    setBusy(true);
    try{
      const received=await invoke<ProbeResult>("network_probe",{id,target:request});
      if(mounted.current && probeId.current===id && version===targetVersion.current)setResult(received);
    }catch(e){
      if(mounted.current && probeId.current===id && version===targetVersion.current)setError(String(e));
    }finally{
      if(probeId.current===id){probeId.current=null;if(mounted.current)setBusy(false);}
    }
  }
  async function runPing(){
    if(pingId.current)return;
    setPingResult(null);setPingError("");
    if(!isTauri()){setPingError(ru?"Нужна настольная версия NodeDesk":"NodeDesk desktop app required");return;}
    const version=targetVersion.current;
    const request={host:host.trim()};
    const id=crypto.randomUUID();pingId.current=id;
    setPingBusy(true);
    try{
      const received=await invoke<PingResult>("network_ping",{id,target:request});
      if(mounted.current && pingId.current===id && version===targetVersion.current)setPingResult(received);
    }catch(e){
      if(mounted.current && pingId.current===id && version===targetVersion.current)setPingError(String(e));
    }finally{
      if(pingId.current===id){pingId.current=null;if(mounted.current)setPingBusy(false);}
    }
  }

  async function runTrace(){
    if(traceId.current)return;
    setTraceResult(null);setTraceError("");
    if(!isTauri()){setTraceError(ru?"Нужна настольная версия NodeDesk":"NodeDesk desktop app required");return;}
    const version=targetVersion.current;
    const request={host:host.trim()};
    const id=crypto.randomUUID();traceId.current=id;
    setTraceBusy(true);
    try{
      const received=await invoke<TraceResult>("network_trace",{id,target:request});
      if(mounted.current && traceId.current===id && version===targetVersion.current)setTraceResult(received);
    }catch(e){
      if(mounted.current && traceId.current===id && version===targetVersion.current)setTraceError(String(e));
    }finally{
      if(traceId.current===id){traceId.current=null;if(mounted.current)setTraceBusy(false);}
    }
  }

  async function runScan(){
    if(scanId.current)return;
    setScanResult(null);setScanError("");
    const ports=parseExplicitPorts(portsText);
    if(!ports){setScanError(ru?"Укажи от 1 до 12 уникальных TCP-портов через запятую без диапазонов":"Enter 1–12 distinct TCP ports separated by commas; no ranges");return;}
    if(!isTauri()){setScanError(ru?"Нужна настольная версия NodeDesk":"NodeDesk desktop app required");return;}
    const version=targetVersion.current;
    const request={host:host.trim(),ports};
    const id=crypto.randomUUID();scanId.current=id;
    setScanBusy(true);
    try{
      const received=await invoke<PortScanResult>("network_scan_ports",{id,target:request});
      if(mounted.current && scanId.current===id && version===targetVersion.current)setScanResult(received);
    }catch(e){
      if(mounted.current && scanId.current===id && version===targetVersion.current)setScanError(String(e));
    }finally{
      if(scanId.current===id){scanId.current=null;if(mounted.current)setScanBusy(false);}
    }
  }

  return <section className="vpn-workspace" aria-label={ru?"Диагностика сети":"Network diagnostics"}>
    <h2>{ru?"Диагностика сети":"Network diagnostics"}</h2>
    <p className="ssh-help">{ru?"DNS, TCP, Ping, трассировка и проверка до 12 явно указанных TCP-портов запускаются только по нажатию. Диапазоны и фоновые запросы не поддерживаются.":"DNS, TCP, Ping, traceroute and up to 12 explicitly specified TCP ports run only on click. No ranges or background requests."}</p>
    <div className="network-fields">
      <label>{ru?"Хост":"Host"}<input value={host} onChange={e=>{setHost(e.target.value);changeTarget();}} maxLength={253} autoComplete="off"/></label>
      <label>{ru?"Порт":"Port"}<input type="number" min={1} max={65535} value={port} onChange={e=>{setPort(Number(e.target.value));changeTarget();}}/></label>
      <button type="button" disabled={busy||!host.trim()||!Number.isInteger(port)||port<1||port>65535} onClick={()=>void run()}>{busy?(ru?"Проверка…":"Checking…"):(ru?"Проверить TCP":"Check TCP")}</button>
      {busy&&<button type="button" onClick={()=>cancelProbe(true)}>{ru?"Отменить TCP":"Cancel TCP check"}</button>}
      <button type="button" disabled={pingBusy||!host.trim()} onClick={()=>void runPing()}>{pingBusy?(ru?"Ping…":"Pinging…"):"Ping"}</button>
      {pingBusy&&<button type="button" onClick={()=>cancelPing(true)}>{ru?"Отменить Ping":"Cancel ping"}</button>}
      <button type="button" disabled={traceBusy||!host.trim()} onClick={()=>void runTrace()}>{traceBusy?(ru?"Трассировка…":"Tracing…"):(ru?"Трассировка":"Traceroute")}</button>
      {traceBusy&&<button type="button" onClick={()=>cancelTrace(true)}>{ru?"Отменить трассировку":"Cancel traceroute"}</button>}
    </div>
    <div className="network-fields">
      <label>{ru?"TCP-порты (через запятую)":"TCP ports (comma-separated)"}
        <input value={portsText} maxLength={100} autoComplete="off"
          placeholder="22,80,443" onChange={e=>{setPortsText(e.target.value);changeTarget();}}/>
      </label>
      <button type="button" disabled={scanBusy||!host.trim()} onClick={()=>void runScan()}>
        {scanBusy?(ru?"Проверка портов…":"Checking ports…"):(ru?"Проверить порты":"Check ports")}
      </button>
      {scanBusy&&<button type="button" onClick={()=>cancelScan(true)}>{ru?"Отменить порты":"Cancel port check"}</button>}
    </div>
    <button type="button" disabled={!result&&!pingResult&&!traceResult&&!scanResult}
      onClick={downloadReport}>{ru?"Скачать отчёт":"Download report"}</button>
    <p className="ssh-help">{ru?"Отчёт создаётся только по нажатию и содержит адрес, результаты и вывод сетевых утилит. Проверьте его перед передачей другим людям.":
      "The report is created only on click and includes the host, results and diagnostic output. Review it before sharing."}</p>
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
