//! Explicit, bounded DNS and single TCP-port diagnostics. No background scan.
use serde::{Deserialize,Serialize};
use std::{net::{IpAddr,SocketAddr,TcpStream,ToSocketAddrs},time::{Duration,Instant}};

#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
pub struct ProbeTarget {host:String,port:u16}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct ProbeResult {addresses:Vec<String>,tcp_reachable:bool,elapsed_ms:u128}

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
}
