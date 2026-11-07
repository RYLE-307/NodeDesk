//! System-owned VPN profiles. Never imports credentials, edits routes/DNS, or
//! accepts arbitrary executables/scripts from WebView. Explicit user action only.
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, process::{Command, Stdio}};

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
    else {Err("VPN profile encryption policy is read-only in NodeDesk".into())}
}

/// Capture only specifically requested non-secret fields. Discard stderr and
/// never include stdout in UI errors (OS tools can echo configuration).
fn output(mut command:Command) -> Result<String,String> {
    let child=command.stdin(Stdio::null()).output()
        .map_err(|_|"System VPN manager not installed or unavailable".to_string())?;
    if !child.status.success() { return Err("System VPN manager rejected the request".into()); }
    if child.stdout.len()>256*1024 { return Err("Too many VPN profiles to display safely".into()); }
    String::from_utf8(child.stdout).map_err(|_|"System VPN manager returned invalid UTF-8".into())
}

#[cfg(target_os="linux")]
fn nmcli(args:&[&str])->Result<String,String> {
    let mut cmd=Command::new("/usr/bin/nmcli");
    cmd.args(args);
    output(cmd)
}
#[cfg(target_os="linux")]
fn list_impl()->Result<Vec<VpnProfile>,String> {
    // UUID/TYPE are safe for terse parsing; profile names may contain colon
    // and are retrieved separately by exact OS UUID, with no --show-secrets.
    let configured=nmcli(&["-t","-f","UUID,TYPE","connection","show"])?;
    let active=nmcli(&["-t","-f","UUID","connection","show","--active"])?;
    let active_ids:HashSet<&str>=active.lines().filter(|s|uuid_ok(s)).collect();
    let mut profiles=Vec::new();
    let mut seen=HashSet::new();
    for line in configured.lines() {
        let Some((uuid,kind))=line.split_once(':') else {continue};
        if !uuid_ok(uuid)|| !matches!(kind,"vpn"|"wireguard") || !seen.insert(uuid) {continue}
        if profiles.len()>=100 {return Err("Too many VPN profiles".into());}
        let name=nmcli(&["-g","connection.id","connection","show","uuid",uuid])?;
        let name=name.trim_end_matches(['\r','\n']);
        if !safe_name(name) {continue;}
        profiles.push(VpnProfile {
            id:uuid.to_ascii_lowercase(),name:name.into(),kind:kind.into(),
            active:active_ids.contains(uuid),control_allowed:true,
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
    // The script is static and reads user-scope Windows built-in phonebook
    // profiles only. Never reads/returns EAP XML, PSK, credentials, server URLs
    // or routes. VPN types known to be insecure/ambiguous are excluded.
    let mut cmd=windows_tool(&["System32","WindowsPowerShell","v1.0","powershell.exe"])?;
    cmd.args(["-NoProfile","-NonInteractive","-Command",WINDOWS_QUERY]);
    let raw=output(cmd)?;
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
fn execute_impl(_profile:&VpnProfile,_connect:bool)->Result<(),String>{
    Err("VPN manager is supported only on Windows and Linux".into())
}

#[tauri::command]
pub async fn vpn_list()->Result<Vec<VpnProfile>,String>{
    tauri::async_runtime::spawn_blocking(list_impl).await
        .map_err(|_|"VPN list worker failed".to_string())?
}
#[tauri::command]
pub async fn vpn_set(profile_id:String,connect:bool)->Result<Vec<VpnProfile>,String>{
    tauri::async_runtime::spawn_blocking(move || {
        if !uuid_ok(&profile_id) {return Err("Invalid system VPN profile ID".into());}
        // Recheck the exact profile, its current kind and active state at the
        // time of the user-approved action. WebView cannot choose arbitrary
        // system connection names or execute shell/PowerShell text.
        let before=list_impl()?;
        let selected=before.iter().find(|p|p.id.eq_ignore_ascii_case(&profile_id))
            .ok_or("System VPN profile is missing or unsupported")?;
        require_control_allowed(selected)?;
        if selected.active!=connect {execute_impl(selected,connect)?;}
        // Always re-read OS status; success means OS tool accepted action,
        // not that VPN traffic/routes have been independently audited.
        list_impl()
    }).await.map_err(|_|"VPN action worker failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
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
    #[test]
    fn missing_nmcli_returns_a_clear_error_without_network_action() {
        if !std::path::Path::new("/usr/bin/nmcli").exists() {
            assert_eq!(list_impl().unwrap_err(),"System VPN manager not installed or unavailable");
        }
    }
}
