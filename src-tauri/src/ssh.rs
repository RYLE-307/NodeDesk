use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize, Child};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, io::{Read, Write}, sync::{Arc, Mutex}};
use tauri::{ipc::Channel, State, Manager};

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
}
impl Sessions { pub fn shutdown(&self) { if let Ok(mut sessions) = self.0.lock() { sessions.clear(); } } }
impl Drop for Session { fn drop(&mut self) { if let Ok(mut child) = self.child.lock() { if matches!(child.try_wait(), Ok(None)) { let _ = child.kill(); } } } }
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AuthMode { Auto, Key, Password }

#[derive(Default)]
pub struct Sessions(Mutex<HashMap<String, Session>>);
#[derive(Clone, Serialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum Event { Data(Vec<u8>), Exit(u32), Error(String) }
fn size(cols: u16, rows: u16) -> Result<PtySize, String> {
    if !(2..=500).contains(&cols) || !(2..=300).contains(&rows) { return Err("Invalid terminal size".into()); }
    Ok(PtySize { cols, rows, pixel_width: 0, pixel_height: 0 })
}
fn arguments(host: &str, port: u16, username: &str, auth: AuthMode) -> Result<Vec<String>, String> {
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
#[tauri::command]
pub fn ssh_connect(id: String, host: String, port: u16, username: String, auth: AuthMode, cols: u16, rows: u16, events: Channel<Event>, app: tauri::AppHandle, state: State<'_, Sessions>) -> Result<(), String> {
    if id.len() > 100 || id.is_empty() { return Err("Invalid session ID".into()); }
    let args = arguments(&host, port, &username, auth)?;
    let mut sessions = state.0.lock().map_err(|_| "Session lock failed")?;
    if sessions.contains_key(&id) || sessions.len() >= 16 { return Err("Session already exists or limit reached".into()); }
    let pair = native_pty_system().openpty(size(cols, rows)?).map_err(|e| e.to_string())?;
    let mut command = CommandBuilder::new("ssh");
    command.args(args);
    command.env("TERM", "xterm-256color");
    command.env("SSH_ASKPASS_REQUIRE", "never");
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let child = pair.slave.spawn_command(command).map_err(|e| format!("Cannot start OpenSSH: {e}"))?;
    drop(pair.slave);
    let child = Arc::new(Mutex::new(child));
    sessions.insert(id.clone(), Session { master: pair.master, writer: Arc::new(Mutex::new(writer)), child: child.clone() });
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
    #[test] fn dimensions() { assert!(size(0,24).is_err()); assert!(size(80,24).is_ok()); }
    #[test] fn close_is_idempotent() { let sessions = Sessions::default(); assert!(sessions.0.lock().unwrap().remove("missing").is_none()); }
    #[test]
    fn dropping_session_terminates_and_reaps_child() {
        let pair = native_pty_system().openpty(size(80,24).unwrap()).unwrap();
        #[cfg(unix)] let mut cmd = CommandBuilder::new("sleep");
        #[cfg(unix)] cmd.arg("60");
        #[cfg(windows)] let mut cmd = CommandBuilder::new("cmd.exe");
        #[cfg(windows)] cmd.args(["/c", "ping -n 60 127.0.0.1 >nul"]);
        let child = Arc::new(Mutex::new(pair.slave.spawn_command(cmd).unwrap()));
        let session = Session { writer: Arc::new(Mutex::new(pair.master.take_writer().unwrap())), master: pair.master, child: child.clone() };
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
