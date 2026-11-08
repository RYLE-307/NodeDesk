import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

type VpnProfile = {id:string;name:string;kind:string;active:boolean;controlAllowed:boolean};

/**
 * System VPN control only: never collects credentials or edits VPN profiles.
 * The OS remains authoritative for state, routes, DNS and authentication.
 */
export function VpnWorkspace({language}:{language:"ru"|"en"}) {
  const ru=language==="ru";
  const [profiles,setProfiles]=useState<VpnProfile[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const alive=useRef(true);
  useEffect(()=>{
    alive.current=true;
    if (!isTauri()) {
      setLoading(false);
      setError(ru ? "VPN доступен только в настольном приложении NodeDesk." : "VPN requires the NodeDesk desktop app.");
    } else {
      void invoke<VpnProfile[]>("vpn_list").then(items=>{
        if(alive.current)setProfiles(items);
      }).catch(e=>{
        if(alive.current)setError(String(e));
      }).finally(()=>{if(alive.current)setLoading(false);});
    }
    return ()=>{alive.current=false;};
  },[]);

  async function refresh(){
    if(loading||busy)return;
    setLoading(true);setError("");setMessage("");
    try {
      const items=await invoke<VpnProfile[]>("vpn_list");
      if(alive.current)setProfiles(items);
    } catch(e) {if(alive.current)setError(String(e));}
    finally{if(alive.current)setLoading(false);}
  }
  async function toggle(profile:VpnProfile){
    if(loading||busy||!profile.controlAllowed)return;
    const connect=!profile.active;
    const question=ru
      ? (connect?"Подключить":"Отключить")+" системный VPN «"+profile.name+"»?\nМаршруты и DNS могут измениться, а текущий удалённый доступ — прерваться. Продолжить?"
      : (connect?"Connect":"Disconnect")+' system VPN "'+profile.name+'"?\nRoutes/DNS may change and remote access can be interrupted. Continue?';
    if(!window.confirm(question))return;
    setBusy(profile.id);setError("");setMessage("");
    try {
      const items=await invoke<VpnProfile[]>("vpn_set",{profileId:profile.id,connect});
      if(!alive.current)return;
      setProfiles(items);
      const current=items.find(item=>item.id===profile.id);
      if(current?.active===connect){
        setMessage(ru ? "Система подтвердила состояние VPN «"+profile.name+"»." : 'OS reported the new state for "'+profile.name+'".');
      }else{
        setError(ru ? "ОС не подтвердила запрошенное состояние. Обновите список и проверьте VPN." :
          "OS did not confirm the requested state. Refresh and verify the VPN.");
      }
    } catch(e) {if(alive.current)setError(String(e));}
    finally{if(alive.current)setBusy("");}
  }
  return <section className="vpn-workspace" aria-label={ru?"Системные VPN":"System VPN"}>
    <h2>{ru?"Системные VPN-подключения":"System VPN connections"}</h2>
    <p className="ssh-help">{ru
      ? "NodeDesk использует уже настроенные VPN-профили ОС. Пароли, ключи и параметры маршрутизации здесь не хранятся. Подключение/отключение только после подтверждения."
      : "NodeDesk uses VPN profiles configured in your operating system. Credentials, keys and routes are not stored here. Connect/disconnect always requires confirmation."}</p>
    <button type="button" onClick={()=>void refresh()} disabled={loading||!!busy}>
      {loading?(ru?"Загрузка…":"Loading…"):(ru?"Обновить VPN":"Refresh VPNs")}
    </button>
    {error && <p role="alert" className="error">{error}</p>}
    {message && <p role="status">{message}</p>}
    {(!loading && !error && !profiles.length) &&
      <p>{ru?"Поддерживаемые VPN-профили не найдены. Настройте их средствами ОС." :
        "No supported VPN profiles found. Configure a connection in the operating system first."}</p>}
    {profiles.length>0 && <div className="vpn-table-wrap"><table className="vpn-table">
      <thead><tr>
        <th>{ru?"Профиль":"Profile"}</th>
        <th>{ru?"Тип":"Type"}</th>
        <th>{ru?"Статус":"Status"}</th>
        <th>{ru?"Действия":"Actions"}</th>
      </tr></thead>
      <tbody>{profiles.map(p=><tr key={p.id}>
        <td>{p.name}</td>
        <td>{p.kind}</td>
        <td>{p.active?(ru?"Подключён":"Connected"):(ru?"Отключён":"Disconnected")}</td>
        <td>{p.controlAllowed ? <button type="button" disabled={loading||!!busy}
          onClick={()=>void toggle(p)}>{busy===p.id?(ru?"Выполняется…":"Working…"):
          p.active?(ru?"Отключить":"Disconnect"):(ru?"Подключить":"Connect")}</button> :
          <span>{ru?"Только просмотр — протокол или политика шифрования не поддерживается":"Read-only — protocol or encryption policy unsupported"}</span>}</td>
      </tr>)}</tbody>
    </table></div>}
    <p className="ssh-help">{ru
      ? "Arch/Linux: NetworkManager WireGuard, OpenVPN и OpenConnect; другие VPN-плагины только для просмотра. Windows: VPN-профили текущего пользователя — IKEv2/L2TP/SSTP. Профили с шифрованием Optional/Custom/NoEncryption доступны только для просмотра. Профили других программ не показываются."
      : "Arch/Linux: NetworkManager WireGuard, OpenVPN and OpenConnect; other VPN plugins are read-only. Windows: current-user IKEv2/L2TP/SSTP profiles. Optional/Custom/NoEncryption profiles are read only. Third-party VPN clients are not managed."}</p>
    <p className="ssh-help">{ru
      ? "Система должна уже иметь необходимые учётные данные или агент ввода пароля. Если авторизация не настроена, подключение может завершиться ошибкой. Нажмите «Обновить VPN», чтобы перечитать статус."
      : "The OS must already have the required credentials or a compatible secret agent. Authentication may fail otherwise. Refresh VPNs to reread system status."}</p>
  </section>;
}
