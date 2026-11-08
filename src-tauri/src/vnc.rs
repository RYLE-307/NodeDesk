//! v0.6 TigerVNC launcher: a user-triggered, out-of-process VNC window.
//! Enforce X.509/TLS and authentication: do not fall back to insecure VNCAuth.
//! Credentials and trust decisions belong to TigerVNC's own UI, not NodeDesk.
use serde::{Deserialize, Serialize};
use std::{net::Ipv4Addr, path::PathBuf, process::{Command, Stdio}};

#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
pub struct VncTarget { pub host: String, pub port: u16 }

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct VncLaunchInfo { pub client: &'static str, pub external_window: bool, pub security: &'static str }

fn endpoint(host: &str, port: u16) -> Result<String,String> {
    if port == 0 || host.is_empty() || host.len() > 253 || host.trim() != host ||
        !host.is_ascii() || host.starts_with('-') ||
        host.chars().any(|c| matches!(c, '['|']'|':'|'/'|'\\'|'@'|'?'|'#'|'%'|';'|'='|' ')) {
        return Err("Invalid VNC host or port (use IPv4 or DNS, not a URL or display number)".into());
    }
    if host.parse::<Ipv4Addr>().is_err() &&
      (host.bytes().all(|c|c.is_ascii_digit()||c==b'.') ||
       host.split('.').any(|label| label.is_empty()||label.len()>63 ||
           label.starts_with('-')||label.ends_with('-')||
           !label.bytes().all(|c|c.is_ascii_alphanumeric()||c==b'-'||c==b'_'))) {
        return Err("Invalid VNC host".into());
    }
    Ok(format!("{host}::{port}"))
}
fn args(target:&VncTarget) -> Result<Vec<String>,String> {
    let host=endpoint(&target.host,target.port)?;
    Ok(vec![
        // Restrict to authenticated TLS with server certificates. A legacy
        // None/VncAuth/TLSVnc server must fail, not silently downgrade.
        "-SecurityTypes=X509Vnc,X509Plain".into(),
        "-AcceptClipboard=0".into(),
        "-SendClipboard=0".into(),
        "-SendPrimary=0".into(),
        "-ReconnectOnError=0".into(),
        host,
    ])
}
#[cfg(windows)]
fn binary() -> Result<PathBuf,String> {
    // TigerVNC's Windows installer normally does not add vncviewer.exe to PATH.
    // Resolve only the vendor's expected installed executable; do not run an
    // executable placed in the current working directory.
    for name in ["ProgramFiles","ProgramFiles(x86)","ProgramW6432"] {
        if let Some(root)=std::env::var_os(name) {
            let path=PathBuf::from(root).join("TigerVNC").join("vncviewer.exe");
            if path.is_file() { return Ok(path); }
        }
    }
    Err("TigerVNC Viewer was not found under Program Files. Install the official TigerVNC Windows viewer.".into())
}
#[cfg(not(windows))]
fn binary() -> Result<PathBuf,String> {
    let path=PathBuf::from("/usr/bin/vncviewer");
    if path.is_file() { Ok(path) }
    else { Err("TigerVNC Viewer not found. On Arch install it with: sudo pacman -S --needed tigervnc".into()) }
}

#[tauri::command]
pub fn vnc_launch(target:VncTarget) -> Result<VncLaunchInfo,String> {
    let args=args(&target)?;
    let binary=binary()?;
    let mut child=Command::new(&binary)
        .args(&args)
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
        .spawn()
        .map_err(|_|"Failed to launch TigerVNC Viewer; check its installation".to_owned())?;
    std::thread::spawn(move || {let _=child.wait();});
    Ok(VncLaunchInfo{client:"TigerVNC",external_window:true,security:"X509Vnc,X509Plain"})
}

#[cfg(test)]
mod tests {
    use super::*;
    fn target(host:&str,port:u16)->VncTarget{VncTarget{host:host.into(),port}}
    #[test]
    fn accepts_explicit_dns_and_ipv4_ports() {
        assert_eq!(endpoint("vnc.example.org",5900).unwrap(),"vnc.example.org::5900");
        assert_eq!(endpoint("192.168.2.201",5901).unwrap(),"192.168.2.201::5901");
        assert_eq!(endpoint("localhost",1).unwrap(),"localhost::1");
        assert_eq!(endpoint("a-b.internal",65535).unwrap(),"a-b.internal::65535");
    }
    #[test]
    fn refuses_urls_shell_injection_display_syntax_and_invalid_ports(){
        for host in ["","-SecurityTypes=None","foo::5900","foo:1","https://foo",
                     "user@host","host/file","foo\\bar","foo\nbar","foo bar",
                     "foo;bar","host=bad","1.2.3.999","bad..host","a.-bad","some%09host"] {
            assert!(endpoint(host,5900).is_err(),"{host:?} unexpectedly valid");
        }
        assert!(endpoint("test",0).is_err());
    }
    #[test]
    fn cli_never_downgrades_or_passes_secrets_and_clipboard() {
        let actual=args(&target("vnc.lab",5901)).unwrap();
        assert_eq!(actual,vec![
            "-SecurityTypes=X509Vnc,X509Plain","-AcceptClipboard=0",
            "-SendClipboard=0","-SendPrimary=0","-ReconnectOnError=0",
            "vnc.lab::5901"
        ]);
        let full=actual.join(" ");
        for rejected in ["VncAuth,","TLSVnc","TLSNone","X509None","-Password","-passwd",
                         "SecurityTypes=None","-AcceptClipboard=1","-SendClipboard=1"]{
            assert!(!full.contains(rejected));
        }
    }
}
