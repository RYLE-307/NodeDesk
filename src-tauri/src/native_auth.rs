//! Native Windows Files authentication. No shell, askpass, saved credentials or
//! credential-bearing process arguments. Also compiled/tested on Linux against sshd.
use crate::{ssh::{AuthMode, Event}, sftp_wire::{Client, Result}};
use base64::{engine::general_purpose::STANDARD, Engine};
use ssh2::{KeyboardInteractivePrompt, Prompt, Session};
use std::{collections::HashMap, io::{Read, Write}, net::{TcpStream, ToSocketAddrs, Shutdown}, path::PathBuf, process::Command, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}, mpsc::{self, Receiver, SyncSender}}, time::{Duration, Instant}};
use tauri::ipc::Channel;
use zeroize::Zeroize;

pub struct Login {
    host: String, port: u16, user: String,
    alive: AtomicBool,
    socket: Mutex<Option<TcpStream>>,
    session: Mutex<Option<Session>>,
    input: SyncSender<String>,
}
impl Login {
    pub fn close(&self) {
        self.alive.store(false, Ordering::SeqCst);
        if let Ok(socket)=self.socket.lock() { if let Some(socket)=socket.as_ref() { let _=socket.shutdown(Shutdown::Both); } }
    }
    fn ready(&self) -> bool { self.alive.load(Ordering::SeqCst) && self.session.lock().map(|s|s.is_some()).unwrap_or(false) }
}
#[derive(Default)]
pub struct Logins(Mutex<HashMap<String, Arc<Login>>>);
impl Logins {
    pub fn shutdown(&self) { if let Ok(mut logins)=self.0.lock() { for (_,login) in logins.drain() {login.close();} } }
    pub fn disconnect(&self,id:&str) { if let Ok(mut logins)=self.0.lock() {if let Some(login)=logins.remove(id) {login.close();}} }
    pub fn contains(&self,id:&str) -> bool {self.0.lock().map(|s|s.contains_key(id)).unwrap_or(false)}
    pub fn write(&self,id:&str,mut data:String) -> Result<()> {
        let login=self.0.lock().map_err(|_|"Login lock failed")?.get(id).cloned().ok_or("Login closed")?;
        if data.len()>65536 || !login.alive.load(Ordering::SeqCst) || login.ready() { data.zeroize(); return Err("Login input rejected (closed or already authenticated)".into()); }
        login.input.try_send(data).map_err(|e| {let (mpsc::TrySendError::Full(mut data)|mpsc::TrySendError::Disconnected(mut data))=e;data.zeroize();"Login input queue full or closed".into()})
    }
    pub fn ready(&self,id:&str,host:&str,port:u16,user:&str)->bool {self.get(id,host,port,user).map(|s|s.ready()).unwrap_or(false)}
    pub fn get(&self,id:&str,host:&str,port:u16,user:&str)->Result<Arc<Login>> {
        let login=self.0.lock().map_err(|_|"Login lock failed")?.get(id).cloned().ok_or("Files login closed; reconnect")?;
        if login.host!=host || login.port!=port || login.user!=user {return Err("Files login destination changed; reconnect".into());}
        Ok(login)
    }
    pub fn start(&self,id:String,host:String,port:u16,user:String,auth:AuthMode,events:Channel<Event>)->Result<()> {
        crate::ssh::arguments(&host,port,&user,auth)?;
        if id.len()!=36 || !id.chars().all(|c|c.is_ascii_hexdigit() || c=='-') {return Err("Invalid login ID".into());}
        if auth==AuthMode::Key {return Err("Native Files login supports password/PAM; uncheck interactive login for OpenSSH key/agent".into());}
        let (tx,rx)=mpsc::sync_channel(32);
        let login=Arc::new(Login {host,port,user,alive:AtomicBool::new(true),socket:Mutex::new(None),session:Mutex::new(None),input:tx});
        let mut logins=self.0.lock().map_err(|_|"Login lock failed")?;
        if logins.len()>=16 || logins.contains_key(&id) {return Err("Login limit or duplicate ID".into());}
        logins.insert(id,login.clone()); drop(logins);
        std::thread::spawn(move || {
            let mut prompt=Prompter {login:login.clone(),rx,events:events.clone(),deadline:Instant::now()+Duration::from_secs(120),failed:false};
            let result=authenticate(&login,&mut prompt,&known_files(),"auto");
            match result {
                Ok(session) if login.alive.load(Ordering::SeqCst) => {
                    *login.session.lock().unwrap()=Some(session);
                    if emit(&events,"\r\nAuthenticated. Files ready.\r\n").is_err() {login.close();}
                    while login.alive.load(Ordering::SeqCst) {std::thread::sleep(Duration::from_millis(100));}
                    let _=events.send(Event::Exit(0));
                }
                _ => {login.close();let _=events.send(Event::Error("Files login failed, cancelled or host key not trusted. Trust new keys using the OpenSSH console after verifying the fingerprint.".into()));}
            }
            // Drain queued input without leaving secret strings in the queue.
            while let Ok(mut data)=prompt.rx.try_recv() {data.zeroize();}
        });
        Ok(())
    }
}
fn emit(events:&Channel<Event>,text:&str)->Result<()> {events.send(Event::Data(text.as_bytes().to_vec())).map_err(|_|"Login view closed".into())}
fn known_files()->Vec<PathBuf> {
    let mut files=Vec::new();
    if let Some(home)=std::env::var_os(if cfg!(windows){"USERPROFILE"}else{"HOME"}) {files.push(PathBuf::from(home).join(".ssh/known_hosts"));}
    #[cfg(windows)] if let Some(root)=std::env::var_os("ProgramData") {files.push(PathBuf::from(root).join("ssh/ssh_known_hosts"));}
    #[cfg(unix)] files.push(PathBuf::from("/etc/ssh/ssh_known_hosts"));
    files
}
// OpenSSH's matcher handles hashed hosts, patterns, negation and [host]:port.
// Only public host material goes through this process; never authentication data.
// Fail closed on missing/unreadable stores, errors, markers and conflicting keys.
fn trusted(host:&str,port:u16,key:&[u8],files:&[PathBuf])->Result<()> {
    let host=host.trim_start_matches('[').trim_end_matches(']');
    let query=if port==22 {host.to_string()} else {format!("[{host}]:{port}")};
    let expected=STANDARD.encode(key); let mut matched=false;
    let size=key.get(..4).ok_or("Invalid server host key")?;
    let size=u32::from_be_bytes(size.try_into().map_err(|_|"Invalid host key")?) as usize;
    let algorithm=std::str::from_utf8(key.get(4..4+size).ok_or("Invalid server key algorithm")?).map_err(|_|"Invalid server key algorithm")?;
    for file in files {
        match std::fs::metadata(file) {Ok(m) if m.is_file()=>{},Err(e) if e.kind()==std::io::ErrorKind::NotFound=>continue,_=>return Err("Cannot read host trust store".into())}
        let mut cmd=Command::new("ssh-keygen"); cmd.args(["-F",&query,"-f"]).arg(file);
        #[cfg(windows)] {use std::os::windows::process::CommandExt;cmd.creation_flags(0x08000000);}
        let output=cmd.output().map_err(|_|"OpenSSH ssh-keygen is required for host trust")?;
        if (!output.status.success() && output.status.code()!=Some(1)) || !output.stderr.is_empty() {return Err("Host trust lookup failed".into());}
        let text=std::str::from_utf8(&output.stdout).map_err(|_|"Invalid trust store")?;
        for line in text.lines().filter(|s|!s.starts_with('#') && !s.trim().is_empty()) {
            let fields:Vec<_>=line.split_whitespace().collect();
            // Certificates/CA trust are intentionally unsupported in this slice.
            // Reject all matching revoked entries, including an alternative key.
            if fields.first().is_some_and(|s|s.starts_with('@')) || fields.len()<3 {return Err("Revoked or unsupported host trust entry".into());}
            if fields[1]==algorithm {
                if fields[2]!=expected {return Err("Host key changed or conflicting trust entries".into());}
                matched=true;
            }
        }
    }
    if matched {Ok(())} else {Err("Unknown host key; verify and trust using OpenSSH console first".into())}
}
struct Prompter {login:Arc<Login>,rx:Receiver<String>,events:Channel<Event>,deadline:Instant,failed:bool}
fn safe_prompt(text:&str)->String {text.chars().filter(|c|!c.is_control()).take(512).collect()}
impl Prompter {
    fn answer(&mut self,label:&str)->Result<String> {
        emit(&self.events,&format!("\r\n{} ",safe_prompt(label)))?;
        let mut answer=String::new();
        while self.login.alive.load(Ordering::SeqCst) && Instant::now()<self.deadline {
            if let Ok(mut data)=self.rx.recv_timeout(Duration::from_millis(100)) {
                let mut complete=false; let mut cancel=false;
                for c in data.chars() {
                    match c {'\r'|'\n'=>{complete=true;break;},'\u{3}'|'\u{1b}'=>{cancel=true;break;},'\u{8}'|'\u{7f}'=>{answer.pop();},c if !c.is_control()=>answer.push(c),_=>{}}
                    if answer.len()>4096 {cancel=true;break;}
                }
                data.zeroize();
                if cancel {answer.zeroize();return Err("Login cancelled".into());}
                if complete {emit(&self.events,"\r\n")?;return Ok(answer);}
            }
        }
        answer.zeroize(); Err("Login cancelled or timed out".into())
    }
}
impl KeyboardInteractivePrompt for Prompter {
    fn prompt<'a>(&mut self,_user:&str,instructions:&str,prompts:&[Prompt<'a>])->Vec<String> {
        if prompts.len()>16 || self.failed {self.failed=true;return vec![];}
        if !instructions.is_empty() {if emit(&self.events,&safe_prompt(instructions)).is_err() {self.failed=true;return vec![];}}
        prompts.iter().map(|p|match self.answer(&p.text) {Ok(s)=>s,Err(_)=>{self.failed=true;String::new()}}).collect()
    }
}
fn authenticate(login:&Login,prompt:&mut Prompter,files:&[PathBuf],method:&str)->Result<Session> {
    let address=(login.host.trim_start_matches('[').trim_end_matches(']'),login.port).to_socket_addrs().map_err(|_|"Cannot resolve SSH host")?.next().ok_or("No SSH address")?;
    let tcp=TcpStream::connect_timeout(&address,Duration::from_secs(15)).map_err(|_|"SSH connection failed")?;
    *login.socket.lock().map_err(|_|"Socket lock failed")?=Some(tcp.try_clone().map_err(|_|"Socket clone failed")?);
    if !login.alive.load(Ordering::SeqCst) {login.close();return Err("Login cancelled".into());}
    let mut session=Session::new().map_err(|_|"SSH initialization failed")?;session.set_tcp_stream(tcp);session.set_timeout(15000);
    session.handshake().map_err(|_|"SSH handshake failed")?;
    let (key,_)=session.host_key().ok_or("Missing server host key")?;
    trusted(&login.host,login.port,key,files)?; // Must precede ALL credential prompts.
    let methods=session.auth_methods(&login.user).map_err(|_|"Cannot query SSH authentication")?.to_string();
    if method!="password" && methods.split(',').any(|s|s=="keyboard-interactive") {
        let _=session.userauth_keyboard_interactive(&login.user,prompt);
        if prompt.failed {return Err("Interactive login cancelled".into());}
    }
    if method!="keyboard-interactive" && !session.authenticated() && methods.split(',').any(|s|s=="password") {
        let mut password=prompt.answer("Password:")?;
        let outcome=session.userauth_password(&login.user,&password);password.zeroize();
        outcome.map_err(|_|"Password authentication failed")?;
    }
    if !session.authenticated() || !login.alive.load(Ordering::SeqCst) {return Err("Authentication failed".into());}
    Ok(session)
}
pub type StreamClient=Client<Box<dyn Read+Send>,Box<dyn Write+Send>>;
struct NativeStream {channel:ssh2::Channel,login:Arc<Login>}
impl Read for NativeStream {
    fn read(&mut self,bytes:&mut [u8])->std::io::Result<usize> {
        let result=self.channel.read(bytes);
        if result.as_ref().map(|n|*n==0).unwrap_or(true) {self.login.close();}
        result
    }
}
impl Write for NativeStream {
    fn write(&mut self,bytes:&[u8])->std::io::Result<usize> {
        let result=self.channel.write(bytes);if result.is_err() {self.login.close();}result
    }
    fn flush(&mut self)->std::io::Result<()> {let result=self.channel.flush();if result.is_err() {self.login.close();}result}
}
pub fn subsystem(login:&Arc<Login>)->Result<StreamClient> {
    if !login.ready() {return Err("Complete Files login first; reconnect after cancellation".into());}
    let session=login.session.lock().map_err(|_|"Session lock failed")?.as_ref().cloned().ok_or("Login closed")?;
    let mut channel=session.channel_session().map_err(|_|{login.close();"Cannot open SSH channel"})?;
    channel.subsystem("sftp").map_err(|_|{login.close();"SFTP subsystem unavailable"})?;
    let reader=NativeStream {channel:channel.clone(),login:login.clone()};
    let writer=NativeStream {channel,login:login.clone()};
    Client::new(Box::new(reader) as Box<dyn Read+Send>,Box::new(writer) as Box<dyn Write+Send>)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn event_bytes(body:tauri::ipc::InvokeResponseBody)->Vec<u8> {
        let tauri::ipc::InvokeResponseBody::Json(json)=body else {panic!("Expected JSON event");};
        let value:serde_json::Value=serde_json::from_str(&json).unwrap();
        assert_eq!(value["kind"],"data");serde_json::from_value(value["value"].clone()).unwrap()
    }
    fn login()->(Arc<Login>,Receiver<String>) {
        let (input,rx)=mpsc::sync_channel(32);
        (Arc::new(Login {host:"127.0.0.1".into(),port:22229,user:"fixture".into(),alive:AtomicBool::new(true),socket:Mutex::new(None),session:Mutex::new(None),input}),rx)
    }
    #[test] fn hidden_input_backspace_cancel_and_sanitized_prompt() {
        let (login,rx)=login();let output=Arc::new(Mutex::new(Vec::new()));let capture=output.clone();
        let events=Channel::new(move |event| {capture.lock().unwrap().extend(event_bytes(event));Ok(())});
        let mut p=Prompter {login:login.clone(),rx,events,deadline:Instant::now()+Duration::from_secs(1),failed:false};
        login.input.send("disposable-X\u{7f}Y\r".into()).unwrap();
        let mut answer=p.answer("\x1b[31mPassword:\n").unwrap();assert_eq!(answer,"disposable-Y");answer.zeroize();
        let captured=output.lock().unwrap();let captured=String::from_utf8_lossy(&captured);
        assert!(!captured.contains("disposable"));assert!(!captured.contains('\x1b'));
        login.input.send("\u{3}".into()).unwrap();assert!(p.answer("Password:").is_err());
        login.close();assert!(!login.ready());assert!(p.answer("Password:").is_err());
    }
    #[test] fn destination_bound_and_disconnect() {
        let registry=Logins::default();let (login,_rx)=login();registry.0.lock().unwrap().insert("test".into(),login.clone());
        assert!(registry.get("test","other",22229,"fixture").is_err());
        assert!(registry.get("test","127.0.0.1",22,"fixture").is_err());
        assert!(registry.get("test","127.0.0.1",22229,"other").is_err());
        registry.disconnect("test");registry.disconnect("test");assert!(!login.alive.load(Ordering::SeqCst));assert!(!registry.contains("test"));
    }
    #[test] fn real_native_password_pam_trust_binary_and_cancel() {
        let Ok(dir)=std::env::var("NODEDESK_SSH_FIXTURE") else {return;};
        let user=std::fs::read_to_string(format!("{dir}/auth-user")).unwrap();
        let secret=std::fs::read_to_string(format!("{dir}/auth-secret")).unwrap();
        for (case,method,known,valid) in [
            (0,"password","trusted-gui",true),(1,"keyboard-interactive","trusted-gui",true),
            (2,"password","trusted-gui",false),(3,"password","changed",true),
            (4,"keyboard-interactive","revoked",true),(5,"password","native-unknown",true),
            (6,"password","trusted-hashed",true),
        ] {
            let (input,rx)=mpsc::sync_channel(32);
            let login=Arc::new(Login {host:"127.0.0.1".into(),port:22229,user:user.clone(),alive:AtomicBool::new(true),socket:Mutex::new(None),session:Mutex::new(None),input});
            let seen=Arc::new(Mutex::new(Vec::new()));let capture=seen.clone();let send=login.input.clone();
            let response=if valid {secret.clone()}else{"incorrect-fixture-password".into()};
            let events=Channel::new(move |event| {
                {
                    let bytes=event_bytes(event);
                    if String::from_utf8_lossy(&bytes).to_lowercase().contains("assword:") {let _=send.try_send(format!("{response}\r"));}
                    capture.lock().unwrap().extend(bytes);
                }Ok(())
            });
            let mut prompt=Prompter {login:login.clone(),rx,events,deadline:Instant::now()+Duration::from_secs(20),failed:false};
            let result=authenticate(&login,&mut prompt,&[PathBuf::from(&dir).join(known)],method);
            let trusted=known=="trusted-gui" || known=="trusted-hashed";
            let expect=valid && trusted;
            assert_eq!(result.is_ok(),expect,"native auth case {case}");
            let output=String::from_utf8(seen.lock().unwrap().clone()).unwrap();assert!(!output.contains(&secret));
            if !trusted {assert!(output.is_empty(),"trust must precede any credential prompt");}
            if let Ok(session)=result {
                *login.session.lock().unwrap()=Some(session);
                crate::files::verify_native_adapter(login.clone(),&user,&dir,case);
            }
            login.close();assert!(!login.ready());
        }
    }
}
