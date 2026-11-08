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
pub enum TerminalKind { Ssh, Sftp, FilesAuth, Local, LocalCmd }

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
pub fn files_auth_ready(id: String, host: String, port: u16, username: String, state: State<'_,Sessions>, app: tauri::AppHandle) -> bool {
    #[cfg(windows)] return app.state::<crate::native_auth::Logins>().ready(&id,&host,port,&username);
    #[cfg(not(windows))] let _=app;
    #[cfg(not(windows))]
    files_socket(&state,&id,&host,port,&username).is_ok()
}

/// Safe preview of the fixed per-user OpenSSH config. This deliberately does
/// NOT evaluate Include, Match, ProxyCommand, ProxyJump, IdentityFile, %-
/// substitutions, shell expansions or environment variables. NodeDesk's SSH
/// connection still uses -F none; selecting a preview only fills form fields.
#[derive(Clone,Serialize,Debug,PartialEq,Eq)]
#[serde(rename_all="camelCase")]
pub struct ConfigHost { alias:String, host:String, port:u16, username:String }
fn ssh_name_ok(host:&str)->bool {
    !host.is_empty() && host.len()<=253 && !host.starts_with('-') &&
    host.chars().all(|c|c.is_ascii_alphanumeric() || ".-:[]".contains(c))
}
fn ssh_user_ok(user:&str)->bool {
    user.is_empty() || user.len()<=200 &&
        !user.starts_with('-') &&
        user.chars().all(|c|c.is_ascii_alphanumeric()||"._-".contains(c))
}
fn ssh_config_hosts(input:&str)->Vec<ConfigHost>{
    let mut items:Vec<ConfigHost>=vec![];
    let mut current:Option<ConfigHost>=None;
    let flush=|value:Option<ConfigHost>, items:&mut Vec<ConfigHost>| {
        if let Some(entry)=value {
            if ssh_name_ok(&entry.alias)&&ssh_name_ok(&entry.host)&&ssh_user_ok(&entry.username) &&
                entry.port!=0 && !items.iter().any(|x|x.alias.eq_ignore_ascii_case(&entry.alias)) &&
                items.len()<40 {items.push(entry);}
        }
    };
    for line in input.lines().take(1000) {
        if line.len()>1024 {continue;}
        let raw=line.trim_start();
        if raw.starts_with('#')||raw.is_empty(){continue;}
        // Quoted arguments and line-continuations are intentionally unsupported.
        if raw.contains(['"', '\'', '\\']){continue;}
        let (key,rest)=raw.split_once(|c:char|c.is_whitespace()||c=='=')
            .unwrap_or((raw,""));
        let val=rest.trim_start_matches(|c:char|c.is_whitespace()||c=='=')
            .split('#').next().unwrap_or("").trim();
        let one=val.split_whitespace().collect::<Vec<_>>();
        match key.to_ascii_lowercase().as_str(){
            "host"=>{
                flush(current.take(),&mut items);
                // Wildcards, exclusions and multiple aliases are not imported:
                // evaluating their precedence requires a real OpenSSH parser.
                if one.len()==1&&ssh_name_ok(one[0]) &&
                    !one[0].contains(['*','?','!']) {
                    current=Some(ConfigHost{alias:one[0].into(),host:one[0].into(),
                        port:22,username:String::new()});
                }
            }
            "match"=>{flush(current.take(),&mut items);}
            "hostname" if one.len()==1 => {
                if let Some(entry)=current.as_mut(){
                    if entry.host==entry.alias && ssh_name_ok(one[0]){
                        entry.host=one[0].into();
                    }
                }
            }
            "user" if one.len()==1=>{
                if let Some(entry)=current.as_mut(){
                    if entry.username.is_empty() && ssh_user_ok(one[0]){
                        entry.username=one[0].into();
                    }
                }
            }
            "port" if one.len()==1=>{
                if let Some(entry)=current.as_mut(){
                    if entry.port==22{
                        if let Ok(port)=one[0].parse::<u16>(){
                            if port!=0{entry.port=port;}
                        }
                    }
                }
            }
            _=>{} // Never import executable directives, include files or secrets.
        }
    }
    flush(current,&mut items);
    items
}
#[tauri::command]
pub fn ssh_config_preview()->Result<Vec<ConfigHost>,String>{
    #[cfg(windows)]
    let home=std::env::var_os("USERPROFILE").ok_or("User profile directory unavailable")?;
    #[cfg(not(windows))]
    let home=std::env::var_os("HOME").ok_or("Home directory unavailable")?;
    let path=std::path::PathBuf::from(home).join(".ssh").join("config");
    let metadata=std::fs::symlink_metadata(&path)
        .map_err(|_|"No local ~/.ssh/config found")?;
    if !metadata.file_type().is_file()||metadata.len()>65536{
        return Err("SSH config must be a regular file no larger than 64 KiB".into());
    }
    let content=std::fs::read_to_string(&path)
        .map_err(|_|"Cannot read UTF-8 SSH configuration".to_string())?;
    Ok(ssh_config_hosts(&content))
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

#[derive(Clone,Debug,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct JumpHost {host:String,port:u16,username:String}
fn jump_destination(jump:&JumpHost,target_host:&str,target_port:u16,target_user:&str)->Result<String,String>{
    // The jump is a single literal host, never a config alias, URI or chain.
    // Reject all metacharacters before handing a single -J argument to OpenSSH.
    arguments(&jump.host,jump.port,&jump.username,AuthMode::Key)?;
    if jump.host==target_host && jump.port==target_port && jump.username==target_user{
        return Err("A jump host must not be identical to the target".into());
    }
    let host=if jump.host.contains(':')&&!jump.host.starts_with('['){
        format!("[{}]",jump.host)
    }else{jump.host.clone()};
    Ok(format!("{}@{}:{}",jump.username,host,jump.port))
}
fn with_jump(mut args:Vec<String>,jump:Option<&JumpHost>,
    host:&str,port:u16,username:&str)->Result<Vec<String>,String>{
    if let Some(jump)=jump{
        let spec=jump_destination(jump,host,port,username)?;
        // Options are passed as separate argv entries. No shell and no
        // ProxyCommand string constructed by NodeDesk. OpenSSH itself
        // handles -J; the jump's own ssh_config differs from the target.
        let index=args.len().checked_sub(1).ok_or("Missing SSH target")?;
        args.splice(index..index,["-J".to_string(),spec]);
    }
    Ok(args)
}
pub(crate) fn with_identity(mut args: Vec<String>, identity: Option<&str>) -> Result<Vec<String>, String> {
    let Some(raw) = identity else { return Ok(args); };
    if raw.is_empty() || raw.len() > 4096 || raw.contains(['\0', '\n', '\r']) {
        return Err("Invalid SSH identity path".into());
    }
    let path = std::path::Path::new(raw);
    if !path.is_absolute() { return Err("SSH identity path must be absolute".into()); }
    let meta = std::fs::symlink_metadata(path).map_err(|_| "SSH identity file unavailable")?;
    if !meta.file_type().is_file() || meta.len() > 1024 * 1024 {
        return Err("SSH identity must be a regular file no larger than 1 MiB".into());
    }
    // OpenSSH performs its own private-key permission and passphrase checks.
    // A symlink is deliberately refused so the chosen file cannot silently change.
    let index = args.len().checked_sub(1).ok_or("Missing SSH target")?;
    args.splice(index..index, ["-oIdentitiesOnly=yes".into(), "-i".into(), raw.into()]);
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
fn local_command(kind: TerminalKind) -> Result<(String, Vec<String>), String> {
    #[cfg(windows)] {
        let root=std::env::var_os("SystemRoot").ok_or("Windows system directory unavailable")?;
        let suffix:&[&str]=match kind {
            TerminalKind::Local => &["System32", "WindowsPowerShell", "v1.0", "powershell.exe"],
            TerminalKind::LocalCmd => &["System32", "cmd.exe"],
            _ => return Err("Unsupported local shell".into()),
        };
        let path=std::path::PathBuf::from(root).join(suffix.iter().collect::<std::path::PathBuf>());
        if !path.is_file() {return Err("Local Windows shell unavailable".into());}
        let args=if kind==TerminalKind::Local {vec!["-NoLogo".into(),"-NoProfile".into()]}
            else {vec!["/Q".into()]};
        return Ok((path.to_string_lossy().into_owned(),args));
    }
    #[cfg(not(windows))] {
        if kind!=TerminalKind::Local {return Err("CMD is supported only on Windows".into());}
        let path="/bin/sh";
        if !std::path::Path::new(path).is_file() {return Err("Local shell unavailable".into());}
        Ok((path.into(),vec!["-i".into()]))
    }
}
#[tauri::command]
pub fn ssh_connect(id: String, host: String, port: u16, username: String, auth: AuthMode,
    kind: TerminalKind, jump: Option<JumpHost>, identity: Option<String>, cols: u16, rows: u16, events: Channel<Event>,
    app: tauri::AppHandle, state: State<'_, Sessions>) -> Result<(), String> {
    if jump.is_some() && !matches!(kind,TerminalKind::Ssh|TerminalKind::Sftp){
        return Err("Jump host is supported only in SSH/SFTP console tabs".into());
    }
    if identity.is_some() && (!matches!(kind,TerminalKind::Ssh|TerminalKind::Sftp) || auth!=AuthMode::Key || jump.is_some()) {
        return Err("Identity file requires direct key-only SSH/SFTP console".into());
    }
    #[cfg(windows)] if kind==TerminalKind::FilesAuth {return app.state::<crate::native_auth::Logins>().start(id,host,port,username,auth,events);}
    if id.len() > 100 || id.is_empty() { return Err("Invalid session ID".into()); }
    let bridge = if kind == TerminalKind::FilesAuth { Some(Bridge::new(&id, &host, port, &username)?) } else { None };
    let (program, args) = match kind {
        TerminalKind::Ssh => ("ssh".into(),with_identity(with_jump(arguments(&host,port,&username,auth)?,
            jump.as_ref(),&host,port,&username)?, identity.as_deref())?),
        TerminalKind::Sftp => ("sftp".into(),with_identity(with_jump(sftp_arguments(&host,port,&username,auth)?,
            jump.as_ref(),&host,port,&username)?, identity.as_deref())?),
        TerminalKind::FilesAuth => ("ssh".into(), bridge.as_ref().unwrap().arguments(auth)?),
        TerminalKind::Local | TerminalKind::LocalCmd => local_command(kind)?,
    };
    let mut sessions = state.0.lock().map_err(|_| "Session lock failed")?;
    if sessions.contains_key(&id) || sessions.len() >= 16 { return Err("Session already exists or limit reached".into()); }
    let pair = native_pty_system().openpty(size(cols, rows)?).map_err(|e| e.to_string())?;
    let mut command = CommandBuilder::new(program);
    command.args(args);
    command.env("TERM", "xterm-256color");
    if !matches!(kind, TerminalKind::Local | TerminalKind::LocalCmd) {command.env("SSH_ASKPASS_REQUIRE", "never");}
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let child = pair.slave.spawn_command(command).map_err(|e| format!("Cannot start terminal: {e}"))?;
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
pub async fn ssh_write(id: String, data: String, state: State<'_, Sessions>, app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(windows)] if app.state::<crate::native_auth::Logins>().contains(&id) {return app.state::<crate::native_auth::Logins>().write(&id,data);}
    #[cfg(not(windows))] let _=app;
    if data.len() > 65536 { return Err("Input too large".into()); }
    let writer = state.0.lock().map_err(|_| "Session lock failed")?.get(&id).ok_or("Session closed")?.writer.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut writer = writer.lock().map_err(|_| "Input lock failed".to_string())?;
        writer.write_all(data.as_bytes()).and_then(|_| writer.flush()).map_err(|_| "SSH input failed".to_string())
    }).await.map_err(|_| "Input task failed".to_string())?
}
#[tauri::command]
pub fn ssh_resize(id: String, cols: u16, rows: u16, state: State<'_, Sessions>, app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(windows)] if app.state::<crate::native_auth::Logins>().contains(&id) {return Ok(());}
    #[cfg(not(windows))] let _=app;
    state.0.lock().map_err(|_| "Session lock failed")?.get(&id).ok_or("Session closed")?.master.resize(size(cols, rows)?).map_err(|_| "SSH resize failed".into())
}
#[tauri::command]
pub fn ssh_disconnect(id: String, state: State<'_, Sessions>, app: tauri::AppHandle) -> Result<(), String> {
    app.state::<crate::native_auth::Logins>().disconnect(&id);
    state.0.lock().map_err(|_| "Session lock failed")?.remove(&id);
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identity_file_is_explicit_regular_file_and_never_changes_trust_policy() {
        let path = std::env::temp_dir().join(format!("nodedesk-identity-test-{}", std::process::id()));
        std::fs::write(&path, b"test key fixture").unwrap();
        let raw = path.to_str().unwrap();
        let args = with_identity(arguments("example.org", 22, "admin", AuthMode::Key).unwrap(), Some(raw)).unwrap();
        assert!(args.windows(2).any(|pair| pair == ["-i", raw]));
        assert!(args.contains(&"-oIdentitiesOnly=yes".to_string()));
        assert!(args.contains(&"-oStrictHostKeyChecking=ask".to_string()));
        assert_eq!(args.last().unwrap(), "example.org");
        assert!(with_identity(args.clone(), Some("relative-key")).is_err());
        assert!(with_identity(args.clone(), Some("/no/such/nodedesk-key")).is_err());
        assert!(with_identity(args.clone(), Some("/tmp/key\n-oStrictHostKeyChecking=no")).is_err());
        std::fs::remove_file(&path).unwrap();
        assert!(with_identity(args, Some(raw)).is_err());
    }
    #[test]
    fn read_only_config_preview_never_evaluates_ssh_commands_or_secrets(){
        let entries=ssh_config_hosts(r#"
Host example-prod
  HostName 192.0.2.7
  User deploy
  Port 2222
  ProxyCommand sh -c something-dangerous
  IdentityFile ~/.ssh/id_prod
  Include ~/.ssh/extra.conf
Host *.internal
  User catchall
Host -oProxyCommand=bad
  HostName other
Match host *
  User must_be_ignored
Host local
  HostName localhost
  User tester
"#);
        assert_eq!(entries.len(),2);
        assert_eq!(entries[0],ConfigHost{alias:"example-prod".into(),host:"192.0.2.7".into(),
            port:2222,username:"deploy".into()});
        assert_eq!(entries[1].alias,"local");
        assert_eq!(entries[1].username,"tester");
        assert!(!format!("{entries:?}").contains("something-dangerous"));
        assert!(!format!("{entries:?}").contains("id_prod"));
        assert!(ssh_config_hosts("Host *.com\n User bad\n").is_empty());
        assert!(ssh_config_hosts("Host name\n HostName -oProxyCommand=evil\n").iter()
            .all(|h|h.host=="name"));
    }
    #[test]
    fn jump_is_one_validated_literal_host_for_terminal_only(){
        let jump=JumpHost{host:"bastion.example.org".into(),port:2222,username:"gateway".into()};
        let ssh=with_jump(arguments("target.internal",22,"deploy",AuthMode::Key).unwrap(),
            Some(&jump),"target.internal",22,"deploy").unwrap();
        assert_eq!(&ssh[ssh.len()-3..],["-J","gateway@bastion.example.org:2222","target.internal"]);
        assert_eq!(&ssh[..2],["-F","none"]);
        let sftp=with_jump(sftp_arguments("target.internal",2223,"deploy",AuthMode::Key).unwrap(),
            Some(&jump),"target.internal",2223,"deploy").unwrap();
        assert_eq!(&sftp[sftp.len()-3..],["-J","gateway@bastion.example.org:2222","deploy@target.internal"]);
        for illegal in ["-oProxyCommand=bad","a,b","ssh://host","host;cmd","host example","host\nmal"]{
            let bad=JumpHost{host:illegal.into(),port:22,username:"gateway".into()};
            assert!(jump_destination(&bad,"target.internal",22,"deploy").is_err(),"{illegal}");
        }
        let same=JumpHost{host:"target.internal".into(),port:22,username:"deploy".into()};
        assert!(jump_destination(&same,"target.internal",22,"deploy").is_err());
    }
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
    #[test]
    fn local_shell_command_is_fixed_and_contains_no_user_input() {
        let (program,args)=local_command(TerminalKind::Local).unwrap();
        assert!(std::path::Path::new(&program).is_absolute());
        #[cfg(windows)] {
            assert!(program.ends_with("powershell.exe"));
            assert_eq!(args,vec!["-NoLogo".to_string(),"-NoProfile".to_string()]);
            let (cmd,cmd_args)=local_command(TerminalKind::LocalCmd).unwrap();
            assert!(cmd.ends_with("cmd.exe"));
            assert_eq!(cmd_args,vec!["/Q".to_string()]);
        }
        #[cfg(not(windows))] {
            assert_eq!(program,"/bin/sh");
            assert_eq!(args,vec!["-i".to_string()]);
            assert!(local_command(TerminalKind::LocalCmd).is_err());
        }
        assert!(local_command(TerminalKind::Ssh).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn local_shell_launches_inside_a_pty() {
        let (program,mut args)=local_command(TerminalKind::Local).unwrap();
        args.extend(["-c".into(),"printf ND_LOCAL_PTY_OK".into()]);
        let pair=native_pty_system().openpty(size(80,24).unwrap()).unwrap();
        let mut command=CommandBuilder::new(program);
        command.args(args);
        let mut reader=pair.master.try_clone_reader().unwrap();
        let mut child=pair.slave.spawn_command(command).unwrap();
        drop(pair.slave);
        let mut bytes=Vec::new();
        let mut chunk=[0u8;1024];
        loop {match reader.read(&mut chunk){Ok(0)|Err(_)=>break,Ok(n)=>bytes.extend_from_slice(&chunk[..n])}}
        assert_eq!(child.wait().unwrap().exit_code(),0);
        assert!(String::from_utf8_lossy(&bytes).contains("ND_LOCAL_PTY_OK"));
    }
    #[cfg(windows)]
    #[test]
    fn local_windows_shell_runs_fixed_command() {
        let (program,mut args)=local_command(TerminalKind::Local).unwrap();
        args.extend(["-Command".into(),"Write-Output ND_LOCAL_SHELL_OK".into()]);
        let output=std::process::Command::new(program).args(args).output().unwrap();
        assert!(output.status.success());
        assert!(String::from_utf8_lossy(&output.stdout).contains("ND_LOCAL_SHELL_OK"));
    }
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
                crate::files::verify_auth_bridge(&socket,&user,case,&dir);
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
                if child.try_wait().unwrap().is_some() {
                    // The PTY reader forwards output on a separate thread; the
                    // child can exit before that thread flushes its last lines.
                    // Wait briefly for buffered host-key errors instead of
                    // flaking on an empty channel immediately after exit.
                    while let Ok(bytes)=rx.recv_timeout(std::time::Duration::from_millis(250)) {
                        output.push_str(&String::from_utf8_lossy(&bytes));
                    }
                    break;
                }
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
