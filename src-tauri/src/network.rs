//! Explicit, bounded DNS, single TCP-port and ICMP ping diagnostics.
//! No background scan, shell invocation, user-supplied executable or option.
use serde::{Deserialize,Serialize};
use std::{
    collections::{HashMap,HashSet},
    io::Read,
    net::{IpAddr,SocketAddr,TcpStream,ToSocketAddrs},
    process::{Child,Command,Stdio},
    sync::{Arc,Mutex,atomic::{AtomicBool,Ordering}},
    thread,
    time::{Duration,Instant}
};
use tauri::{Manager,State};

#[derive(Default)]
struct Diagnostic {cancelled:AtomicBool,child:Mutex<Option<Child>>}
impl Diagnostic {
    fn check(&self)->Result<(),String>{
        if self.cancelled.load(Ordering::SeqCst){Err("Diagnostic cancelled".into())}else{Ok(())}
    }
    fn cancel(&self){
        self.cancelled.store(true,Ordering::SeqCst);
        if let Ok(mut child)=self.child.lock(){if let Some(child)=child.as_mut(){let _=child.kill();}}
    }
    fn finish_child(&self){
        if let Ok(mut slot)=self.child.lock(){if let Some(mut child)=slot.take(){
            let _=child.kill();let _=child.wait();
        }}
    }
}
#[derive(Default)]
struct DiagnosticRegistry {active:HashMap<String,Arc<Diagnostic>>,cancelled:HashSet<String>}
#[derive(Default)]
pub struct Diagnostics(Mutex<DiagnosticRegistry>);
impl Diagnostics {
    pub fn shutdown(&self){if let Ok(mut active)=self.0.lock(){
        for (_,op) in active.active.drain(){op.cancel();}
        active.cancelled.clear();
    }}
}
struct ActiveDiagnostic {id:String,app:tauri::AppHandle,op:Arc<Diagnostic>}
impl Drop for ActiveDiagnostic {
    fn drop(&mut self){self.op.finish_child();
        if let Ok(mut active)=self.app.state::<Diagnostics>().0.lock(){active.active.remove(&self.id);}
    }
}
fn register(id:String,app:&tauri::AppHandle)->Result<ActiveDiagnostic,String>{
    if id.len()!=36||!id.chars().all(|c|c.is_ascii_hexdigit()||c=='-'){
        return Err("Invalid diagnostic ID".into());
    }
    let mut active=app.state::<Diagnostics>().0.lock().map_err(|_|"Diagnostic lock failed")?;
    if active.active.contains_key(&id)||active.active.len()>=8{return Err("Diagnostic limit or duplicate ID".into());}
    let op=Arc::new(Diagnostic::default());
    if active.cancelled.remove(&id){op.cancel();}
    active.active.insert(id.clone(),op.clone());
    Ok(ActiveDiagnostic{id,app:app.clone(),op})
}
#[tauri::command]
pub fn network_cancel(id:String,state:State<'_,Diagnostics>)->Result<(),String>{
    if id.len()!=36||!id.chars().all(|c|c.is_ascii_hexdigit()||c=='-'){
        return Err("Invalid diagnostic ID".into());
    }
    let mut registry=state.0.lock().map_err(|_|"Diagnostic lock failed")?;
    if let Some(op)=registry.active.get(&id){op.cancel();}
    else if registry.cancelled.len()<64{registry.cancelled.insert(id);}
    Ok(())
}

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
fn process_output(op:&Diagnostic,child:Child,started:Instant,timeout:Duration,limit:u64,
    timeout_error:&str,process_error:&str)->Result<(bool,String),String>{
    *op.child.lock().map_err(|_|"Diagnostic process lock failed")?=Some(child);
    let success=loop {
        op.check()?;
        let status=op.child.lock().map_err(|_|"Diagnostic process lock failed")?
            .as_mut().ok_or("Diagnostic process closed")?.try_wait();
        match status {
            Ok(Some(status))=>break status.success(),
            Ok(None) if started.elapsed()<timeout=>thread::sleep(Duration::from_millis(50)),
            Ok(None)=>{op.cancel();return Err(timeout_error.into());},
            Err(_)=>{op.cancel();return Err(process_error.into());}
        }
    };
    let mut child=op.child.lock().map_err(|_|"Diagnostic process lock failed")?
        .take().ok_or("Diagnostic process closed")?;
    let mut bytes=Vec::new();
    if let Some(stdout)=child.stdout.take(){
        let _=stdout.take(limit).read_to_end(&mut bytes);
    }
    op.check()?;
    let output=String::from_utf8_lossy(&bytes).chars()
        .filter(|c|!c.is_control()||matches!(c,'\n'|'\r'|'\t')).collect();
    Ok((success,output))
}
fn ping(target:PingTarget,op:&Diagnostic)->Result<PingResult,String>{
    let started=Instant::now();
    let args=ping_args(&target.host,cfg!(windows))?;
    #[cfg(windows)]
    let executable=std::env::var_os("SystemRoot")
        .map(|root|std::path::PathBuf::from(root).join("System32").join("ping.exe"))
        .ok_or_else(||"Windows ping utility unavailable".to_string())?;
    #[cfg(not(windows))]
    let executable=std::path::PathBuf::from("/usr/bin/ping");
    let child=Command::new(executable).args(args)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null())
        .spawn().map_err(|_|"System ping utility unavailable".to_string())?;
    let (success,output)=process_output(op,child,started,Duration::from_secs(10),4096,
        "Ping timed out","Ping process failed")?;
    Ok(PingResult{reachable:success,elapsed_ms:started.elapsed().as_millis(),output})
}
#[tauri::command]
pub async fn network_ping(id:String,target:PingTarget,app:tauri::AppHandle)->Result<PingResult,String>{
    let active=register(id,&app)?;
    tauri::async_runtime::spawn_blocking(move||ping(target,&active.op)).await
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
fn trace(target:TraceTarget,op:&Diagnostic)->Result<TraceResult,String>{
    let started=Instant::now();
    let args=trace_args(&target.host,cfg!(windows))?;
    #[cfg(windows)]
    let executable=std::env::var_os("SystemRoot")
        .map(|root|std::path::PathBuf::from(root).join("System32").join("tracert.exe"))
        .ok_or_else(||"Windows traceroute utility unavailable".to_string())?;
    #[cfg(not(windows))]
    let executable=std::path::PathBuf::from("/usr/bin/traceroute");
    let child=Command::new(executable).args(args)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null())
        .spawn().map_err(|_|"System traceroute utility unavailable".to_string())?;
    let (_,output)=process_output(op,child,started,Duration::from_secs(25),8192,
        "Traceroute timed out","Traceroute process failed")?;
    Ok(TraceResult{elapsed_ms:started.elapsed().as_millis(),output})
}
#[tauri::command]
pub async fn network_trace(id:String,target:TraceTarget,app:tauri::AppHandle)->Result<TraceResult,String>{
    let active=register(id,&app)?;
    tauri::async_runtime::spawn_blocking(move||trace(target,&active.op)).await
        .map_err(|_|"Diagnostic worker failed".to_string())?
}


