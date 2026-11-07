//! Explicit, bounded DNS, single TCP-port and ICMP ping diagnostics.
//! No background scan, shell invocation, user-supplied executable or option.
use serde::{Deserialize,Serialize};
use std::{
    io::Read,
    net::{IpAddr,SocketAddr,TcpStream,ToSocketAddrs},
    process::{Command,Stdio},
    thread,
    time::{Duration,Instant}
};

#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
pub struct ProbeTarget {host:String,port:u16}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct ProbeResult {addresses:Vec<String>,tcp_reachable:bool,elapsed_ms:u128}

#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
pub struct PingTarget {host:String}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct PingResult {reachable:bool,elapsed_ms:u128,output:String}

pub(crate) fn valid_host(host:&str)->bool {
    if host.is_empty()||host.len()>253||host.trim()!=host{return false;}
    let addr=host.strip_prefix('[').and_then(|v|v.strip_suffix(']')).unwrap_or(host);
    if addr.parse::<IpAddr>().is_ok(){return true;}
    host.is_ascii()&&!host.starts_with('-')&&host.split('.').all(|part|
        !part.is_empty()&&part.len()<=63&&!part.starts_with('-')&&!part.ends_with('-')&&
        part.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'))
}
fn resolve(target:&ProbeTarget)->Result<Vec<SocketAddr>,String>{
    if !valid_host(&target.host)||target.port==0{return Err("Invalid diagnostic host or port".into());}
    let host=target.host.strip_prefix('[').and_then(|v|v.strip_suffix(']')).unwrap_or(&target.host);
    let addresses=(host,target.port).to_socket_addrs()
        .map_err(|_|"DNS lookup failed".to_string())?.take(16).collect::<Vec<_>>();
    if addresses.is_empty(){return Err("DNS returned no addresses".into());}
    Ok(addresses)
}
fn probe(target:ProbeTarget)->Result<ProbeResult,String>{
    let started=Instant::now();
    let addresses=resolve(&target)?;
    let mut reachable=false;
    for address in addresses.iter().take(4){
        if TcpStream::connect_timeout(address,Duration::from_secs(2)).is_ok(){reachable=true;break;}
    }
    Ok(ProbeResult{addresses:addresses.iter().map(|a|a.ip().to_string()).collect(),
        tcp_reachable:reachable,elapsed_ms:started.elapsed().as_millis()})
}
#[tauri::command]
pub async fn network_probe(target:ProbeTarget)->Result<ProbeResult,String>{
    tauri::async_runtime::spawn_blocking(move||probe(target)).await
        .map_err(|_|"Diagnostic worker failed".to_string())?
}

/// Each platform receives exactly two ICMP echo attempts with OS-level timeouts.
/// The user controls only a validated host (never an option or shell fragment).
fn ping_args(host:&str,windows:bool)->Result<Vec<String>,String>{
    if !valid_host(host){return Err("Invalid diagnostic host".into());}
    let fixed=if windows{vec!["-n","2","-w","2000"]}
        else{vec!["-n","-c","2","-W","2"]};
    let endpoint=host.strip_prefix('[').and_then(|v|v.strip_suffix(']')).unwrap_or(host);
    Ok(fixed.into_iter().map(str::to_string).chain(std::iter::once(endpoint.to_owned())).collect())
}
fn ping(target:PingTarget)->Result<PingResult,String>{
    let started=Instant::now();
    let args=ping_args(&target.host,cfg!(windows))?;
    #[cfg(windows)]
    let executable=std::env::var_os("SystemRoot")
        .map(|root|std::path::PathBuf::from(root).join("System32").join("ping.exe"))
        .ok_or_else(||"Windows ping utility unavailable".to_string())?;
    #[cfg(not(windows))]
    let executable=std::path::PathBuf::from("/usr/bin/ping");
    let mut child=Command::new(executable).args(args)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null())
        .spawn().map_err(|_|"System ping utility unavailable".to_string())?;
    let success=loop {
        match child.try_wait() {
            Ok(Some(status))=>break status.success(),
            Ok(None) if started.elapsed()<Duration::from_secs(10)=>{
                thread::sleep(Duration::from_millis(50));
            }
            Ok(None)=>{
                let _=child.kill();let _=child.wait();
                return Err("Ping timed out".into());
            }
            Err(_)=>{
                let _=child.kill();let _=child.wait();
                return Err("Ping process failed".into());
            }
        }
    };
    // Two requests produce small output; cap and sanitize it before rendering.
    let mut bytes=Vec::new();
    if let Some(stdout)=child.stdout.take(){
        let _=stdout.take(4096).read_to_end(&mut bytes);
    }
    let output=String::from_utf8_lossy(&bytes).chars()
        .filter(|c|!c.is_control()||matches!(c,'\n'|'\r'|'\t'))
        .collect();
    Ok(PingResult{reachable:success,elapsed_ms:started.elapsed().as_millis(),output})
}
#[tauri::command]
pub async fn network_ping(target:PingTarget)->Result<PingResult,String>{
    tauri::async_runtime::spawn_blocking(move||ping(target)).await
        .map_err(|_|"Diagnostic worker failed".to_string())?
}


