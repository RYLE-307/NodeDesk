import {useEffect,useState} from "react";
import {invoke,isTauri} from "@tauri-apps/api/core";

type Snapshot={cpuPercent:number;memoryUsedBytes:number;memoryTotalBytes:number;diskUsedBytes:number;diskTotalBytes:number;networkReceivedBytes:number;networkTransmittedBytes:number};
const size=(bytes:number)=>`${(bytes/1073741824).toFixed(1)} GiB`;

export function MonitorPanel({language}:{language:"ru"|"en"}) {
  const ru=language==="ru";
  const [sample,setSample]=useState<Snapshot|null>(null);
  const [error,setError]=useState("");
  useEffect(()=>{
    if(!isTauri()){setError(ru?"Мониторинг доступен в настольной версии":"Monitoring requires the desktop app");return;}
    let active=true;
    let pending=false;
    async function refresh(){
      if(pending)return;
      pending=true;
      try{
        const value=await invoke<Snapshot>("monitor_snapshot");
        if(active){setSample(value);setError("");}
      }catch(e){if(active)setError(String(e));}
      finally{pending=false;}
    }
    void refresh();
    const timer=window.setInterval(()=>void refresh(),3000);
    return ()=>{active=false;window.clearInterval(timer);};
  },[ru]);
  return <section className="monitor" aria-label={ru?"Локальный мониторинг":"Local monitoring"}>
    <strong>{ru?"Локальный мониторинг":"Local monitoring"}</strong>
    {error && <p role="alert">{error}</p>}
    {sample && <div className="monitor-metrics" role="status">
      <span>CPU {sample.cpuPercent.toFixed(0)}%</span>
      <span>{ru?"Память":"Memory"} {size(sample.memoryUsedBytes)} / {size(sample.memoryTotalBytes)}</span>
      <span>{ru?"Диски":"Disks"} {size(sample.diskUsedBytes)} / {size(sample.diskTotalBytes)}</span>
      <span>{ru?"Сеть ↓":"Network ↓"} {size(sample.networkReceivedBytes)} ↑ {size(sample.networkTransmittedBytes)}</span>
    </div>}
    <small>{ru?"Только этот компьютер; суммарные счётчики сети с запуска ОС. Обновление каждые 3 секунды, пока включено.":"This computer only; network totals since OS start. Refreshes every 3 seconds while enabled."}</small>
  </section>;
}
