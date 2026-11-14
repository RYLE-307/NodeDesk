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

/// Presence of OS-reported routes/DNS on this active profile. This does not
/// prove that traffic or DNS queries traverse the VPN correctly.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all="camelCase")]
pub struct VpnHealth {
    profile_id:String,
    active:bool,
    route_configured:Option<bool>,
    dns_configured:Option<bool>,
}

/// Process-wide guard for mutations of system-owned VPN profiles.
/// The worker owns this guard: cancelling an IPC call cannot unlock it while
/// a blocking OS command is still running.
#[derive(Default)]
pub struct VpnActions { busy:Arc<AtomicBool>, importing:Arc<AtomicBool>, cancel_import:Arc<AtomicBool>, setting:Arc<AtomicBool>, cancel_set:Arc<AtomicBool> }

struct VpnActionGuard { busy:Arc<AtomicBool>, importing:Arc<AtomicBool>, cancel_import:Arc<AtomicBool>, setting:Arc<AtomicBool>, cancel_set:Arc<AtomicBool> }

impl VpnActions {
    fn acquire(&self)->Result<VpnActionGuard,String> {
        self.busy.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire)
            .map_err(|_| "Another system VPN action is already in progress".to_string())?;
        self.cancel_import.store(false,Ordering::Release);
        self.importing.store(false,Ordering::Release);
        self.cancel_set.store(false,Ordering::Release);
        self.setting.store(false,Ordering::Release);
        Ok(VpnActionGuard{busy:Arc::clone(&self.busy),importing:Arc::clone(&self.importing),
            cancel_import:Arc::clone(&self.cancel_import),setting:Arc::clone(&self.setting),
            cancel_set:Arc::clone(&self.cancel_set)})
    }
}

