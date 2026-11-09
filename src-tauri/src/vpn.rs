//! System-owned VPN profiles. Never imports credentials, edits routes/DNS, or
//! accepts arbitrary executables/scripts from WebView. Explicit user action only.
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    io::Read,
    process::{Command, Stdio},
    sync::{Arc, atomic::{AtomicBool, Ordering}},
    time::{Duration, Instant}
};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VpnProfile {
    id: String,      // OS-assigned UUID; never a shell string or profile name
    name: String,    // display only (Windows rasdial requires it as one argv)
    kind: String,    // NetworkManager VPN/WireGuard or Windows IKEv2/L2TP/SSTP
    active: bool,
    #[serde(default)]
    control_allowed: bool, // unsupported encryption policies remain read-only
}

/// Process-wide guard for mutations of system-owned VPN profiles.
/// The worker owns this guard: cancelling an IPC call cannot unlock it while
/// a blocking OS command is still running.
#[derive(Default)]
pub struct VpnActions { busy:Arc<AtomicBool> }

struct VpnActionGuard { busy:Arc<AtomicBool> }

impl VpnActions {
    fn acquire(&self)->Result<VpnActionGuard,String> {
        self.busy.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire)
            .map_err(|_| "Another system VPN action is already in progress".to_string())?;
        Ok(VpnActionGuard{busy:Arc::clone(&self.busy)})
    }
}

impl Drop for VpnActionGuard {
    fn drop(&mut self) { self.busy.store(false,Ordering::Release); }
}

fn uuid_ok(id: &str) -> bool {
    let bytes=id.as_bytes();
    bytes.len()==36 && bytes.iter().enumerate().all(|(i,b)| {
        if [8,13,18,23].contains(&i) { *b==b'-' }
        else { b.is_ascii_hexdigit() }
    })
}
fn safe_name(name:&str) -> bool {
    !name.is_empty() && name.len()<=200 && !name.chars().any(|c|c.is_control())
}
fn require_control_allowed(profile:&VpnProfile)->Result<(),String> {
    if profile.control_allowed {Ok(())}
    else {Err("Unsupported VPN protocol or encryption policy is read-only in NodeDesk".into())}
}

/// A click must only affect exactly the OS profile the operator was shown.
/// A reused UUID, externally changed protocol, or changed active state must
/// force a refresh instead of silently acting on a different/stale profile.
fn verify_request_snapshot(
    current:&VpnProfile, expected_name:&str, expected_kind:&str, expected_active:bool
)->Result<(),String> {
    if !safe_name(expected_name) || !safe_name(expected_kind)
        || current.name!=expected_name || current.kind!=expected_kind
        || current.active!=expected_active {
        return Err("System VPN profile changed since it was displayed; refresh before retrying".into());
    }
    Ok(())
}

fn observed_state(before:&VpnProfile, profiles:&[VpnProfile], connect:bool)->Result<bool,String> {
    let current=profiles.iter().find(|p|p.id.eq_ignore_ascii_case(&before.id))
        .ok_or("System VPN profile disappeared after the action")?;
    if current.name!=before.name || current.kind!=before.kind || !current.control_allowed {
        return Err("System VPN profile changed during the action; refresh before retrying".into());
    }
    Ok(current.active==connect)
}