#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
pub struct PortScanTarget {host:String,ports:Vec<u16>}

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct PortStatus {port:u16,reachable:bool}

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct PortScanResult {addresses:Vec<String>,results:Vec<PortStatus>,elapsed_ms:u128}

fn validate_port_list(target:&PortScanTarget)->Result<(),String>{
    if !valid_host(&target.host){return Err("Invalid diagnostic host".into());}
    if target.ports.is_empty()||target.ports.len()>12{
        return Err("Select 1 to 12 explicit TCP ports".into());
    }
    let mut seen=std::collections::HashSet::new();
    for port in &target.ports{
        if *port==0||!seen.insert(*port){
            return Err("Invalid or repeated TCP port".into());
        }
    }
    Ok(())
}
fn scan_ports(target:PortScanTarget)->Result<PortScanResult,String>{
    validate_port_list(&target)?;
    let started=Instant::now();
    // Resolve once, then check only the specified ports; never scan ranges.
    let addresses=resolve(&ProbeTarget{host:target.host,port:1})?
        .into_iter().take(2).collect::<Vec<_>>();
    let results=target.ports.into_iter().map(|port|{
        let reachable=addresses.iter().any(|address|{
            let mut endpoint=*address;
            endpoint.set_port(port);
            TcpStream::connect_timeout(&endpoint,Duration::from_millis(400)).is_ok()
        });
        PortStatus{port,reachable}
    }).collect();
    Ok(PortScanResult{
        addresses:addresses.iter().map(|address|address.ip().to_string()).collect(),
        results,
        elapsed_ms:started.elapsed().as_millis()
    })
}
#[tauri::command]
pub async fn network_scan_ports(target:PortScanTarget)->Result<PortScanResult,String>{
    tauri::async_runtime::spawn_blocking(move||scan_ports(target)).await
        .map_err(|_|"Diagnostic worker failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancelling_a_running_diagnostic_stops_its_child(){
        #[cfg(windows)]
        let child=Command::new("ping").args(["-n","30","127.0.0.1"])
            .stdin(Stdio::null()).stdout(Stdio::piped()).spawn().unwrap();
        #[cfg(not(windows))]
        let child=Command::new("/usr/bin/sleep").arg("30")
            .stdin(Stdio::null()).stdout(Stdio::piped()).spawn().unwrap();
        let op=Arc::new(Diagnostic::default());
        let cancel=op.clone();
        let worker=thread::spawn(move||process_output(&op,child,Instant::now(),
            Duration::from_secs(40),4096,"timeout","failed"));
        thread::sleep(Duration::from_millis(150));
        cancel.cancel();
        let result=worker.join().unwrap();
        assert_eq!(result.unwrap_err(),"Diagnostic cancelled");
        cancel.finish_child();
    }
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
    fn multiport_rejects_invalid_hosts_duplicates_empty_large_lists_and_zero(){
        for ports in [vec![],vec![0],vec![22,22],(1..=13).collect()]{
            let target=PortScanTarget{host:"localhost".into(),ports};
            assert!(validate_port_list(&target).is_err());
        }
        assert!(validate_port_list(&PortScanTarget{
            host:"example.org;invalid".into(),ports:vec![22]
        }).is_err());
        assert!(validate_port_list(&PortScanTarget{
            host:"localhost".into(),ports:vec![22,80,443]
        }).is_ok());
    }
    #[test]
    fn multiport_checks_only_explicit_ports_against_loopback_listener(){
        let listener=std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port=listener.local_addr().unwrap().port();
        let result=scan_ports(PortScanTarget{
            host:"127.0.0.1".into(),ports:vec![port]
        }).unwrap();
        assert_eq!(result.results.len(),1);
        assert_eq!(result.results[0].port,port);
        assert!(result.results[0].reachable);
        assert_eq!(result.addresses,vec!["127.0.0.1"]);
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
