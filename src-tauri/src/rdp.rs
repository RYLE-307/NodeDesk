//! v0.6 RDP launcher: explicitly user-initiated, out-of-process first slice.
 //! Never pass passwords, tokens, certificate exceptions or arbitrary shell text.
use serde::{Deserialize, Serialize};
use std::{
    net::IpAddr,
    process::{Command, Stdio},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpTarget { pub host: String, pub port: u16, pub username: String,
    pub rdp_sha256_fingerprint: Option<String> }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchInfo { pub client: &'static str, pub external_window: bool }

#[derive(Clone, Copy)]
enum Platform { Windows, Linux }

/// Enforce exactly one endpoint without a URL, route, port suffix or CLI option.
fn endpoint(host: &str, port: u16) -> Result<String, String> {
    if port == 0 || host.is_empty() || host.len() > 253 || host.trim() != host {
        return Err("Invalid RDP host or port".into());
    }
    let addr = host.strip_prefix('[').and_then(|v| v.strip_suffix(']')).unwrap_or(host);
    if let Ok(ip) = addr.parse::<IpAddr>() {
        return Ok(match ip {
            IpAddr::V6(_) => format!("[{addr}]:{port}"),
            IpAddr::V4(_) => format!("{addr}:{port}"),
        });
    }
    if host.chars().any(|c| matches!(c, '['|']'|':'|'/'|'\\'|'@'|'?'|'#'|'%')) ||
       !host.is_ascii() || host.starts_with('-') ||
       host.split('.').any(|part| part.is_empty() || part.len() > 63 ||
           part.starts_with('-') || part.ends_with('-') ||
           !part.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')) {
        return Err("Invalid RDP host (enter an IP address or DNS name without a URL)".into());
    }
    Ok(format!("{host}:{port}"))
}
fn normalize_fingerprint(value: &str) -> Result<String, String> {
    let bytes=value.as_bytes();
    let plain=bytes.len()==64 && bytes.iter().all(u8::is_ascii_hexdigit);
    let colon=bytes.len()==95 && bytes.iter().enumerate().all(|(i,b)|
        if i%3==2 { *b==b':' } else { b.is_ascii_hexdigit() });
    if !plain && !colon { return Err("Invalid RDP SHA256 certificate fingerprint".into()); }
    Ok(value.bytes().filter(|b|*b!=b':').map(|b|(b as char).to_ascii_lowercase()).collect())
}
fn build_args(target: &RdpTarget, platform: Platform) -> Result<Vec<String>, String> {
    let server = endpoint(&target.host,target.port)?;
    let fingerprint=target.rdp_sha256_fingerprint.as_deref().map(normalize_fingerprint).transpose()?;
    if target.username.len()>200 || target.username.chars().any(|c|c.is_control()) {
        return Err("Invalid RDP username".into());
    }
    match platform {
        Platform::Windows => {
            // Native mstsc opens its own secure credential and certificate dialogs.
            // Public mode prevents persistence of credentials and bitmaps.
            Ok(vec![format!("/v:{server}"), "/prompt".into(), "/public".into()])
        }
        Platform::Linux => {
            // FreeRDP SDL has a graphical credential prompt. No /p, /cert:ignore,
            // /cert:tofu or unrequested clipboard/drive/USB forwarding.
            let mut args=vec![format!("/v:{server}"), "+dynamic-resolution".into()];
            if !target.username.is_empty() { args.push(format!("/u:{}",target.username)); }
            if let Some(pin)=fingerprint { args.push(format!("/cert:fingerprint:sha256:{pin}")); }
            Ok(args)
        }
    }
}
#[tauri::command]
pub fn rdp_launch(target: RdpTarget) -> Result<LaunchInfo,String> {
    #[cfg(windows)] let platform=Platform::Windows;
    #[cfg(not(windows))] let platform=Platform::Linux;
    let args=build_args(&target,platform)?;
    #[cfg(windows)] let binary="mstsc.exe";
    #[cfg(not(windows))] let binary="sdl-freerdp3";
    // Fixed binary and argument vector: no shell expansion and no credentials
    // in the process list. Never claim an RDP login until client itself does.
    let mut child=Command::new(binary)
        .args(&args)
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
        .spawn().map_err(|_| if cfg!(windows) {
            "Could not launch mstsc.exe. Check Windows Remote Desktop availability.".to_owned()
        } else {
            "FreeRDP SDL client not found. Install the freerdp package (sdl-freerdp3).".to_owned()
        })?;
    // Ensure the child is reaped. This initial external RDP window is controlled
    // by the OS/client, not by tab-close or another SSH session in NodeDesk.
    std::thread::spawn(move || { let _=child.wait(); });
    Ok(LaunchInfo {client:binary,external_window:true})
}

#[cfg(test)]
mod tests {
    use super::*;
    fn target(host:&str,port:u16,username:&str)->RdpTarget {
        RdpTarget {host:host.into(),port,username:username.into(),rdp_sha256_fingerprint:None}
    }
    #[test] fn endpoints_validate_dns_ipv4_ipv6_and_reject_injection() {
        assert_eq!(endpoint("rdp.example.org",3389).unwrap(),"rdp.example.org:3389");
        assert_eq!(endpoint("192.168.2.230",3389).unwrap(),"192.168.2.230:3389");
        assert_eq!(endpoint("2001:db8::1",3390).unwrap(),"[2001:db8::1]:3390");
        assert_eq!(endpoint("[::1]",3389).unwrap(),"[::1]:3389");
        for bad in ["", "foo:3389", "-h", "hello world", "foo/bar", "foo%20bar", 
                    "http://foo", "foo\\bar", "user@server", "foo\nbar", "[bad]", "a..b"] {
            assert!(endpoint(bad,3389).is_err(),"{bad:?} was accepted");
        }
        assert!(endpoint("example.org",0).is_err());
    }
    #[test] fn platform_arguments_never_embed_secrets_or_disable_cert_checks() {
        let t=target("win.lab",3389,"LAB\\admin");
        let w=build_args(&t,Platform::Windows).unwrap();
        assert_eq!(w,vec!["/v:win.lab:3389","/prompt","/public"]);
        let l=build_args(&t,Platform::Linux).unwrap();
        assert_eq!(l,vec!["/v:win.lab:3389","+dynamic-resolution","/u:LAB\\admin"]);
        for args in [w,l] {
            assert!(!args.iter().any(|a|a.starts_with("/p:")||a.contains("cert:ignore")||a.contains("cert:tofu")||a.contains("password")));
        }
        assert!(build_args(&target("a",1,"user\nsecret"),Platform::Linux).is_err());
    }
    #[test] fn sha256_pin_is_normalized_and_only_passed_to_linux_freerdp() {
        let mut t=target("192.168.2.223",3389,"");
        t.rdp_sha256_fingerprint=Some("b3:fd:df:e2:a1:35:b7:00:cd:0f:8d:a6:b7:15:fa:59:3e:5a:6f:56:7b:f5:c9:4f:c6:d0:10:32:03:d8:68:67".into());
        let pin="b3fddfe2a135b700cd0f8da6b715fa593e5a6f567bf5c94fc6d0103203d86867";
        assert_eq!(build_args(&t,Platform::Linux).unwrap(),vec![
            "/v:192.168.2.223:3389".to_string(),"+dynamic-resolution".to_string(),
            format!("/cert:fingerprint:sha256:{pin}")]);
        assert_eq!(build_args(&t,Platform::Windows).unwrap(),vec![
            "/v:192.168.2.223:3389","/prompt","/public"]);
        t.rdp_sha256_fingerprint=Some(pin.to_ascii_uppercase());
        assert!(build_args(&t,Platform::Linux).unwrap().last().unwrap().ends_with(pin));
    }
    #[test] fn malformed_pins_are_rejected_even_on_windows() {
        let mut t=target("win.lab",3389,"");
        for bad in ["".into(), "a".into(), "a".repeat(63), "g".repeat(64),
                    "a".repeat(65), "a".repeat(32),
                    "/cert:ignore".into(), "aa:bb".into(), "a:".repeat(32)] {
            t.rdp_sha256_fingerprint=Some(bad.into());
            assert!(build_args(&t,Platform::Linux).is_err());
            assert!(build_args(&t,Platform::Windows).is_err());
        }
    }
}