fn wait_for_state(before:&VpnProfile, connect:bool)->Result<Vec<VpnProfile>,String> {
    let deadline=Instant::now()+Duration::from_secs(5);
    loop {
        let profiles=list_impl_until(deadline)?;
        if observed_state(before,&profiles,connect)? {return Ok(profiles);}
        if Instant::now()>=deadline {
            return Err("System VPN manager accepted the request, but the profile did not reach the requested state; refresh its status".into());
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

fn remaining(deadline:Instant)->Result<Duration,String> {
    let left=deadline.saturating_duration_since(Instant::now());
    if left.is_zero() {Err("System VPN manager timed out".into())} else {Ok(left)}
}

/// Capture only bounded, non-secret fields. Neither stdout nor stderr may
/// appear in UI errors: OS tools can echo profile configuration. A hung tool
/// must not hold the process-wide mutation guard indefinitely.
fn output(mut command:Command) -> Result<String,String> {
    output_with_timeout(&mut command,Duration::from_secs(35))
}
fn output_with_timeout(command:&mut Command,timeout:Duration)->Result<String,String> {
    const MAX_OUTPUT:u64=256*1024;
    let mut child=command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null())
        .spawn().map_err(|_|"System VPN manager not installed or unavailable".to_string())?;
    let mut stdout=child.stdout.take().ok_or("System VPN manager output unavailable")?;
    let (tx,rx)=std::sync::mpsc::channel();
    let reader=std::thread::spawn(move || {
        let mut bytes=Vec::new();
        let result=stdout.take(MAX_OUTPUT+1).read_to_end(&mut bytes).map(|_|bytes);
        let _=tx.send(result);
    });
    let deadline=Instant::now()+timeout;
    let mut captured=None;
    let status=loop {
        if captured.is_none() {
            if let Ok(result)=rx.try_recv() {
                match result {
                    Ok(bytes) if bytes.len() as u64>MAX_OUTPUT => {
                        let _=child.kill(); let _=child.wait(); let _=reader.join();
                        return Err("System VPN manager output exceeded the safe limit".into());
                    }
                    Ok(bytes)=>captured=Some(bytes),
                    Err(_)=>{
                        let _=child.kill(); let _=child.wait(); let _=reader.join();
                        return Err("Cannot read system VPN manager output".into());
                    }
                }
            }
        }
        match child.try_wait() {
            Ok(Some(status))=>break status,
            Ok(None) if Instant::now()<deadline=>std::thread::sleep(Duration::from_millis(20)),
            Ok(None)=>{
                let _=child.kill(); let _=child.wait(); let _=reader.join();
                return Err("System VPN manager timed out".into());
            }
            Err(_)=>{
                let _=child.kill(); let _=child.wait(); let _=reader.join();
                return Err("Cannot check system VPN manager status".into());
            }
        }
    };
    let _=reader.join();
    let bytes=match captured {Some(bytes)=>bytes,None=>rx.recv().map_err(|_|"Cannot read system VPN manager output".to_string())?
        .map_err(|_|"Cannot read system VPN manager output".to_string())?};
    if bytes.len() as u64>MAX_OUTPUT {return Err("System VPN manager output exceeded the safe limit".into());}
    if !status.success() { return Err("System VPN manager rejected the request".into()); }
    String::from_utf8(bytes).map_err(|_|"System VPN manager returned invalid UTF-8".into())
}

#[cfg(target_os="linux")]
fn nmcli(args:&[&str])->Result<String,String> {
    let mut cmd=Command::new("/usr/bin/nmcli");
    cmd.args(args);
    output(cmd)
}
#[cfg(target_os="linux")]
fn nmcli_until(args:&[&str],deadline:Instant)->Result<String,String> {
    let mut cmd=Command::new("/usr/bin/nmcli");
    cmd.args(args);
    output_with_timeout(&mut cmd,remaining(deadline)?)
}
/// Unknown NetworkManager VPN plugins are displayed read-only.
#[cfg(target_os="linux")]
fn classify_nm_vpn(kind:&str,service:&str)->(&'static str,bool) {
    match (kind,service.trim()) {
        ("wireguard",_)=>("WireGuard",true),
        ("vpn","org.freedesktop.NetworkManager.openvpn")=>("OpenVPN",true),
        ("vpn","org.freedesktop.NetworkManager.openconnect")=>("OpenConnect",true),
        ("vpn",_)=>("Other VPN (read-only)",false),
        _=>("Unsupported",false)
    }
}
#[cfg(target_os="linux")]
fn list_impl()->Result<Vec<VpnProfile>,String> {
    list_impl_until(Instant::now()+Duration::from_secs(35))
}
#[cfg(target_os="linux")]
fn list_impl_until(deadline:Instant)->Result<Vec<VpnProfile>,String> {
    // UUID/TYPE are safe for terse parsing; profile names may contain colon
    // and are retrieved separately by exact OS UUID, with no --show-secrets.
    let configured=nmcli_until(&["-t","-f","UUID,TYPE","connection","show"],deadline)?;
    let active=nmcli_until(&["-t","-f","UUID","connection","show","--active"],deadline)?;
    let active_ids:HashSet<&str>=active.lines().filter(|s|uuid_ok(s)).collect();
    let mut profiles=Vec::new();
    let mut seen=HashSet::new();
    for line in configured.lines() {
        let Some((uuid,kind))=line.split_once(':') else {continue};
        if !uuid_ok(uuid)|| !matches!(kind,"vpn"|"wireguard") || !seen.insert(uuid) {continue}
        if profiles.len()>=100 {return Err("Too many VPN profiles".into());}
        let name=nmcli_until(&["-g","connection.id","connection","show","uuid",uuid],deadline)?;
        let name=name.trim_end_matches(['\r','\n']);
        if !safe_name(name) {continue;}
        // Read only the plugin service type, never vpn.secrets or vpn.data.
        // Unknown plugins are fail-closed, not allowed for NodeDesk actions.
        let service=if kind=="vpn" {
            match nmcli_until(&["-g","vpn.service-type","connection","show","uuid",uuid],deadline) {
                Ok(service)=>service,
                Err(_)=>{remaining(deadline)?; String::new()} // unknown service stays read-only
            }
        } else {String::new()};
        let (display_kind,control_allowed)=classify_nm_vpn(kind,&service);
        profiles.push(VpnProfile {
            id:uuid.to_ascii_lowercase(),name:name.into(),kind:display_kind.into(),
            active:active_ids.contains(uuid),control_allowed,
        });
    }
    profiles.sort_by(|a,b|a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(profiles)
}
#[cfg(target_os="linux")]
fn execute_impl(profile:&VpnProfile,connect:bool)->Result<(),String> {
    let verb=if connect {"up"} else {"down"};
    // Explicit UUID keyword prevents accidentally operating on a different
    // connection with the same display name. -w bounds nmcli waiting.
    nmcli(&["-w","30","connection",verb,"uuid",&profile.id]).map(|_|())
}

#[cfg(windows)]
fn windows_tool(suffix:&[&str])->Result<Command,String> {
    let root=std::env::var_os("SystemRoot").ok_or("Windows system directory unavailable")?;
    let path=std::path::PathBuf::from(root).join(suffix.iter().collect::<std::path::PathBuf>());
    if !path.is_file() {return Err("Windows VPN management tools not available".into());}
    Ok(Command::new(path))
}
#[cfg(windows)]
const WINDOWS_QUERY:&str=r#"
 $ErrorActionPreference='Stop'
 [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
 $rows = @()
 foreach($p in @(Get-VpnConnection)) {
   if([string]$p.TunnelType -notin @('Ikev2','Sstp','L2tp')) { continue }
   $rows += [pscustomobject]@{
     id=(([string]$p.Guid) -replace '[{}]','').ToLowerInvariant()
     name=[string]$p.Name
     kind=[string]$p.TunnelType
     active=([string]$p.ConnectionStatus -eq 'Connected')
     controlAllowed=([string]$p.EncryptionLevel -in @('Required','Maximum'))
   }
 }
 ConvertTo-Json -InputObject $rows -Compress -Depth 2
"#;
#[cfg(windows)]
fn parse_windows_profiles(raw:&str)->Result<Vec<VpnProfile>,String> {
    let profiles:Vec<VpnProfile>=serde_json::from_str(raw.trim())
        .map_err(|_|"Windows VPN profile status could not be parsed".to_string())?;
    if profiles.len()>100 {return Err("Too many VPN profiles".into());}
    let mut ids=HashSet::new();
    Ok(profiles.into_iter().filter(|p| uuid_ok(&p.id) && safe_name(&p.name)
        && ids.insert(p.id.clone()) && matches!(p.kind.as_str(),"Ikev2"|"L2tp"|"Sstp"))
        .collect())
}
#[cfg(windows)]
fn list_impl()->Result<Vec<VpnProfile>,String> {
    list_impl_until(Instant::now()+Duration::from_secs(35))
}
#[cfg(windows)]
fn list_impl_until(deadline:Instant)->Result<Vec<VpnProfile>,String> {
    // The script is static and reads user-scope Windows built-in phonebook
    // profiles only. Never reads/returns EAP XML, PSK, credentials, server URLs
    // or routes. VPN types known to be insecure/ambiguous are excluded.
    let mut cmd=windows_tool(&["System32","WindowsPowerShell","v1.0","powershell.exe"])?;
    cmd.args(["-NoProfile","-NonInteractive","-Command",WINDOWS_QUERY]);
    let raw=output_with_timeout(&mut cmd,remaining(deadline)?)?;
    parse_windows_profiles(&raw)
}
#[cfg(windows)]
fn execute_impl(profile:&VpnProfile,connect:bool)->Result<(),String> {
    // rasdial uses saved Windows system credentials only. No password/username
    // is passed, and stdin is closed so missing credentials fail rather than
    // being captured in this application's UI or logs.
    if !safe_name(&profile.name)|| profile.name.starts_with('/')||profile.name.starts_with('-') {
        return Err("Unsafe Windows VPN profile name".into());
    }
    let mut cmd=windows_tool(&["System32","rasdial.exe"])?;
    cmd.arg(&profile.name);
    if !connect {cmd.arg("/disconnect");}
    output(cmd).map(|_|())
}
#[cfg(not(any(windows,target_os="linux")))]
fn list_impl()->Result<Vec<VpnProfile>,String>{Err("VPN manager is supported only on Windows and Linux".into())}
#[cfg(not(any(windows,target_os="linux")))]
fn list_impl_until(_deadline:Instant)->Result<Vec<VpnProfile>,String>{list_impl()}
#[cfg(not(any(windows,target_os="linux")))]
fn execute_impl(_profile:&VpnProfile,_connect:bool)->Result<(),String>{
    Err("VPN manager is supported only on Windows and Linux".into())
}

#[tauri::command]
pub async fn vpn_list()->Result<Vec<VpnProfile>,String>{
    tauri::async_runtime::spawn_blocking(list_impl).await
        .map_err(|_|"VPN list worker failed".to_string())?
}
#[tauri::command]
pub async fn vpn_set(actions:tauri::State<'_,VpnActions>,profile_id:String,expected_name:String,expected_kind:String,expected_active:bool,connect:bool)->Result<Vec<VpnProfile>,String>{
    if !uuid_ok(&profile_id) {return Err("Invalid system VPN profile ID".into());}
    // The guard belongs to the spawned worker, not the IPC future.
    let guard=actions.acquire()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard=guard;
        // Recheck the exact profile, its current kind and active state at the
        // time of the user-approved action. WebView cannot choose arbitrary
        // system connection names or execute shell/PowerShell text.
        let before=list_impl()?;
        let selected=before.iter().find(|p|p.id.eq_ignore_ascii_case(&profile_id))
            .ok_or("System VPN profile is missing or unsupported")?;
        verify_request_snapshot(selected,&expected_name,&expected_kind,expected_active)?;
        require_control_allowed(selected)?;
        if selected.active!=connect {execute_impl(selected,connect)?;}
        // A successful OS command is not proof of a connected/disconnected
        // profile. Poll the OS for a bounded time and reject stale identity.
        // This still does not prove route, DNS or traffic correctness.
        wait_for_state(selected,connect)
    }).await.map_err(|_|"VPN action worker failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn vpn_enumeration_rejects_an_expired_total_deadline() {
        let expired=Instant::now()-Duration::from_millis(1);
        assert_eq!(remaining(expired).unwrap_err(),"System VPN manager timed out");
        #[cfg(any(windows,target_os="linux"))]
        assert_eq!(list_impl_until(expired).unwrap_err(),"System VPN manager timed out");
    }
    #[test]
    fn vpn_manager_timeout_releases_a_hung_process() {
        #[cfg(windows)] let mut command={
            let mut c=windows_tool(&["System32","WindowsPowerShell","v1.0","powershell.exe"]).unwrap();
            c.args(["-NoProfile","-NonInteractive","-Command","Start-Sleep -Seconds 5"]); c
        };
        #[cfg(not(windows))] let mut command=Command::new("sleep");
        #[cfg(not(windows))] command.arg("5");
        let start=Instant::now();
        assert_eq!(output_with_timeout(&mut command,Duration::from_millis(100)).unwrap_err(),
            "System VPN manager timed out");
        assert!(start.elapsed()<Duration::from_secs(3));
    }
    #[cfg(target_os="linux")]
    #[test]
    fn vpn_manager_caps_streaming_output_and_never_exposes_it() {
        let mut command=Command::new("yes"); command.arg("fixture-private-profile");
        let error=output_with_timeout(&mut command,Duration::from_secs(3)).unwrap_err();
        assert_eq!(error,"System VPN manager output exceeded the safe limit");
        assert!(!error.contains("fixture-private-profile"));
    }
    #[cfg(windows)]
    #[test]
    fn windows_vpn_manager_caps_streaming_output_and_never_exposes_it() {
        let mut command=windows_tool(&["System32","WindowsPowerShell","v1.0","powershell.exe"]).unwrap();
        command.args(["-NoProfile","-NonInteractive","-Command","[Console]::Write('fixture-private-profile' * 15000)"]);
        let error=output_with_timeout(&mut command,Duration::from_secs(10)).unwrap_err();
        assert_eq!(error,"System VPN manager output exceeded the safe limit");
        assert!(!error.contains("fixture-private-profile"));
    }
    #[test]
    fn vpn_mutations_are_single_flight_and_release_after_completion() {
        let actions=std::sync::Arc::new(VpnActions::default());
        let worker_actions=std::sync::Arc::clone(&actions);
        let held=actions.acquire().unwrap();
        let contender=std::thread::spawn(move || worker_actions.acquire().is_err());
        assert!(contender.join().unwrap(), "competing VPN action must fail closed");
        drop(held);
        let after=actions.acquire().unwrap();
        assert!(actions.acquire().is_err());
        drop(after);
        assert!(actions.acquire().is_ok());
    }

    #[test]
    fn vpn_mutation_guard_is_owned_by_the_worker() {
        let actions=std::sync::Arc::new(VpnActions::default());
        let held=actions.acquire().unwrap();
        let (entered_tx,entered_rx)=std::sync::mpsc::channel();
        let (finish_tx,finish_rx)=std::sync::mpsc::channel::<()>();
        let worker=std::thread::spawn(move || {
            let _guard=held;
            entered_tx.send(()).unwrap();
            finish_rx.recv().unwrap();
        });
        entered_rx.recv().unwrap();
        assert!(actions.acquire().is_err());
        finish_tx.send(()).unwrap();
        worker.join().unwrap();
        assert!(actions.acquire().is_ok());
    }

    #[test]
    fn profile_identifiers_are_strict_and_names_never_contain_control_chars() {
        for good in ["123e4567-e89b-12d3-a456-426614174000",
                     "123E4567-E89B-12D3-A456-426614174000"] {assert!(uuid_ok(good));}
        for bad in ["","vpn", "0", "123e4567-e89b-12d3-a456-42661417400Z",
                    "123e4567/e89b/12d3/a456/426614174000","--","00000000-0000-0000-0000-000000000000;echo"]{
            assert!(!uuid_ok(bad),"{bad:?} unexpectedly accepted");
        }
        assert!(safe_name("Офисный VPN — IKEv2"));
        assert!(!safe_name("injected\nname"));
    }
    #[test]
    fn serde_never_accepts_or_serializes_secret_fields() {
        let profile:VpnProfile=serde_json::from_str(r#"{"id":"123e4567-e89b-12d3-a456-426614174000","name":"Lab","kind":"vpn","active":false,"password":"sensitive"}"#).unwrap();
        assert_eq!(profile.name,"Lab");
        let serialized=serde_json::to_string(&profile).unwrap();
        assert!(!serialized.contains("sensitive"));
        assert!(!serialized.contains("password"));
    }
    #[test]
    fn vpn_request_rejects_stale_or_reused_profile_before_os_side_effects() {
        let baseline=VpnProfile{id:"123e4567-e89b-12d3-a456-426614174000".into(),
            name:"Disposable fixture".into(),kind:"WireGuard".into(),
            active:false,control_allowed:true};
        assert!(verify_request_snapshot(&baseline,"Disposable fixture","WireGuard",false).is_ok());
        assert!(verify_request_snapshot(&baseline,"Other name","WireGuard",false).is_err());
        assert!(verify_request_snapshot(&baseline,"Disposable fixture","OpenVPN",false).is_err());
        assert!(verify_request_snapshot(&baseline,"Disposable fixture","WireGuard",true).is_err());
        assert!(verify_request_snapshot(&baseline,"bad\nname","WireGuard",false).is_err());
        assert!(verify_request_snapshot(&baseline,"Disposable fixture","bad\rkind",false).is_err());
        let changed=VpnProfile{name:"Replaced profile".into(),..baseline.clone()};
        assert!(verify_request_snapshot(&changed,&baseline.name,&baseline.kind,baseline.active).is_err());
        let replaced=VpnProfile{kind:"Other VPN (read-only)".into(),
            control_allowed:false,..baseline.clone()};
        assert!(verify_request_snapshot(&replaced,&baseline.name,&baseline.kind,baseline.active).is_err());
    }
    #[test]
    fn vpn_action_requires_observed_state_and_stable_profile() {
        let before=VpnProfile{id:"123e4567-e89b-12d3-a456-426614174000".into(),
            name:"Disposable fixture".into(),kind:"WireGuard".into(),
            active:false,control_allowed:true};
        assert!(!observed_state(&before,&[before.clone()],true).unwrap());
        let connected=VpnProfile{active:true,..before.clone()};
        assert!(observed_state(&before,&[connected.clone()],true).unwrap());
        assert!(!observed_state(&connected,&[connected.clone()],false).unwrap());
        assert!(observed_state(&connected,&[before.clone()],false).unwrap());
        assert!(observed_state(&before,&[],true).is_err());
        assert!(observed_state(&before,&[VpnProfile{name:"Different".into(),..connected.clone()}],true).is_err());
        assert!(observed_state(&before,&[VpnProfile{kind:"Other VPN (read-only)".into(),
            control_allowed:false,..connected}],true).is_err());
    }
    #[cfg(windows)]
    #[test]
    fn windows_read_only_query_filters_mocked_profiles_and_secrets() {
        // A same-named function shadows the OS cmdlet. No real VPN is read or dialed.
        let mock=r#"
function Get-VpnConnection {
  @(
    [pscustomobject]@{Guid='{123e4567-e89b-12d3-a456-426614174000}';Name='Work L2TP';TunnelType='L2tp';EncryptionLevel='Required';ConnectionStatus='Disconnected';ServerAddress='private.example';L2tpIPsecAuth='Psk'},
    [pscustomobject]@{Guid='{123e4567-e89b-12d3-a456-426614174001}';Name='Connected IKE';TunnelType='Ikev2';EncryptionLevel='Maximum';ConnectionStatus='Connected';ServerAddress='private.example'},
    [pscustomobject]@{Guid='{123e4567-e89b-12d3-a456-426614174002}';Name='Optional L2TP';TunnelType='L2tp';EncryptionLevel='Optional';ConnectionStatus='Disconnected'},
    [pscustomobject]@{Guid='{123e4567-e89b-12d3-a456-426614174003}';Name='PPTP';TunnelType='Pptp';EncryptionLevel='Required';ConnectionStatus='Connected'}
  )
}
"#;
        let mut cmd=windows_tool(&["System32","WindowsPowerShell","v1.0","powershell.exe"]).unwrap();
        cmd.args(["-NoProfile","-NonInteractive","-Command",&format!("{mock}\n{WINDOWS_QUERY}")]);
        let raw=output(cmd).unwrap();
        assert!(!raw.contains("private.example"));
        assert!(!raw.contains("Psk"));
        let profiles=parse_windows_profiles(&raw).unwrap();
        assert_eq!(profiles.len(),3);
        assert_eq!(profiles[0].name,"Work L2TP");
        assert_eq!(profiles[0].kind,"L2tp");
        assert!(!profiles[0].active);
        assert!(profiles[0].control_allowed);
        assert!(profiles[1].active);
        assert!(profiles[1].control_allowed);
        assert_eq!(profiles[2].name,"Optional L2TP");
        assert!(!profiles[2].control_allowed);
        assert!(require_control_allowed(&profiles[2]).is_err());
    }
    #[cfg(windows)]
    #[test]
    fn windows_parser_rejects_malformed_and_unsupported_mock_data() {
        assert!(parse_windows_profiles("not json").is_err());
        assert!(parse_windows_profiles(r#"[{"id":"bad","name":"Work","kind":"L2tp","active":false}]"#).unwrap().is_empty());
        assert!(parse_windows_profiles(r#"[{"id":"123e4567-e89b-12d3-a456-426614174000","name":"Work","kind":"Pptp","active":false}]"#).unwrap().is_empty());
        assert!(parse_windows_profiles(r#"[{"id":"123e4567-e89b-12d3-a456-426614174000","name":"Bad\nName","kind":"L2tp","active":false}]"#).unwrap().is_empty());
    }
    #[cfg(target_os="linux")]
    #[test] fn linux_control_allowlist_filters_unknown_vpn_plugins(){
        assert_eq!(classify_nm_vpn("wireguard",""),("WireGuard",true));
        assert_eq!(classify_nm_vpn("vpn","org.freedesktop.NetworkManager.openvpn"),("OpenVPN",true));
        assert_eq!(classify_nm_vpn("vpn","org.freedesktop.NetworkManager.openconnect"),("OpenConnect",true));
        for service in ["org.freedesktop.NetworkManager.pptp",
            "org.freedesktop.NetworkManager.vpnc",
            "org.freedesktop.NetworkManager.strongswan","unknown",""] {
            assert_eq!(classify_nm_vpn("vpn",service),("Other VPN (read-only)",false));
        }
        let p=VpnProfile{id:"123e4567-e89b-12d3-a456-426614174000".into(),
            name:"Unknown plugin".into(),kind:"Other VPN (read-only)".into(),
            active:false,control_allowed:false};
        assert!(require_control_allowed(&p).is_err());
    }
    #[cfg(target_os="linux")]
    #[test]
    fn missing_nmcli_returns_a_clear_error_without_network_action() {
        if !std::path::Path::new("/usr/bin/nmcli").exists() {
            assert_eq!(list_impl().unwrap_err(),"System VPN manager not installed or unavailable");
        }
    }
}