#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
pub struct TraceTarget {host:String}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct TraceResult {elapsed_ms:u128,output:String}

fn trace_args(host:&str,windows:bool)->Result<Vec<String>,String>{
    if !valid_host(host){return Err("Invalid diagnostic host".into());}
    // Windows tracert sends three probes per hop; limit it to eight hops.
    // Linux traceroute uses a single probe per hop, bounded to twelve hops.
    let fixed=if windows{vec!["-d","-h","8","-w","500"]}
        else{vec!["-n","-m","12","-w","1","-q","1"]};
    let endpoint=host.strip_prefix('[').and_then(|v|v.strip_suffix(']')).unwrap_or(host);
    Ok(fixed.into_iter().map(str::to_string).chain(std::iter::once(endpoint.to_owned())).collect())
}
fn trace(target:TraceTarget)->Result<TraceResult,String>{
    let started=Instant::now();
    let args=trace_args(&target.host,cfg!(windows))?;
    #[cfg(windows)]
    let executable=std::env::var_os("SystemRoot")
        .map(|root|std::path::PathBuf::from(root).join("System32").join("tracert.exe"))
        .ok_or_else(||"Windows traceroute utility unavailable".to_string())?;
    #[cfg(not(windows))]
    let executable=std::path::PathBuf::from("/usr/bin/traceroute");
    let mut child=Command::new(executable).args(args)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null())
        .spawn().map_err(|_|"System traceroute utility unavailable".to_string())?;
    loop {
        match child.try_wait() {
            Ok(Some(_))=>break,
            Ok(None) if started.elapsed()<Duration::from_secs(25)=>{
                thread::sleep(Duration::from_millis(50));
            }
            Ok(None)=>{
                let _=child.kill();let _=child.wait();
                return Err("Traceroute timed out".into());
            }
            Err(_)=>{
                let _=child.kill();let _=child.wait();
                return Err("Traceroute process failed".into());
            }
        }
    }
    let mut bytes=Vec::new();
    if let Some(stdout)=child.stdout.take(){
        let _=stdout.take(8192).read_to_end(&mut bytes);
    }
    let output=String::from_utf8_lossy(&bytes).chars()
        .filter(|c|!c.is_control()||matches!(c,'\n'|'\r'|'\t')).collect();
    Ok(TraceResult{elapsed_ms:started.elapsed().as_millis(),output})
}
#[tauri::command]
pub async fn network_trace(target:TraceTarget)->Result<TraceResult,String>{
    tauri::async_runtime::spawn_blocking(move||trace(target)).await
        .map_err(|_|"Diagnostic worker failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn endpoint_validation_rejects_urls_commands_and_empty_ports(){
        for good in ["localhost","example.org","127.0.0.1","::1","[::1]"]{assert!(valid_host(good));}
        for bad in ["","-x","a..b","https://example.org","user@host","a b","host;cmd","host\n"]{assert!(!valid_host(bad));}
        assert!(resolve(&ProbeTarget{host:"localhost".into(),port:0}).is_err());
    }
    #[test]
    fn loopback_probe_reports_an_open_port_without_external_network(){
        let listener=std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port=listener.local_addr().unwrap().port();
        let result=probe(ProbeTarget{host:"127.0.0.1".into(),port}).unwrap();
        assert!(result.tcp_reachable);
        assert_eq!(result.addresses,vec!["127.0.0.1".to_string()]);
    }
    #[test]
    fn traceroute_is_bounded_and_disallows_user_options(){
        assert_eq!(trace_args("127.0.0.1",false).unwrap(),
            ["-n","-m","12","-w","1","-q","1","127.0.0.1"]);
        assert_eq!(trace_args("[::1]",true).unwrap().last().unwrap(),"::1");
        assert_eq!(trace_args("example.org",true).unwrap(),
            ["-d","-h","8","-w","500","example.org"]);
        for bad in ["","-d","host; echo bad","foo\\bar","https://example.org","host\n"] {
            assert!(trace_args(bad,false).is_err());
            assert!(trace_args(bad,true).is_err());
        }
    }
    #[test]
    fn ping_uses_fixed_count_timeout_and_rejects_injection(){
        assert_eq!(ping_args("example.org",false).unwrap(),
            ["-n","-c","2","-W","2","example.org"]);
        assert_eq!(ping_args("[::1]",false).unwrap().last().unwrap(),"::1");
        assert_eq!(ping_args("127.0.0.1",true).unwrap(),
            ["-n","2","-w","2000","127.0.0.1"]);
        for bad in ["-i","--help","foo;touch /tmp/x","https://example.org",
            "foo\nbar","foo:443","host name",""] {
            assert!(ping_args(bad,false).is_err());
            assert!(ping_args(bad,true).is_err());
        }
    }
}