impl Drop for VpnActionGuard {
    fn drop(&mut self) {
        self.cancel_import.store(false,Ordering::Release);
        self.importing.store(false,Ordering::Release);
        self.cancel_set.store(false,Ordering::Release);
        self.setting.store(false,Ordering::Release);
        self.busy.store(false,Ordering::Release);
    }
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

fn wait_for_state(before:&VpnProfile, connect:bool, cancel:&AtomicBool)->Result<Vec<VpnProfile>,String> {
    let deadline=Instant::now()+Duration::from_secs(5);
    loop {
        if cancel.load(Ordering::Acquire) {return Err("VPN action cancelled; refresh system profiles because the OS state may have changed".into());}
        let profiles=list_impl_until(deadline)?;
        if cancel.load(Ordering::Acquire) {return Err("VPN action cancelled; refresh system profiles because the OS state may have changed".into());}
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
    output_with_timeout_and_cancel(command,timeout,None)
}
fn output_with_timeout_and_cancel(command:&mut Command,timeout:Duration,
    cancel:Option<&AtomicBool>)->Result<String,String> {
    const MAX_OUTPUT:u64=256*1024;
    if cancel.is_some_and(|flag|flag.load(Ordering::Acquire)) {
        return Err("VPN action cancelled; refresh system profiles because the OS state may have changed".into());
    }
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
        if cancel.is_some_and(|flag|flag.load(Ordering::Acquire)) {
            let _=child.kill(); let _=child.wait(); let _=reader.join();
            return Err("VPN action cancelled; refresh system profiles because the OS state may have changed".into());
        }
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
#[cfg(target_os="linux")]
fn import_file(kind:&str,path:&str)->Result<std::path::PathBuf,String> {
    use std::os::unix::fs::PermissionsExt;
    let expected=match kind {"WireGuard"=>"conf","OpenVPN"=>"ovpn",
        _=>return Err("Unsupported VPN import type".into())};
    let source=std::path::Path::new(path);
    if !source.is_absolute() || path.len()>4096 || path.chars().any(char::is_control)
        || source.extension().and_then(|x|x.to_str())!=Some(expected) {
        return Err("Invalid VPN import file".into());
    }
    let metadata=std::fs::symlink_metadata(source)
        .map_err(|_|"VPN import file is unavailable".to_string())?;
    if !metadata.file_type().is_file() || metadata.len()==0 || metadata.len()>256*1024 {
        return Err("VPN import requires a regular file of at most 256 KiB".into());
    }
    if metadata.permissions().mode() & 0o077 != 0 {
        return Err("VPN import file must be private to its owner (mode 0600)".into());
    }
    let source=source.canonicalize().map_err(|_|"VPN import file is unavailable".to_string())?;
    let parent=source.parent().ok_or("Invalid VPN import file")?;
    let permissions=std::fs::metadata(parent)
        .map_err(|_|"VPN import directory is unavailable".to_string())?;
    if !permissions.is_dir() {return Err("Invalid VPN import directory".into());}
    Ok(source)
}
#[cfg(target_os="linux")]
fn import_with_tool(tool:&std::path::Path,kind:&str,source:&std::path::Path,
    cancel:Option<&AtomicBool>)->Result<String,String> {
    let plugin=match kind {"WireGuard"=>"wireguard","OpenVPN"=>"openvpn",
        _=>return Err("Unsupported VPN import type".into())};
    let mut command=Command::new(tool);
    command.args(["-w","30","connection","import","--temporary","type",plugin,"file"]);
    command.arg(source);
    command.env("LC_ALL","C");
    let output=output_with_timeout_and_cancel(&mut command,Duration::from_secs(35),cancel)?;
    imported_uuid(&output)
}
#[cfg(target_os="linux")]
fn imported_uuid(output:&str)->Result<String,String> {
    let ids:Vec<_>=output.lines().filter_map(|line|line.trim_end()
        .strip_suffix(") successfully added.")
        .and_then(|prefix|prefix.strip_prefix("Connection '"))
        .and_then(|prefix|prefix.rsplit_once(" (").map(|(_,id)|id))
        .filter(|id|uuid_ok(id))).collect();
    if ids.len()!=1 {return Err("VPN import identity unavailable; inspect NetworkManager".into());}
    Ok(ids[0].to_ascii_lowercase())
}
#[cfg(target_os="linux")]
fn imported_profile(before:&[VpnProfile],after:&[VpnProfile],kind:&str)
    ->Result<VpnProfile,String> {
    let added:Vec<_>=after.iter().filter(|profile| !before.iter()
        .any(|old|old.id.eq_ignore_ascii_case(&profile.id))).collect();
    if added.len()!=1 {return Err("VPN import did not produce exactly one visible profile; inspect NetworkManager".into());}
    let profile=added[0];
    if !uuid_ok(&profile.id) || profile.kind!=kind || profile.active || !profile.control_allowed
        || before.iter().any(|old|old.name.eq_ignore_ascii_case(&profile.name)) {
        return Err("Imported VPN profile conflicts with existing state or became active".into());
    }
    Ok((*profile).clone())
}
#[cfg(target_os="linux")]
fn run_nmcli_tool(tool:&std::path::Path,args:&[&str])->Result<(),String> {
    let mut command=Command::new(tool);
    command.args(args);
    output(command).map(|_|())
}
#[cfg(target_os="linux")]
fn rollback_import_with_tool(tool:&std::path::Path,id:&str)->Result<(),String> {
    if !uuid_ok(id) {return Err("Temporary VPN profile may remain; inspect NetworkManager".into());}
    run_nmcli_tool(tool,&["-w","30","connection","delete","uuid",id])
        .map_err(|_|"Temporary VPN profile may remain; inspect NetworkManager".into())
}
#[cfg(target_os="linux")]
fn rollback_import(id:&str)->Result<(),String> {
    rollback_import_with_tool(std::path::Path::new("/usr/bin/nmcli"),id)
}
#[cfg(target_os="linux")]
fn restrict_import_with_tool(tool:&std::path::Path,id:&str,username:&str)->Result<(),String> {
    if !uuid_ok(id) || username.is_empty() || username.len()>64 || !username.bytes()
        .all(|b|b.is_ascii_alphanumeric()||b"_.-".contains(&b)) {
        return Err("Invalid VPN profile restriction".into());
    }
    let private=format!("user:{username}:");
    run_nmcli_tool(tool,&["-w","30","connection","modify","uuid",id,
        "connection.autoconnect","no","connection.permissions",&private])
}
#[cfg(target_os="linux")]
fn import_impl(kind:&str,path:&str,cancel:&AtomicBool)->Result<Vec<VpnProfile>,String> {
    let source=import_file(kind,path)?;
    let username=std::env::var("USER").map_err(|_|"Current OS user unavailable")?;
    if username.is_empty() || username.len()>64 || !username.bytes()
        .all(|b|b.is_ascii_alphanumeric()||b"_.-".contains(&b)) {
        return Err("Current OS user cannot be used for a private VPN profile".into());
    }
    if cancel.load(Ordering::Acquire) {return Err("VPN import cancelled".into());}
    let before=list_impl()?;
    let stem=source.file_stem().and_then(|s|s.to_str()).ok_or("Invalid VPN import file")?;
    if before.iter().any(|profile|profile.name.eq_ignore_ascii_case(stem)) {
        return Err("A VPN profile with this file name already exists".into());
    }
    if cancel.load(Ordering::Acquire) {return Err("VPN import cancelled".into());}
    // Only the UUID returned by this invocation may be restricted or rolled
    // back. A concurrent external import can appear in the before/after diff.
    let imported_id=import_with_tool(std::path::Path::new("/usr/bin/nmcli"),kind,&source,Some(cancel))?;
    if before.iter().any(|profile|profile.id.eq_ignore_ascii_case(&imported_id)) {
        return Err("VPN import identity conflicts with existing state; inspect NetworkManager".into());
    }
    // Import is temporary until the new UUID and access restrictions are checked.
    let after=list_impl().map_err(|_|{
        let _=rollback_import(&imported_id);
        "VPN import may have completed; inspect NetworkManager".to_string()
    })?;
    let added:Vec<_>=after.iter().filter(|profile|!before.iter()
        .any(|old|old.id.eq_ignore_ascii_case(&profile.id))).collect();
    if added.len()!=1 || !added[0].id.eq_ignore_ascii_case(&imported_id) {
        rollback_import(&imported_id)?;
        return Err("VPN import produced an ambiguous profile; inspect NetworkManager".into());
    }
    let imported=added[0];
    let valid=imported_profile(&before,&after,kind);
    if valid.is_err() || cancel.load(Ordering::Acquire) {
        rollback_import(&imported.id)?;
        return Err(valid.err().unwrap_or_else(||"VPN import cancelled".into()));
    }
    if restrict_import_with_tool(std::path::Path::new("/usr/bin/nmcli"),&imported.id,&username).is_err() {
        rollback_import(&imported.id)?;
        return Err("Cannot restrict imported VPN profile; inspect NetworkManager".into());
    }
    let final_profiles=list_impl().map_err(|_|"VPN profile imported but status cannot be verified".to_string())?;
    let final_profile=final_profiles.iter().find(|profile|profile.id.eq_ignore_ascii_case(&imported.id))
        .ok_or("Imported VPN profile disappeared")?;
    if final_profile.active || final_profile.kind!=kind || cancel.load(Ordering::Acquire) {
        rollback_import(&imported.id)?;
        return Err("Imported VPN profile changed or import was cancelled".into());
    }
    Ok(final_profiles)
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
fn execute_impl(profile:&VpnProfile,connect:bool,cancel:&AtomicBool)->Result<(),String> {
    execute_with_tool(std::path::Path::new("/usr/bin/nmcli"),profile,connect,cancel)
}
#[cfg(target_os="linux")]
fn execute_with_tool(tool:&std::path::Path,profile:&VpnProfile,connect:bool,cancel:&AtomicBool)->Result<(),String> {
    let verb=if connect {"up"} else {"down"};
    // Explicit UUID keyword prevents accidentally operating on a different
    // connection with the same display name. -w bounds nmcli waiting.
    let mut command=Command::new(tool);
    command.args(["-w","30","connection",verb,"uuid",&profile.id]);
    output_with_timeout_and_cancel(&mut command,Duration::from_secs(35),Some(cancel)).map(|_|())
}

#[cfg(target_os="linux")]
fn health_impl(profile:&VpnProfile)->VpnHealth {
    let mut health=VpnHealth{profile_id:profile.id.clone(),active:profile.active,
        route_configured:None,dns_configured:None};
    if !profile.active{return health;}
    let deadline=Instant::now()+Duration::from_secs(10);
    // Active UUID, not display name. Capture no raw addresses in the result.
    health.route_configured=nmcli_until(&["-g","IP4.ROUTE,IP6.ROUTE", "connection",
        "show","--active","uuid",&profile.id],deadline).ok()
        .map(|v|!v.trim().is_empty());
    health.dns_configured=nmcli_until(&["-g","IP4.DNS,IP6.DNS", "connection",
        "show","--active","uuid",&profile.id],deadline).ok()
        .map(|v|!v.trim().is_empty());
    health
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
fn execute_impl(profile:&VpnProfile,connect:bool,cancel:&AtomicBool)->Result<(),String> {
    // rasdial uses saved Windows system credentials only. No password/username
    // is passed, and stdin is closed so missing credentials fail rather than
    // being captured in this application's UI or logs.
    if !safe_name(&profile.name)|| profile.name.starts_with('/')||profile.name.starts_with('-') {
        return Err("Unsafe Windows VPN profile name".into());
    }
    let mut cmd=windows_tool(&["System32","rasdial.exe"])?;
    cmd.arg(&profile.name);
    if !connect {cmd.arg("/disconnect");}
    output_with_timeout_and_cancel(&mut cmd,Duration::from_secs(35),Some(cancel)).map(|_|())
}

#[cfg(windows)]
const WINDOWS_HEALTH:&str=r#"
 $ErrorActionPreference='Stop'
 [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
 $alias = $env:NODEDESK_VPN_ALIAS
 $iface = @(Get-NetIPInterface -InterfaceAlias $alias -ErrorAction SilentlyContinue)
 if($iface.Count -eq 0) {
   [pscustomobject]@{routeConfigured=$null;dnsConfigured=$null} | ConvertTo-Json -Compress
 } else {
   $ids = @($iface | Select-Object -ExpandProperty InterfaceIndex -Unique)
   $routes = @(Get-NetRoute -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.InterfaceIndex })
   $dns = @(Get-DnsClientServerAddress -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.InterfaceIndex -and @($_.ServerAddresses).Count -gt 0 })
   [pscustomobject]@{routeConfigured=($routes.Count -gt 0);dnsConfigured=($dns.Count -gt 0)} | ConvertTo-Json -Compress
 }
"#;
#[cfg(windows)]
fn health_impl(profile:&VpnProfile)->VpnHealth {
    let mut health=VpnHealth{profile_id:profile.id.clone(),active:profile.active,
        route_configured:None,dns_configured:None};
    if !profile.active{return health;}
    let Ok(mut cmd)=windows_tool(&["System32","WindowsPowerShell","v1.0","powershell.exe"])
        else {return health};
    cmd.args(["-NoProfile","-NonInteractive","-Command",WINDOWS_HEALTH]);
    cmd.env("NODEDESK_VPN_ALIAS",&profile.name);
    if let Ok(raw)=output_with_timeout(&mut cmd,Duration::from_secs(10)) {
        #[derive(Deserialize)] #[serde(rename_all="camelCase")]
        struct Status {route_configured:Option<bool>,dns_configured:Option<bool>}
        if let Ok(status)=serde_json::from_str::<Status>(raw.trim()) {
            health.route_configured=status.route_configured;
            health.dns_configured=status.dns_configured;
        }
    }
    health
}
#[cfg(not(any(windows,target_os="linux")))]
fn list_impl()->Result<Vec<VpnProfile>,String>{Err("VPN manager is supported only on Windows and Linux".into())}
#[cfg(not(any(windows,target_os="linux")))]
fn list_impl_until(_deadline:Instant)->Result<Vec<VpnProfile>,String>{list_impl()}
#[cfg(not(any(windows,target_os="linux")))]
fn execute_impl(_profile:&VpnProfile,_connect:bool,_cancel:&AtomicBool)->Result<(),String>{
    Err("VPN manager is supported only on Windows and Linux".into())
}
#[cfg(not(any(windows,target_os="linux")))]
fn health_impl(profile:&VpnProfile)->VpnHealth {
    VpnHealth{profile_id:profile.id.clone(),active:profile.active,
        route_configured:None,dns_configured:None}
}

#[tauri::command]
pub async fn vpn_list()->Result<Vec<VpnProfile>,String>{
    tauri::async_runtime::spawn_blocking(list_impl).await
        .map_err(|_|"VPN list worker failed".to_string())?
}
#[tauri::command]
pub async fn vpn_import(actions:tauri::State<'_,VpnActions>,kind:String,path:String)
    ->Result<Vec<VpnProfile>,String> {
    let guard=actions.acquire()?;
    guard.importing.store(true,Ordering::Release);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard=guard;
        #[cfg(target_os="linux")]
        {import_impl(&kind,&path,&_guard.cancel_import)}
        #[cfg(not(target_os="linux"))]
        {let _=(kind,path);Err("VPN file import is available only with Linux NetworkManager".into())}
    }).await.map_err(|_|"VPN import worker failed".to_string())?
}
#[tauri::command]
pub fn vpn_cancel_import(actions:tauri::State<'_,VpnActions>)->bool {
    if actions.importing.load(Ordering::Acquire) {
        actions.cancel_import.store(true,Ordering::Release);
        true
    } else {false}
}
#[tauri::command]
pub fn vpn_cancel_set(actions:tauri::State<'_,VpnActions>)->bool {
    if actions.setting.load(Ordering::Acquire) {
        actions.cancel_set.store(true,Ordering::Release);
        true
    } else {false}
}
#[tauri::command]
pub async fn vpn_health(profile_id:String)->Result<VpnHealth,String>{
    if !uuid_ok(&profile_id) {return Err("Invalid system VPN profile ID".into());}
    tauri::async_runtime::spawn_blocking(move || {
        let profile=list_impl()?.into_iter().find(|p|p.id.eq_ignore_ascii_case(&profile_id))
            .ok_or("System VPN profile is missing or unsupported")?;
        Ok(health_impl(&profile))
    }).await.map_err(|_|"VPN health worker failed".to_string())?
}
#[tauri::command]
pub async fn vpn_set(actions:tauri::State<'_,VpnActions>,profile_id:String,expected_name:String,expected_kind:String,expected_active:bool,connect:bool)->Result<Vec<VpnProfile>,String>{
    if !uuid_ok(&profile_id) {return Err("Invalid system VPN profile ID".into());}
    // The guard belongs to the spawned worker, not the IPC future.
    let guard=actions.acquire()?;
    guard.setting.store(true,Ordering::Release);
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
        if selected.active!=connect {execute_impl(selected,connect,&_guard.cancel_set)?;}
        // A successful OS command is not proof of a connected/disconnected
        // profile. Poll the OS for a bounded time and reject stale identity.
        // This still does not prove route, DNS or traffic correctness.
        wait_for_state(selected,connect,&_guard.cancel_set)
    }).await.map_err(|_|"VPN action worker failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os="linux")]
    #[test]
    fn disposable_vpn_import_validates_file_and_invokes_fixed_nmcli_shape() {
        use std::os::unix::fs::PermissionsExt;
        let dir=tempfile::tempdir().unwrap();
        let wg=dir.path().join("fixture.conf");
        std::fs::write(&wg,"[Interface]\nPrivateKey = disposable-only\n").unwrap();
        let mut private=std::fs::metadata(&wg).unwrap().permissions();
        private.set_mode(0o600);
        std::fs::set_permissions(&wg,private).unwrap();
        let wg_path=wg.to_str().unwrap();
        assert_eq!(import_file("WireGuard",wg_path).unwrap(),wg);
        let mut public=std::fs::metadata(&wg).unwrap().permissions();
        public.set_mode(0o644);
        std::fs::set_permissions(&wg,public).unwrap();
        assert!(import_file("WireGuard",wg_path).is_err());
        let mut private=std::fs::metadata(&wg).unwrap().permissions();
        private.set_mode(0o600);
        std::fs::set_permissions(&wg,private).unwrap();
        assert!(import_file("OpenVPN",wg_path).is_err());
        assert!(import_file("Other VPN",wg_path).is_err());
        assert!(import_file("WireGuard","relative.conf").is_err());
        let link=dir.path().join("link.conf");
        std::os::unix::fs::symlink(&wg,&link).unwrap();
        assert!(import_file("WireGuard",link.to_str().unwrap()).is_err());
        let empty=dir.path().join("empty.conf");
        std::fs::write(&empty,[]).unwrap();
        assert!(import_file("WireGuard",empty.to_str().unwrap()).is_err());
        let large=dir.path().join("large.conf");
        std::fs::write(&large,vec![b'x';256*1024+1]).unwrap();
        assert!(import_file("WireGuard",large.to_str().unwrap()).is_err());

        let args_file=dir.path().join("args");
        let tool=dir.path().join("nmcli-fixture");
        let id="123e4567-e89b-12d3-a456-426614174001";
        std::fs::write(&tool,format!("#!/bin/sh\nprintf '%s\\n' \"$@\" > '{}'\nprintf '%s\\n' \"Connection 'fixture' ({id}) successfully added.\"\n",args_file.display())).unwrap();
        let mut permissions=std::fs::metadata(&tool).unwrap().permissions();
        permissions.set_mode(0o700);
        std::fs::set_permissions(&tool,permissions).unwrap();
        assert_eq!(import_with_tool(&tool,"WireGuard",&wg,None).unwrap(),id);
        let args=std::fs::read_to_string(&args_file).unwrap();
        assert_eq!(args.lines().collect::<Vec<_>>(),
            ["-w","30","connection","import","--temporary","type","wireguard","file",wg_path]);
        assert!(import_with_tool(&tool,"Other VPN",&wg,None).is_err());
        assert!(import_with_tool(std::path::Path::new("/missing/nmcli"),"WireGuard",&wg,None).is_err());
        assert!(imported_uuid("Connection 'fixture' (bad) successfully added.").is_err());
        assert!(imported_uuid("Connection 'fixture' (123e4567-e89b-12d3-a456-426614174001) successfully added.\nConnection 'other' (123e4567-e89b-12d3-a456-426614174002) successfully added.").is_err());
        restrict_import_with_tool(&tool,id,"fixture").unwrap();
        let args=std::fs::read_to_string(&args_file).unwrap();
        assert_eq!(args.lines().collect::<Vec<_>>(),["-w","30","connection","modify","uuid",id,
            "connection.autoconnect","no","connection.permissions","user:fixture:"]);
        assert!(restrict_import_with_tool(&tool,id,"other:user").is_err());
        rollback_import_with_tool(&tool,id).unwrap();
        let args=std::fs::read_to_string(&args_file).unwrap();
        assert_eq!(args.lines().collect::<Vec<_>>(),["-w","30","connection","delete","uuid",id]);
        assert!(rollback_import_with_tool(&tool,"bad").is_err());

        let slow=dir.path().join("slow-nmcli");
        std::fs::write(&slow,"#!/bin/sh\nexec sleep 30\n").unwrap();
        let mut permissions=std::fs::metadata(&slow).unwrap().permissions();
        permissions.set_mode(0o700);
        std::fs::set_permissions(&slow,permissions).unwrap();
        let cancel=Arc::new(AtomicBool::new(false));
        let signal=Arc::clone(&cancel);
        let file=wg.clone();
        let worker=std::thread::spawn(move ||import_with_tool(&slow,"WireGuard",&file,Some(&signal)));
        std::thread::sleep(Duration::from_millis(100));
        cancel.store(true,Ordering::Release);
        assert!(worker.join().unwrap().unwrap_err().contains("cancelled"));
    }
    #[cfg(target_os="linux")]
    #[test]
    fn import_conflicts_are_rejected_without_touching_existing_profiles() {
        let before=vec![VpnProfile{id:"123e4567-e89b-12d3-a456-426614174000".into(),
            name:"Existing".into(),kind:"WireGuard".into(),active:false,control_allowed:true}];
        let added=VpnProfile{id:"123e4567-e89b-12d3-a456-426614174001".into(),
            name:"New fixture".into(),kind:"WireGuard".into(),active:false,control_allowed:true};
        assert_eq!(imported_profile(&before,&[before[0].clone(),added.clone()],"WireGuard").unwrap(),added);
        assert!(imported_profile(&before,&before,"WireGuard").is_err());
        assert!(imported_profile(&before,&[before[0].clone(),added.clone(),
            VpnProfile{id:"123e4567-e89b-12d3-a456-426614174002".into(),..added.clone()}],
            "WireGuard").is_err());
        for changed in [VpnProfile{name:"Existing".into(),..added.clone()},
            VpnProfile{active:true,..added.clone()},
            VpnProfile{kind:"OpenVPN".into(),..added.clone()},
            VpnProfile{control_allowed:false,..added.clone()}] {
            assert!(imported_profile(&before,&[before[0].clone(),changed],"WireGuard").is_err());
        }
    }
    #[test]
    fn inactive_health_never_claims_route_or_dns_evidence() {
        let profile=VpnProfile{id:"123e4567-e89b-12d3-a456-426614174000".into(),
            name:"Disposable fixture".into(),kind:"WireGuard".into(),active:false,
            control_allowed:true};
        let result=health_impl(&profile);
        assert!(!result.active);
        assert_eq!(result.route_configured,None);
        assert_eq!(result.dns_configured,None);
        assert!(!serde_json::to_string(&result).unwrap().contains("Disposable fixture"));
    }
    #[cfg(windows)]
    #[test]
    fn windows_health_query_uses_only_mocked_network_objects() {
        let mock=r#"
function Get-NetIPInterface { [pscustomobject]@{InterfaceIndex=77} }
function Get-NetRoute { [pscustomobject]@{InterfaceIndex=77;DestinationPrefix='10.99.0.0/16'} }
function Get-DnsClientServerAddress { [pscustomobject]@{InterfaceIndex=77;ServerAddresses=@('192.0.2.53')} }
"#;
        let mut cmd=windows_tool(&["System32","WindowsPowerShell","v1.0","powershell.exe"]).unwrap();
        cmd.args(["-NoProfile","-NonInteractive","-Command",&format!("{mock}\n{WINDOWS_HEALTH}")]);
        cmd.env("NODEDESK_VPN_ALIAS","fixture-only");
        let raw=output(cmd).unwrap();
        assert!(raw.contains("\"routeConfigured\":true"));
        assert!(raw.contains("\"dnsConfigured\":true"));
        assert!(!raw.contains("192.0.2.53"));
        assert!(!raw.contains("10.99.0.0"));
    }
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
        after.setting.store(true,Ordering::Release);
        actions.cancel_set.store(true,Ordering::Release);
        drop(after);
        assert!(!actions.setting.load(Ordering::Acquire));
        assert!(!actions.cancel_set.load(Ordering::Acquire));
        assert!(actions.acquire().is_ok());
    }
    #[cfg(target_os="linux")]
    #[test]
    fn disposable_vpn_connect_cancel_kills_manager_and_preserves_uuid_arguments() {
        use std::os::unix::fs::PermissionsExt;
        let dir=tempfile::tempdir().unwrap();
        let tool=dir.path().join("nmcli-fixture");
        let args=dir.path().join("args");
        std::fs::write(&tool,format!("#!/bin/sh\nprintf '%s\\n' \"$@\" > '{}'\nexec sleep 30\n",args.display())).unwrap();
        let mut mode=std::fs::metadata(&tool).unwrap().permissions();
        mode.set_mode(0o700);
        std::fs::set_permissions(&tool,mode).unwrap();
        let profile=VpnProfile{id:"123e4567-e89b-12d3-a456-426614174000".into(),
            name:"Fixture".into(),kind:"WireGuard".into(),active:false,control_allowed:true};
        let cancelled=Arc::new(AtomicBool::new(false));
        let signal=Arc::clone(&cancelled);
        let tool_for_worker=tool.clone();
        let profile_for_worker=profile.clone();
        let start=Instant::now();
        let worker=std::thread::spawn(move ||execute_with_tool(&tool_for_worker,&profile_for_worker,true,&signal));
        for _ in 0..50 {
            if args.exists(){break;}
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(args.exists(),"disposable manager never started");
        cancelled.store(true,Ordering::Release);
        assert!(worker.join().unwrap().unwrap_err().contains("cancelled"));
        assert!(start.elapsed()<Duration::from_secs(5));
        assert_eq!(std::fs::read_to_string(&args).unwrap().lines().collect::<Vec<_>>(),
            ["-w","30","connection","up","uuid",profile.id.as_str()]);
        assert!(execute_with_tool(std::path::Path::new("/missing/nmcli"),&profile,false,&cancelled)
            .unwrap_err().contains("cancelled"));
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
