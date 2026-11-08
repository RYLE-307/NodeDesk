//! Explicit, loopback-only SSH local and dynamic forwarding. Existing host trust and key/agent auth only.
use std::{collections::HashMap,process::{Child,Command,Stdio},sync::{Arc,Mutex},time::Duration};
use serde::{Deserialize,Serialize};
use tauri::{ipc::Channel,State,Manager};

#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
pub struct LocalForward {ssh_host:String,ssh_port:u16,username:String,local_port:u16,
    #[serde(default)] kind:Option<ForwardKind>,#[serde(default)] remote_port:Option<u16>,target_host:String,target_port:u16}
#[derive(Clone,Copy,Deserialize,PartialEq,Eq)]
#[serde(rename_all="camelCase")]
enum ForwardKind { Local, Dynamic, Remote }
#[derive(Clone,Serialize)]
#[serde(tag="kind",content="value",rename_all="camelCase")]
pub enum TunnelEvent { Exit(u32), Error(String) }

struct Running {child:Arc<Mutex<Child>>,local_port:u16}
impl Drop for Running {fn drop(&mut self){if let Ok(mut child)=self.child.lock(){let _=child.kill();}}}
#[derive(Default)]
pub struct Tunnels(Mutex<HashMap<String,Running>>);
impl Tunnels {pub fn shutdown(&self){if let Ok(mut tunnels)=self.0.lock(){tunnels.clear();}}}

fn arguments(spec:&LocalForward)->Result<Vec<String>,String>{
    let kind=spec.kind.unwrap_or(ForwardKind::Local);
    if kind!=ForwardKind::Remote && spec.local_port<1024{return Err("Invalid local forward port".into());}
    match kind {
        ForwardKind::Local if spec.remote_port.is_some()||spec.target_port==0||!crate::network::valid_host(&spec.target_host)=>
            return Err("Invalid local forward target or port".into()),
        ForwardKind::Dynamic if spec.remote_port.is_some()||!spec.target_host.is_empty()||spec.target_port!=0=>
            return Err("Dynamic forward has no fixed target".into()),
        ForwardKind::Remote if spec.local_port!=0||spec.remote_port.unwrap_or(0)<1024||
            spec.target_host!="127.0.0.1"||spec.target_port==0=>
            return Err("Remote forward requires a nonprivileged remote port and a 127.0.0.1 local target".into()),
        _=>{}
    }
    let mut args=crate::ssh::arguments(&spec.ssh_host,spec.ssh_port,&spec.username,crate::ssh::AuthMode::Key)?;
    args.retain(|arg| !matches!(arg.as_str(),"-tt"|"-oClearAllForwardings=yes"|"-oBatchMode=no"|"-oNumberOfPasswordPrompts=3"|"-oStrictHostKeyChecking=ask"));
    let forward=match kind {
        ForwardKind::Local=>{
            let target=spec.target_host.trim_start_matches('[').trim_end_matches(']');
            let target=if target.contains(':'){format!("[{target}]")}else{target.into()};
            format!("127.0.0.1:{}:{target}:{}",spec.local_port,spec.target_port)
        },
        ForwardKind::Dynamic=>format!("127.0.0.1:{}",spec.local_port),
        ForwardKind::Remote=>format!("127.0.0.1:{}:127.0.0.1:{}",spec.remote_port.unwrap(),spec.target_port)
    };
    // Never expose the listening socket to the LAN. No prompt, config file,
    // agent forwarding, remote shell or fallback to an unknown host key.
    let destination=args.pop().ok_or("Missing SSH destination")?;
    args.extend(["-N".into(),"-T".into(),"-oBatchMode=yes".into(),"-oStrictHostKeyChecking=yes".into(),
        "-oClearAllForwardings=no".into(),"-oExitOnForwardFailure=yes".into(),"-oGatewayPorts=no".into(),
        (match kind {ForwardKind::Local=>"-L",ForwardKind::Dynamic=>"-D",ForwardKind::Remote=>"-R"}).into(),forward,destination]);
    Ok(args)
}
fn check_local_port(port:u16)->Result<(),String>{
    let listener=std::net::TcpListener::bind(("127.0.0.1",port))
        .map_err(|_|"Local port unavailable".to_string())?;
    drop(listener);
    Ok(())
}

#[tauri::command]
pub fn tunnel_start(id:String,spec:LocalForward,events:Channel<TunnelEvent>,state:State<'_,Tunnels>,app:tauri::AppHandle)->Result<(),String>{
    if id.len()!=36||!id.chars().all(|c|c.is_ascii_hexdigit()||c=='-'){return Err("Invalid tunnel ID".into());}
    let args=arguments(&spec)?;
    let mut tunnels=state.0.lock().map_err(|_|"Tunnel lock failed")?;
    if tunnels.contains_key(&id)||tunnels.len()>=8{return Err("Tunnel already exists or limit reached".into());}
    if spec.local_port!=0 && tunnels.values().any(|running|running.local_port==spec.local_port){return Err("Local port already used by a NodeDesk tunnel".into());}
    // Give a useful error before OpenSSH starts. ssh's ExitOnForwardFailure
    // remains authoritative if another process races this short preflight.
    if spec.local_port!=0 {check_local_port(spec.local_port)?;}
    let child=Command::new("ssh").args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
        .spawn().map_err(|_|"Cannot start OpenSSH tunnel".to_string())?;
    let child=Arc::new(Mutex::new(child));
    tunnels.insert(id.clone(),Running{child:child.clone(),local_port:spec.local_port});
    std::thread::spawn(move||loop{
        std::thread::sleep(Duration::from_millis(200));
        let status=match child.lock(){Ok(mut process)=>process.try_wait(),Err(_)=>break};
        match status{
            Ok(None)=>continue,
            Ok(Some(exit))=>{
                app.state::<Tunnels>().0.lock().ok().map(|mut items|items.remove(&id));
                let _=events.send(TunnelEvent::Exit(exit.code().unwrap_or(1) as u32));break;
            }
            Err(_)=>{
                app.state::<Tunnels>().0.lock().ok().map(|mut items|items.remove(&id));
                let _=events.send(TunnelEvent::Error("Cannot inspect SSH tunnel".into()));break;
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub fn tunnel_stop(id:String,state:State<'_,Tunnels>)->Result<(),String>{
    state.0.lock().map_err(|_|"Tunnel lock failed")?.remove(&id);
    Ok(())
}

#[cfg(test)]
mod tests{
    use super::*;
    fn sample()->LocalForward{LocalForward{ssh_host:"example.org".into(),ssh_port:22,username:"admin".into(),local_port:15432,kind:None,remote_port:None,target_host:"127.0.0.1".into(),target_port:5432}}
    #[test]fn local_forward_is_loopback_only_and_noninteractive(){
        let args=arguments(&sample()).unwrap();
        let option=args.iter().position(|arg|arg=="-L").unwrap();
        assert_eq!(args[option+1],"127.0.0.1:15432:127.0.0.1:5432");
        for flag in ["-F","-oBatchMode=yes","-oStrictHostKeyChecking=yes","-oExitOnForwardFailure=yes","-oForwardAgent=no","-N","-T"]{assert!(args.contains(&flag.into()));}
        assert!(!args.contains(&"-tt".into()));
        assert_eq!(args.last().unwrap(),"example.org");
    }
    #[test]fn rejects_unsafe_forward_parameters(){
        let mut spec=sample();spec.target_host="target;sh".into();assert!(arguments(&spec).is_err());
        spec=sample();spec.local_port=80;assert!(arguments(&spec).is_err());
        spec=sample();spec.ssh_host="-oProxyCommand=evil".into();assert!(arguments(&spec).is_err());
        spec=sample();spec.target_host="::1".into();assert!(arguments(&spec).unwrap().contains(&"127.0.0.1:15432:[::1]:5432".into()));
    }
    #[test]fn dynamic_forward_is_loopback_only_without_fixed_target(){
        let mut spec=sample();spec.kind=Some(ForwardKind::Dynamic);
        assert!(arguments(&spec).is_err());
        spec.target_host.clear();spec.target_port=0;
        let args=arguments(&spec).unwrap();
        let option=args.iter().position(|arg|arg=="-D").unwrap();
        assert_eq!(args[option+1],"127.0.0.1:15432");
        for flag in ["-oBatchMode=yes","-oStrictHostKeyChecking=yes","-oExitOnForwardFailure=yes","-oForwardAgent=no","-N","-T"]{
            assert!(args.contains(&flag.into()));
        }
        assert!(!args.contains(&"-L".into()));
    }
    #[test]fn remote_forward_is_explicit_and_restricts_local_target() {
        let mut spec=sample();
        spec.kind=Some(ForwardKind::Remote);spec.local_port=0;
        spec.remote_port=Some(18443);spec.target_port=8080;
        let args=arguments(&spec).unwrap();
        let pos=args.iter().position(|a|a=="-R").unwrap();
        assert_eq!(args[pos+1],"127.0.0.1:18443:127.0.0.1:8080");
        for flag in ["-oGatewayPorts=no","-oExitOnForwardFailure=yes",
                     "-oStrictHostKeyChecking=yes","-oForwardAgent=no","-N","-T"] {
            assert!(args.contains(&flag.into()));
        }
        assert!(!args.contains(&"-D".into()));
        for bad_host in ["0.0.0.0","localhost","192.168.1.1","[::1]"] {
            spec.target_host=bad_host.into();
            assert!(arguments(&spec).is_err());
        }
        spec.target_host="127.0.0.1".into();
        spec.remote_port=Some(80);assert!(arguments(&spec).is_err());
        spec.remote_port=None;assert!(arguments(&spec).is_err());
        spec.remote_port=Some(18443);spec.local_port=15432;
        assert!(arguments(&spec).is_err());
        spec.local_port=0;spec.target_port=0;
        assert!(arguments(&spec).is_err());
    }
    #[test]fn occupied_loopback_port_is_detectable_without_ssh(){
        let listener=std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port=listener.local_addr().unwrap().port();
        assert_eq!(check_local_port(port).unwrap_err(),"Local port unavailable");
    }
    #[cfg(unix)]
    #[test]fn real_loopback_forward_uses_trusted_disposable_ssh_server(){
        use std::io::{Read,Write};
        struct KillOnDrop(Child);
        impl Drop for KillOnDrop{fn drop(&mut self){let _=self.0.kill();let _=self.0.wait();}}
        let Ok(dir)=std::env::var("NODEDESK_SSH_FIXTURE") else{return;};
        let target=std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        target.set_nonblocking(true).unwrap();
        let spare=std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let local_port=spare.local_addr().unwrap().port();drop(spare);
        let spec=LocalForward{ssh_host:"127.0.0.1".into(),ssh_port:22229,
            username:std::env::var("USER").unwrap(),local_port,kind:None,remote_port:None,target_host:"127.0.0.1".into(),
            target_port:target.local_addr().unwrap().port()};
        let mut command=Command::new("ssh");
        command.args([format!("-oUserKnownHostsFile={dir}/trusted-gui"),"-oGlobalKnownHostsFile=/dev/null".into(),
            "-oIdentitiesOnly=yes".into(),"-i".into(),format!("{dir}/client")]);
        command.args(arguments(&spec).unwrap()).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        let mut child=KillOnDrop(command.spawn().unwrap());
        let deadline=std::time::Instant::now()+Duration::from_secs(10);
        let mut client=loop{
            if let Ok(stream)=std::net::TcpStream::connect(("127.0.0.1",local_port)){break stream;}
            if child.0.try_wait().unwrap().is_some()||std::time::Instant::now()>deadline{
                panic!("Disposable SSH local forward did not listen");
            }
            std::thread::sleep(Duration::from_millis(50));
        };
        client.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        client.write_all(b"PING").unwrap();
        let (mut accepted,_)=loop{
            match target.accept(){Ok(pair)=>break pair,Err(error) if error.kind()==std::io::ErrorKind::WouldBlock=>{
                assert!(std::time::Instant::now()<deadline,"SSH forward did not reach target");
                std::thread::sleep(Duration::from_millis(20));
            },Err(error)=>panic!("Target listener failed: {error}")}
        };
        let mut request=[0u8;4];accepted.read_exact(&mut request).unwrap();assert_eq!(&request,b"PING");
        accepted.write_all(b"PONG").unwrap();
        let mut response=[0u8;4];client.read_exact(&mut response).unwrap();assert_eq!(&response,b"PONG");
    }
    #[cfg(unix)]
    #[test]fn real_remote_forward_reaches_local_loopback_fixture() {
        use std::io::{Read,Write};
        struct KillOnDrop(Child);
        impl Drop for KillOnDrop {fn drop(&mut self){let _=self.0.kill();let _=self.0.wait();}}
        let Ok(dir)=std::env::var("NODEDESK_SSH_FIXTURE") else{return;};
        let target=std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        target.set_nonblocking(true).unwrap();
        let remote=std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let remote_port=remote.local_addr().unwrap().port();drop(remote);
        let spec=LocalForward{ssh_host:"127.0.0.1".into(),ssh_port:22229,
            username:std::env::var("USER").unwrap(),local_port:0,
            kind:Some(ForwardKind::Remote),remote_port:Some(remote_port),
            target_host:"127.0.0.1".into(),target_port:target.local_addr().unwrap().port()};
        let mut command=Command::new("ssh");
        command.args([format!("-oUserKnownHostsFile={dir}/trusted-gui"),"-oGlobalKnownHostsFile=/dev/null".into(),
            "-oIdentitiesOnly=yes".into(),"-i".into(),format!("{dir}/client")]);
        command.args(arguments(&spec).unwrap()).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        let mut child=KillOnDrop(command.spawn().unwrap());
        let deadline=std::time::Instant::now()+Duration::from_secs(10);
        let mut remote_client=loop {
            if let Ok(stream)=std::net::TcpStream::connect(("127.0.0.1",remote_port)){break stream;}
            if child.0.try_wait().unwrap().is_some()||std::time::Instant::now()>deadline {
                panic!("Disposable SSH remote forward failed to listen");
            }
            std::thread::sleep(Duration::from_millis(50));
        };
        remote_client.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        remote_client.write_all(b"PING").unwrap();
        let (mut accepted,_)=loop {
            match target.accept() {
                Ok(pair)=>break pair,
                Err(e) if e.kind()==std::io::ErrorKind::WouldBlock=>{
                    assert!(std::time::Instant::now()<deadline,"Remote forward did not reach local loopback");
                    std::thread::sleep(Duration::from_millis(20));
                }
                Err(e)=>panic!("Local target failed: {e}")
            }
        };
        let mut request=[0u8;4];accepted.read_exact(&mut request).unwrap();
        assert_eq!(&request,b"PING");
        accepted.write_all(b"PONG").unwrap();
        let mut response=[0u8;4];remote_client.read_exact(&mut response).unwrap();
        assert_eq!(&response,b"PONG");
    }
    #[cfg(unix)]
    #[test]fn real_dynamic_socks_forward_reaches_only_explicit_test_target(){
        use std::io::{Read,Write};
        struct KillOnDrop(Child);
        impl Drop for KillOnDrop{fn drop(&mut self){let _=self.0.kill();let _=self.0.wait();}}
        let Ok(dir)=std::env::var("NODEDESK_SSH_FIXTURE") else{return;};
        let target=std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        target.set_nonblocking(true).unwrap();
        let spare=std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let local_port=spare.local_addr().unwrap().port();drop(spare);
        let spec=LocalForward{ssh_host:"127.0.0.1".into(),ssh_port:22229,
            username:std::env::var("USER").unwrap(),local_port,kind:Some(ForwardKind::Dynamic),remote_port:None,
            target_host:String::new(),target_port:0};
        let mut command=Command::new("ssh");
        command.args([format!("-oUserKnownHostsFile={dir}/trusted-gui"),"-oGlobalKnownHostsFile=/dev/null".into(),
            "-oIdentitiesOnly=yes".into(),"-i".into(),format!("{dir}/client")]);
        command.args(arguments(&spec).unwrap()).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        let mut child=KillOnDrop(command.spawn().unwrap());
        let deadline=std::time::Instant::now()+Duration::from_secs(10);
        let mut client=loop{
            if let Ok(stream)=std::net::TcpStream::connect(("127.0.0.1",local_port)){break stream;}
            if child.0.try_wait().unwrap().is_some()||std::time::Instant::now()>deadline{
                panic!("Disposable SSH SOCKS forward did not listen");
            }
            std::thread::sleep(Duration::from_millis(50));
        };
        client.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        client.write_all(&[5,1,0]).unwrap();
        let mut greeting=[0u8;2];client.read_exact(&mut greeting).unwrap();assert_eq!(greeting,[5,0]);
        let port=target.local_addr().unwrap().port();
        let mut request=vec![5,1,0,1,127,0,0,1];request.extend(port.to_be_bytes());
        client.write_all(&request).unwrap();
        let mut reply=[0u8;10];client.read_exact(&mut reply).unwrap();
        assert_eq!(&reply[..4],&[5,0,0,1]);
        client.write_all(b"PING").unwrap();
        let (mut accepted,_)=loop{
            match target.accept(){Ok(pair)=>break pair,Err(error) if error.kind()==std::io::ErrorKind::WouldBlock=>{
                assert!(std::time::Instant::now()<deadline,"SOCKS forward did not reach target");
                std::thread::sleep(Duration::from_millis(20));
            },Err(error)=>panic!("Target listener failed: {error}")}
        };
        let mut payload=[0u8;4];accepted.read_exact(&mut payload).unwrap();assert_eq!(&payload,b"PING");
        accepted.write_all(b"PONG").unwrap();
        client.read_exact(&mut payload).unwrap();assert_eq!(&payload,b"PONG");
    }
}
