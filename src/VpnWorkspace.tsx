import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

type VpnProfile = {id:string;name:string;kind:string;active:boolean;controlAllowed:boolean};
type VpnHealth = {profileId:string;active:boolean;routeConfigured:boolean|null;dnsConfigured:boolean|null};

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
  const [health,setHealth]=useState<Record<string,VpnHealth>>({});
  const [healthBusy,setHealthBusy]=useState("");
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
    setHealth({});
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
    setHealth({});
    try {
      const items=await invoke<VpnProfile[]>("vpn_set",{profileId:profile.id,
        expectedName:profile.name,expectedKind:profile.kind,expectedActive:profile.active,connect});
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
  async function checkHealth(profile:VpnProfile){
    if(loading||busy||healthBusy)return;
    setHealthBusy(profile.id);setError("");
    try {
      const result=await invoke<VpnHealth>("vpn_health",{profileId:profile.id});
      if(!alive.current)return;
      if(result.profileId.toLowerCase()!==profile.id.toLowerCase()||result.active!==profile.active)
        throw new Error("VPN state changed; refresh before checking again");
      setHealth(previous=>({...previous,[profile.id]:result}));
    }catch{if(alive.current)setError(ru?"Проверка маршрутов и DNS не выполнена. Обновите список.":
      "Route and DNS check failed. Refresh the profile list.");}
    finally{if(alive.current)setHealthBusy("");}
  }
  const evidence=(value:boolean|null,active:boolean)=>!active?(ru?"нет подключения":"not connected"):
    value===null?(ru?"не определено":"unknown"):
      value?(ru?"есть":"present"):(ru?"нет":"absent");
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
        <th>{ru?"Маршруты / DNS":"Routes / DNS"}</th>
        <th>{ru?"Действия":"Actions"}</th>
      </tr></thead>
      <tbody>{profiles.map(p=><tr key={p.id}>
        <td>{p.name}</td>
        <td>{p.kind}</td>
        <td>{p.active?(ru?"Подключён":"Connected"):(ru?"Отключён":"Disconnected")}</td>
        <td>{health[p.id] ? `${evidence(health[p.id].routeConfigured,p.active)} / ${evidence(health[p.id].dnsConfigured,p.active)}`:
          (ru?"Не проверено":"Not checked")}
          <button type="button" disabled={loading||!!busy||!!healthBusy}
            onClick={()=>void checkHealth(p)}>{healthBusy===p.id?(ru?"Проверка…":"Checking…"):
            (ru?"Проверить":"Check")}</button></td>
        <td>{p.controlAllowed ? <button type="button" disabled={loading||!!busy}
          onClick={()=>void toggle(p)}>{busy===p.id?(ru?"Выполняется…":"Working…"):
          p.active?(ru?"Отключить":"Disconnect"):(ru?"Подключить":"Connect")}</button> :
          <span>{ru?"Только просмотр — протокол или политика шифрования не поддерживается":"Read-only — protocol or encryption policy unsupported"}</span>}</td>
      </tr>)}</tbody>
    </table></div>}
    <p className="ssh-help">{ru?"Проверка показывает только наличие маршрутов и DNS в активном системном профиле. Она не доказывает, что трафик или DNS-запросы идут через VPN; split tunnel может не иметь маршрута по умолчанию. Адреса и имена серверов не передаются в WebView.":
      "The check shows only whether the active OS profile reports routes and DNS. It does not prove traffic or DNS queries use the VPN; split tunnels need not have a default route. Addresses and server names never reach the WebView."}</p>
    <p className="ssh-help">{ru
      ? "Arch/Linux: NetworkManager WireGuard, OpenVPN и OpenConnect; другие VPN-плагины только для просмотра. Windows: VPN-профили текущего пользователя — IKEv2/L2TP/SSTP. Профили с шифрованием Optional/Custom/NoEncryption доступны только для просмотра. Профили других программ не показываются."
      : "Arch/Linux: NetworkManager WireGuard, OpenVPN and OpenConnect; other VPN plugins are read-only. Windows: current-user IKEv2/L2TP/SSTP profiles. Optional/Custom/NoEncryption profiles are read only. Third-party VPN clients are not managed."}</p>
    <p className="ssh-help">{ru
      ? "Система должна уже иметь необходимые учётные данные или агент ввода пароля. Если авторизация не настроена, подключение может завершиться ошибкой. Нажмите «Обновить VPN», чтобы перечитать статус."
      : "The OS must already have the required credentials or a compatible secret agent. Authentication may fail otherwise. Refresh VPNs to reread system status."}</p>
  </section>;
}
