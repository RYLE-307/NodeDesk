import {useEffect,useRef,useState} from "react";
import {invoke,isTauri} from "@tauri-apps/api/core";
import type {Connection} from "./catalog";
import {vaultTarget} from "./vaultModel";

/** Secrets enter only the native OS credential store. Inputs are uncontrolled
 * and cleared after every action; no React state, catalog or WebView storage. */
export function VaultWorkspace({connections,language}:{connections:Connection[];language:"ru"|"en"}){
  const ru=language==="ru";
  const [open,setOpen]=useState(false);
  const [selected,setSelected]=useState("");
  const [has,setHas]=useState<boolean|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const input=useRef<HTMLInputElement>(null);
  const reveal=useRef<HTMLInputElement>(null);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const target=connections.find(c=>c.id===selected);
  const identity=target&&vaultTarget(target);
  function clear(){
    if(input.current)input.current.value="";
    if(reveal.current)reveal.current.value="";
    if(timer.current)clearTimeout(timer.current);
    timer.current=null;
  }
  useEffect(()=>{if(isTauri())void invoke<boolean>("vault_status").then(setOpen).catch(()=>setOpen(false));
    return clear;},[]);
  useEffect(()=>{let current=true;clear();setHas(null);setMessage("");
    if(open&&identity&&isTauri())void invoke<boolean>("vault_has",{target:identity})
      .then(value=>{if(current)setHas(value);}).catch(()=>{if(current)setHas(null);});
    return ()=>{current=false;};
  },[open,selected,target?.host,target?.port,target?.username,target?.protocol]);
  async function action(kind:"unlock"|"lock"|"put"|"delete"|"reveal"){
    if(busy||!isTauri()){
      setMessage(ru?"Нужна настольная версия NodeDesk.":"NodeDesk desktop required.");return;
    }
    if(kind!=="unlock"&&kind!=="lock"&&!identity)return;
    setBusy(true);setMessage("");
    try{
      if(kind==="unlock"){
        await invoke("vault_unlock");setOpen(true);
        setMessage(ru?"Хранилище разблокировано.":"Vault unlocked.");
      }else if(kind==="lock"){
        await invoke("vault_lock");clear();setOpen(false);setHas(null);
        setMessage(ru?"Хранилище заблокировано.":"Vault locked.");
      }else if(kind==="put"){
        const secret=input.current?.value??"";
        if(input.current)input.current.value="";
        await invoke("vault_put",{target:identity,secret});
        setHas(true);setMessage(ru?"Секрет сохранён в системном хранилище.":"Saved in the OS credential store.");
      }else if(kind==="delete"){
        if(!window.confirm(ru?"Удалить сохранённый секрет?":"Delete the saved credential?"))return;
        await invoke("vault_delete",{target:identity});clear();setHas(false);
        setMessage(ru?"Секрет удалён.":"Credential deleted.");
      }else{
        if(!window.confirm(ru?"Показать секрет на 15 секунд?":"Reveal the credential for 15 seconds?"))return;
        const secret=await invoke<string|null>("vault_get",{target:identity});
        if(!secret)throw new Error("Credential missing");
        if(reveal.current)reveal.current.value=secret;
        if(timer.current)clearTimeout(timer.current);
        timer.current=setTimeout(()=>{if(reveal.current)reveal.current.value="";timer.current=null;},15000);
      }
    }catch{
      clear();setMessage(ru?"Операция не выполнена. Проверьте системное хранилище и блокировку.":
        "Vault operation failed. Check the OS store and lock state.");
    }finally{setBusy(false);}
  }
  return <section className="pane vault-workspace" aria-label={ru?"Защищённое хранилище":"Credential vault"}>
    <h2>{ru?"Защищённое хранилище":"Credential vault"}</h2>
    <p>{ru?"Секреты сохраняются только в Windows Credential Manager или Linux Secret Service. При отсутствии системного хранилища сохранение недоступно. Разблокировка открывает доступ в этом запущенном приложении; блокировка закрывает его, но не блокирует саму ОС.":
      "Credentials are stored only in Windows Credential Manager or Linux Secret Service. Saving fails if the OS store is unavailable. Unlock enables access in this running app; Lock does not lock the OS store itself."}</p>
    <div className="actions">
      <button type="button" disabled={busy||open} onClick={()=>void action("unlock")}>{ru?"Разблокировать":"Unlock"}</button>
      <button type="button" disabled={busy||!open} onClick={()=>void action("lock")}>{ru?"Заблокировать":"Lock"}</button>
    </div>
    <label>{ru?"Подключение":"Connection"}
      <select aria-label={ru?"Подключение для секрета":"Credential connection"} value={selected}
        onChange={e=>setSelected(e.target.value)}>
        <option value="">{ru?"Выберите сохранённое подключение":"Select a saved connection"}</option>
        {connections.map(c=><option key={c.id} value={c.id}>{c.name} · {c.protocol} · {c.host}:{c.port}</option>)}
      </select>
    </label>
    {open&&identity&&<>
      <p role="status">{has===null?(ru?"Проверка записи…":"Checking credential…"):
        has?(ru?"Секрет сохранён":"Credential saved"):(ru?"Секрет не сохранён":"No saved credential")}</p>
      <form onSubmit={e=>{e.preventDefault();void action("put");}}>
        <label>{ru?"Новый секрет":"New credential"}
          <input ref={input} type="password" aria-label={ru?"Новый секрет":"New credential"}
            autoComplete="off" maxLength={1024} required/>
        </label>
        <button type="submit" disabled={busy}>{ru?"Сохранить в ОС":"Save in OS store"}</button>
      </form>
      <div className="actions">
        <button type="button" disabled={busy||!has} onClick={()=>void action("reveal")}>{ru?"Показать на 15 секунд":"Reveal for 15 seconds"}</button>
        <button type="button" disabled={busy} onClick={()=>void action("delete")}>{ru?"Удалить секрет":"Delete credential"}</button>
      </div>
      <label>{ru?"Временный показ":"Temporary reveal"}<input ref={reveal} type="text" readOnly
        aria-label={ru?"Временный показ":"Temporary reveal"} autoComplete="off"/></label>
    </>}
    {message&&<p role="status">{message}</p>}
    <p className="ssh-help">{ru?"Смена адреса, пользователя или протокола не переносит секрет на новую цель. Удалите старую запись явно. Экспорт каталога никогда не включает секреты.":
      "Changing host, user or protocol never moves a credential to a new target. Delete the old entry explicitly. Catalog export never includes credentials."}</p>
  </section>;
}
