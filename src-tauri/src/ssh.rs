use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize, Child};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, io::{Read, Write}, sync::{Arc, Mutex}};
use tauri::{ipc::Channel, State, Manager};

struct Session {
    master: Box<dyn MasterPty + Send>,
    bridge: Option<Bridge>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
}
impl Sessions { pub fn shutdown(&self) { if let Ok(mut sessions) = self.0.lock() { sessions.clear(); } } }
impl Drop for Session { fn drop(&mut self) { if let Ok(mut child) = self.child.lock() { if matches!(child.try_wait(), Ok(None)) { let _ = child.kill(); } } } }
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AuthMode { Auto, Key, Password }

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TerminalKind { Ssh, Sftp, FilesAuth }

#[derive(Default)]
pub struct Sessions(Mutex<HashMap<String, Session>>);

// A capability, never a password. Only the owning application session may select
// the private socket; callers cannot supply arbitrary paths or other destinations.
struct Bridge { directory: std::path::PathBuf, host: String, port: u16, username: String }
impl Bridge {
    fn new(id: &str, host: &str, port: u16, username: &str) -> Result<Self,String> {
        arguments(host,port,username,AuthMode::Auto)?;
        if id.len()!=36 || !id.chars().all(|c| c.is_ascii_hexdigit() || c=='-') { return Err("Invalid bridge ID".into()); }
        #[cfg(not(unix))] { return Err("Interactive Files login currently requires Linux OpenSSH; Windows supports key/agent Files and password/PAM consoles".into()); }
        #[cfg(unix)] {
            use std::os::unix::fs::DirBuilderExt;
            // Short absolute path avoids AF_UNIX length limits. Exclusive creation
            // refuses pre-existing paths/symlinks; 0700 protects the auth capability.
            let directory=std::path::PathBuf::from(format!("/tmp/nd-{id}"));
            std::fs::DirBuilder::new().mode(0o700).create(&directory).map_err(|_| "Cannot create private auth directory")?;
            Ok(Self {directory,host:host.into(),port,username:username.into()})
        }
    }
    fn socket(&self) -> String { self.directory.join("s").to_string_lossy().into_owned() }
    fn arguments(&self, auth: AuthMode) -> Result<Vec<String>,String> {
        let mut args=arguments(&self.host,self.port,&self.username,auth)?;
        args.retain(|a| a!="-tt" && a!="-oControlMaster=no");
        let mut result=vec!["-N".into(),"-T".into(),"-oControlMaster=yes".into(),"-oControlPersist=no".into(),"-S".into(),self.socket()];
        result.extend(args); Ok(result)
    }
}
impl Drop for Bridge {
    fn drop(&mut self) {
        // Only our fixed socket and empty exclusive directory, never recursive.
        let _=std::fs::remove_file(self.directory.join("s"));
        let _=std::fs::remove_dir(&self.directory);
    }
}
pub(crate) fn files_socket(sessions: &Sessions, id: &str, host: &str, port: u16, username: &str) -> Result<String,String> {
    let sessions=sessions.0.lock().map_err(|_| "Session lock failed")?;
    let session=sessions.get(id).ok_or("Files login closed; reconnect")?;
    let bridge=session.bridge.as_ref().ok_or("Not a Files login session")?;
    if bridge.host!=host || bridge.port!=port || bridge.username!=username { return Err("Files login destination changed; reconnect".into()); }
    if session.child.lock().map_err(|_| "Process lock failed")?.try_wait().map_err(|_| "Cannot inspect login")?.is_some() { return Err("Files login exited; reconnect".into()); }
    #[cfg(unix)] {
        use std::os::unix::fs::FileTypeExt;
        if !std::fs::symlink_metadata(bridge.socket()).map(|m|m.file_type().is_socket()).unwrap_or(false) { return Err("Complete Files login first (host trust/password/PAM)".into()); }
    }
    Ok(bridge.socket())
}
#[tauri::command]
pub fn files_auth_ready(id: String, host: String, port: u16, username: String, state: State<'_,Sessions>) -> bool {
    files_socket(&state,&id,&host,port,&username).is_ok()
}
#[derive(Clone, Serialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum Event { Data(Vec<u8>), Exit(u32), Error(String) }
fn size(cols: u16, rows: u16) -> Result<PtySize, String> {
    if !(2..=500).contains(&cols) || !(2..=300).contains(&rows) { return Err("Invalid terminal size".into()); }
    Ok(PtySize { cols, rows, pixel_width: 0, pixel_height: 0 })
}
pub(crate) fn arguments(host: &str, port: u16, username: &str, auth: AuthMode) -> Result<Vec<String>, String> {
    if host.is_empty() || host.len() > 253 || host.starts_with('-') || !host.chars().all(|c| c.is_ascii_alphanumeric() || ".-:[]".contains(c)) || port == 0
        || username.is_empty() || username.len() > 200 || !username.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)) || username.starts_with('-') {
        return Err("Invalid SSH destination / username".into());
    }
    // Ignore user config: no ProxyCommand, LocalCommand, forwarding or multiplexing.
    // Password / keyboard-interactive prompts are handled by OpenSSH on its native PTY.
    // Its tty echo control hides secrets; NodeDesk neither stores nor logs input.
    // Host-key verification remains strict and is enforced before authentication.
    let (methods, pubkey, password, keyboard) = match auth {
        AuthMode::Auto => ("publickey,keyboard-interactive,password", "yes", "yes", "yes"),
        AuthMode::Key => ("publickey", "yes", "no", "no"),
        AuthMode::Password => ("keyboard-interactive,password", "no", "yes", "yes"),
    };
    let mut args: Vec<String> = [
        "-F", "none", "-tt",
        "-oStrictHostKeyChecking=ask", "-oUpdateHostKeys=no", "-oVerifyHostKeyDNS=no",
        "-oBatchMode=no", "-oNumberOfPasswordPrompts=3",
        "-oForwardAgent=no", "-oClearAllForwardings=yes",
        "-oPermitLocalCommand=no", "-oControlMaster=no",
        "-oConnectTimeout=15", "-oServerAliveInterval=15", "-oServerAliveCountMax=3",
        "-oEscapeChar=none",
    ].iter().map(|s| s.to_string()).collect();
    args.extend([
        format!("-oPreferredAuthentications={methods}"),
        format!("-oPubkeyAuthentication={pubkey}"),
        format!("-oPasswordAuthentication={password}"),
        format!("-oKbdInteractiveAuthentication={keyboard}"),
        "-p".into(),
    ]);
    args.extend([port.to_string(), "-l".into(), username.into(), host.into()]);
    Ok(args)
}
fn sftp_arguments(host: &str, port: u16, username: &str, auth: AuthMode) -> Result<Vec<String>, String> {
    // Reuse the validated OpenSSH destination and security/authentication settings.
    // sftp accepts -P for the port, not ssh's -p; its login is one user@host argument.
    let ssh_args = arguments(host, port, username, auth)?;
    let option_end = ssh_args.len().checked_sub(5).ok_or("Invalid SSH arguments")?;
    let mut args: Vec<String> = ssh_args[..option_end].iter()
        .filter(|value| value.as_str() != "-tt")
        .cloned()
        .collect();
    args.push("-P".into());
    args.push(port.to_string());
    let destination_host = if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else { host.to_string() };
    args.push(format!("{username}@{destination_host}"));
    Ok(args)
}
#[tauri::command]
pub fn ssh_connect(id: String, host: String, port: u16, username: String, auth: AuthMode, kind: TerminalKind, cols: u16, rows: u16, events: Channel<Event>, app: tauri::AppHandle, state: State<'_, Sessions>) -> Result<(), String> {
    if id.len() > 100 || id.is_empty() { return Err("Invalid session ID".into()); }
    let bridge = if kind == TerminalKind::FilesAuth { Some(Bridge::new(&id, &host, port, &username)?) } else { None };
    let (program, args) = match kind {
        TerminalKind::Ssh => ("ssh", arguments(&host, port, &username, auth)?),
        TerminalKind::Sftp => ("sftp", sftp_arguments(&host, port, &username, auth)?),
        TerminalKind::FilesAuth => ("ssh", bridge.as_ref().unwrap().arguments(auth)?),
    };
    let mut sessions = state.0.lock().map_err(|_| "Session lock failed")?;
    if sessions.contains_key(&id) || sessions.len() >= 16 { return Err("Session already exists or limit reached".into()); }
    let pair = native_pty_system().openpty(size(cols, rows)?).map_err(|e| e.to_string())?;
    let mut command = CommandBuilder::new(program);
    command.args(args);
    command.env("TERM", "xterm-256color");
    command.env("SSH_ASKPASS_REQUIRE", "never");
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let child = pair.slave.spawn_command(command).map_err(|e| format!("Cannot start OpenSSH: {e}"))?;
    drop(pair.slave);
    let child = Arc::new(Mutex::new(child));
    if let Some(auth_bridge)=&bridge {
        let socket=auth_bridge.socket(); let weak=Arc::downgrade(&child);
        // An abandoned prompt must not leave a login process alive indefinitely.
        std::thread::spawn(move || {
            for _ in 0..1200 {
                let Some(child)=weak.upgrade() else {return;};
                if std::path::Path::new(&socket).exists() {return;}
                if let Ok(mut c)=child.lock() {if !matches!(c.try_wait(),Ok(None)) {return;}}
                drop(child); std::thread::sleep(std::time::Duration::from_millis(100));
            }
            if let Some(child)=weak.upgrade() {if let Ok(mut c)=child.lock() {let _=c.kill();}}
        });
    }
    sessions.insert(id.clone(), Session { bridge, master: pair.master, writer: Arc::new(Mutex::new(writer)), child: child.clone() });
    std::thread::spawn(move || {
        let mut bytes = [0u8; 16384];
        loop { match reader.read(&mut bytes) {
            Ok(0) => break,
            Ok(n) => if events.send(Event::Data(bytes[..n].to_vec())).is_err() { if let Ok(mut child) = child.lock() { let _ = child.kill(); } break; },
            Err(_) => break, // Unix PTYs report EIO at normal child exit.
        }}
        let outcome = child.lock().unwrap().wait();
        app.state::<Sessions>().0.lock().unwrap().remove(&id);
        match outcome { Ok(status) => { let _ = events.send(Event::Exit(status.exit_code())); }, Err(_) => { let _ = events.send(Event::Error("SSH process wait failed".into())); } };
    });
    Ok(())
}
#[tauri::command]
pub async fn ssh_write(id: String, data: String, state: State<'_, Sessions>) -> Result<(), String> {
    if data.len() > 65536 { return Err("Input too large".into()); }
    let writer = state.0.lock().map_err(|_| "Session lock failed")?.get(&id).ok_or("Session closed")?.writer.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut writer = writer.lock().map_err(|_| "Input lock failed".to_string())?;
        writer.write_all(data.as_bytes()).and_then(|_| writer.flush()).map_err(|_| "SSH input failed".to_string())
    }).await.map_err(|_| "Input task failed".to_string())?
}
#[tauri::command]
pub fn ssh_resize(id: String, cols: u16, rows: u16, state: State<'_, Sessions>) -> Result<(), String> {
    state.0.lock().map_err(|_| "Session lock failed")?.get(&id).ok_or("Session closed")?.master.resize(size(cols, rows)?).map_err(|_| "SSH resize failed".into())
}
#[tauri::command]
pub fn ssh_disconnect(id: String, state: State<'_, Sessions>) -> Result<(), String> {
    state.0.lock().map_err(|_| "Session lock failed")?.remove(&id);
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn reject_injection() { for host in ["-oProxyCommand=evil", "a b", "x\n", "a;sh", ""] { assert!(arguments(host,22,"user",AuthMode::Auto).is_err()); } assert!(arguments("host",22,"-root",AuthMode::Auto).is_err()); }
    #[test] fn enforce_security() { let a = arguments("::1",22,"user",AuthMode::Auto).unwrap(); for option in ["-oStrictHostKeyChecking=ask", "-oPasswordAuthentication=yes", "-oKbdInteractiveAuthentication=yes", "-oBatchMode=no", "-oNumberOfPasswordPrompts=3", "-oForwardAgent=no"] { assert!(a.contains(&option.into())); } assert_eq!(&a[..2], ["-F", "none"]); }
    #[test]
    fn auth_modes_allow_only_requested_methods() {
        for (mode, methods, pubkey, password, keyboard) in [
            (AuthMode::Auto, "publickey,keyboard-interactive,password", "yes", "yes", "yes"),
            (AuthMode::Key, "publickey", "yes", "no", "no"),
            (AuthMode::Password, "keyboard-interactive,password", "no", "yes", "yes"),
        ] {
            let args = arguments("example.org", 22, "admin", mode).unwrap();
            for flag in [
                format!("-oPreferredAuthentications={methods}"),
                format!("-oPubkeyAuthentication={pubkey}"),
                format!("-oPasswordAuthentication={password}"),
                format!("-oKbdInteractiveAuthentication={keyboard}"),
                "-oStrictHostKeyChecking=ask".into(),
                "-oBatchMode=no".into(),
                "-oNumberOfPasswordPrompts=3".into(),
            ] {
                assert!(args.contains(&flag), "missing {flag:?} for {mode:?}");
            }
            assert!(!args.iter().any(|a| a.contains("StrictHostKeyChecking=no") || a.contains("Password=secret") || a.contains("ProxyCommand=")));
        }
    }
    #[test]
    fn sftp_uses_validated_openssh_options_and_port_syntax() {
        let args = sftp_arguments("example.com", 2222, "admin", AuthMode::Password).unwrap();
        assert_eq!(args[0..2], ["-F", "none"]);
        assert!(!args.contains(&"-tt".into()));
        for option in [
            "-oStrictHostKeyChecking=ask",
            "-oPasswordAuthentication=yes",
            "-oKbdInteractiveAuthentication=yes",
            "-oPubkeyAuthentication=no",
            "-oForwardAgent=no",
            "-oEscapeChar=none",
        ] { assert!(args.contains(&option.into()), "missing {option}"); }
        assert_eq!(&args[args.len()-3..], ["-P", "2222", "admin@example.com"]);
        assert_eq!(sftp_arguments("::1", 22, "root", AuthMode::Key).unwrap().last().unwrap(), "root@[::1]");
        for invalid in ["-oProxyCommand=evil", "evil host", "host; touch /tmp/test"] {
            assert!(sftp_arguments(invalid, 22, "root", AuthMode::Auto).is_err());
        }
    }
    #[test] fn dimensions() { assert!(size(0,24).is_err()); assert!(size(80,24).is_ok()); }
    #[test] fn close_is_idempotent() { let sessions = Sessions::default(); assert!(sessions.0.lock().unwrap().remove("missing").is_none()); }
    #[cfg(unix)]
    #[test]
    fn real_files_password_pam_bridge() {
        let Ok(dir)=std::env::var("NODEDESK_SSH_FIXTURE") else { return; };
        let user=std::fs::read_to_string(format!("{dir}/auth-user")).unwrap().trim().to_string();
        let secret=std::fs::read(format!("{dir}/auth-secret")).unwrap();
        for (case,method,known,valid) in [
            (0,"password","trusted-gui",true),
            (1,"keyboard-interactive","trusted-gui",true),
            (2,"password","trusted-gui",false),
            (3,"password","changed",true),
            (4,"keyboard-interactive","revoked",true),
            (5,"password","unknown-auth",true),
        ] {
            let id=format!("{:08x}-0000-0000-0000-{case:012x}",std::process::id());
            let bridge=Bridge::new(&id,"127.0.0.1",22229,&user).unwrap();
            let socket=bridge.socket();
            let pair=native_pty_system().openpty(size(100,30).unwrap()).unwrap();
            let mut cmd=CommandBuilder::new("ssh");
            cmd.args([format!("-oUserKnownHostsFile={dir}/{known}"),"-oGlobalKnownHostsFile=/dev/null".into(),"-oStrictHostKeyChecking=yes".into(),format!("-oPreferredAuthentications={method}")]);
            cmd.args(bridge.arguments(AuthMode::Password).unwrap());
            cmd.env("SSH_ASKPASS_REQUIRE","never");
            let mut reader=pair.master.try_clone_reader().unwrap();
            let writer=pair.master.take_writer().unwrap();
            let child=Arc::new(Mutex::new(pair.slave.spawn_command(cmd).unwrap())); drop(pair.slave);
            let session=Session {bridge:Some(bridge),master:pair.master,writer:Arc::new(Mutex::new(writer)),child:child.clone()};
            let (tx,rx)=std::sync::mpsc::channel();
            std::thread::spawn(move || { let mut b=[0;4096]; while let Ok(n)=reader.read(&mut b) {if n==0 || tx.send(b[..n].to_vec()).is_err() {break;}} });
            let deadline=std::time::Instant::now()+std::time::Duration::from_secs(20);
            let mut output=String::new(); let mut prompts=0;
            while std::time::Instant::now()<deadline {
                if let Ok(bytes)=rx.recv_timeout(std::time::Duration::from_millis(50)) {
                    output.push_str(&String::from_utf8_lossy(&bytes));
                    assert!(!output.as_bytes().windows(secret.len()).any(|w|w==secret),"secret echoed");
                    if output.to_lowercase().contains("assword:") {
                        prompts+=1; assert!(prompts<=3);
                        let mut w=session.writer.lock().unwrap();
                        w.write_all(if valid {&secret} else {b"incorrect-fixture-password"}).unwrap(); w.write_all(b"\n").unwrap(); w.flush().unwrap(); output.clear();
                    }
                }
                if std::path::Path::new(&socket).exists() || child.lock().unwrap().try_wait().unwrap().is_some() {break;}
            }
            let expect=valid && known=="trusted-gui";
            assert_eq!(std::path::Path::new(&socket).exists(),expect,"auth case {case}");
            if known!="trusted-gui" { assert_eq!(prompts,0,"must reject trust before requesting secrets"); }
            if expect {
                assert!(prompts>0);
                // No key/password fallback is possible: false proxy fails if the
                // authenticated master cannot serve a binary subsystem channel.
                let mut slave=std::process::Command::new("ssh").args(["-F","none","-S",&socket,"-oControlMaster=no","-oBatchMode=yes","-oProxyCommand=false","-T","-s","-p","22229","-l",&user,"127.0.0.1","sftp"]).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null()).spawn().unwrap();
                let mut client=crate::sftp_wire::Client::new(slave.stdout.take().unwrap(),slave.stdin.take().unwrap()).unwrap();
                let home=client.realpath(".").unwrap(); assert!(!home.is_empty());
                let target=crate::sftp_wire::join(&home,&format!("bridge-{case}.bin")).unwrap();
                let handle=client.open(&target,2|8|32).unwrap();
                let bytes:Vec<u8>=(0..65537).map(|n|(n%256) as u8).collect();
                client.write(&handle,0,&bytes).unwrap(); client.close(&handle).unwrap();
                let handle=client.open(&target,1).unwrap(); let mut received=vec![];
                while let Some(part)=client.read(&handle,received.len() as u64).unwrap() {received.extend(part);}
                client.close(&handle).unwrap(); assert_eq!(bytes,received);
                drop(client); let _=slave.kill(); let _=slave.wait();
            }
            drop(session); assert!(!std::path::Path::new(&socket).exists());
            assert!(child.lock().unwrap().try_wait().unwrap().is_some());
        }
    }
    #[test]
    fn dropping_session_terminates_and_reaps_child() {
        let pair = native_pty_system().openpty(size(80,24).unwrap()).unwrap();
        #[cfg(unix)] let mut cmd = CommandBuilder::new("sleep");
        #[cfg(unix)] cmd.arg("60");
        #[cfg(windows)] let mut cmd = CommandBuilder::new("cmd.exe");
        #[cfg(windows)] cmd.args(["/c", "ping -n 60 127.0.0.1 >nul"]);
        let child = Arc::new(Mutex::new(pair.slave.spawn_command(cmd).unwrap()));
        let session = Session { bridge: None, writer: Arc::new(Mutex::new(pair.master.take_writer().unwrap())), master: pair.master, child: child.clone() };
        drop(pair.slave);
        drop(session);
        for _ in 0..100 {
            if child.lock().unwrap().try_wait().unwrap().is_some() { return; }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        panic!("Child survived session close");
    }
    // Real OpenSSH/sshd integration; CI supplies an isolated server and identity.
    #[cfg(unix)]
    #[test]
    fn real_host_key_checks() {
        let Ok(dir) = std::env::var("NODEDESK_SSH_FIXTURE") else { return; };
        let user = std::env::var("USER").unwrap();
        let run = |known: &str, reply: &str, expected: &str| {
            let pair = native_pty_system().openpty(size(100,30).unwrap()).unwrap();
            let mut cmd = CommandBuilder::new("ssh");
            // Prepend fixture-only options; production always uses OS known_hosts.
            cmd.args([format!("-oUserKnownHostsFile={dir}/{known}"), "-oGlobalKnownHostsFile=/dev/null".into(), "-oIdentitiesOnly=yes".into(), "-i".into(), format!("{dir}/client")]);
            cmd.args(arguments("127.0.0.1", 22229, &user, AuthMode::Key).unwrap());
            cmd.arg("printf NODEDESK_CONNECTED; exit");
            cmd.env("SSH_ASKPASS_REQUIRE", "never");
            let mut reader = pair.master.try_clone_reader().unwrap();
            let mut writer = pair.master.take_writer().unwrap();
            let mut child = pair.slave.spawn_command(cmd).unwrap(); drop(pair.slave);
            let (tx, rx) = std::sync::mpsc::channel();
            std::thread::spawn(move || { let mut b=[0;4096]; while let Ok(n)=reader.read(&mut b) { if n==0 {break;} if tx.send(b[..n].to_vec()).is_err() {break;} } });
            let deadline = std::time::Instant::now()+std::time::Duration::from_secs(15);
            let mut output=String::new(); let mut answered=false;
            while std::time::Instant::now()<deadline {
                if let Ok(bytes)=rx.recv_timeout(std::time::Duration::from_millis(100)) { output.push_str(&String::from_utf8_lossy(&bytes)); }
                if !answered && output.contains("Are you sure") { writer.write_all(reply.as_bytes()).unwrap(); writer.flush().unwrap(); answered=true; }
                if child.try_wait().unwrap().is_some() { while let Ok(bytes)=rx.try_recv() { output.push_str(&String::from_utf8_lossy(&bytes)); } break; }
            }
            if child.try_wait().unwrap().is_none() { let _=child.kill(); let _=child.wait(); panic!("SSH fixture timed out: {output}"); }
            assert!(output.contains(expected), "Expected {expected}: {output}");
            if expected != "NODEDESK_CONNECTED" { assert!(!output.contains("NODEDESK_CONNECTED")); }
        };
        run("rejected", "no\n", "Host key verification failed");
        run("accepted", "yes\n", "NODEDESK_CONNECTED");
        run("accepted", "", "NODEDESK_CONNECTED");
        run("changed", "yes\n", "REMOTE HOST IDENTIFICATION HAS CHANGED");
        run("revoked", "yes\n", "REVOKED HOST KEY");
    }
}
