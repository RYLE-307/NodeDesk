//! User-initiated file operations. OpenSSH supplies authentication and host trust;
//! SFTP packets supply filesystem semantics. No shell, CLI listing or secret input.
use crate::{sftp_wire::{self as wire, Client, Result, CHUNK}, ssh::{self, AuthMode}};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs::{self, OpenOptions}, io::{Read, Write}, path::{Path, PathBuf}, process::{Child, Command, Stdio}, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}, time::{Duration, Instant}};
use tauri::{ipc::Channel, Manager, State};

#[derive(Clone, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Destination { host: String, port: u16, username: String, #[serde(default)] auth_session: Option<String>, #[serde(skip)] control: Option<String> }
fn resolve_auth(d: &mut Destination, app: &tauri::AppHandle) -> Result<()> {
    if let Some(id)=&d.auth_session { d.control=Some(ssh::files_socket(&app.state::<ssh::Sessions>(),id,&d.host,d.port,&d.username)?); }
    Ok(())
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Entry { name: String, kind: String, size: Option<u64>, modified: Option<u64>, permissions: Option<u32> }
#[derive(Serialize)]
pub struct Listing { path: String, entries: Vec<Entry> }
#[derive(Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub struct Progress { bytes: u64, total: Option<u64> }
#[derive(Default)]
struct Operation { cancelled: AtomicBool, child: Mutex<Option<Child>> }
impl Operation {
    fn check(&self) -> Result<()> { if self.cancelled.load(Ordering::SeqCst) { Err("Operation cancelled or timed out".into()) } else { Ok(()) } }
    fn cancel(&self) { self.cancelled.store(true,Ordering::SeqCst); self.stop(); }
    fn stop(&self) { if let Ok(mut c) = self.child.lock() { if let Some(mut child) = c.take() { let _ = child.kill(); let _ = child.wait(); } } }
}
#[derive(Default)]
struct Registry { active: HashMap<String,Arc<Operation>>, cancelled: HashMap<String,Instant> }
impl Registry {
    fn prune(&mut self) { self.cancelled.retain(|_,time| time.elapsed() < Duration::from_secs(120)); }
    fn insert(&mut self, id: &str, op: Arc<Operation>) -> Result<()> {
        self.prune();
        if self.cancelled.remove(id).is_some() { return Err("Operation cancelled before start".into()); }
        if self.active.len() >= 16 || self.active.contains_key(id) { return Err("Operation limit or duplicate ID".into()); }
        self.active.insert(id.into(),op); Ok(())
    }
    fn cancel(&mut self, id: String) -> Result<()> {
        self.prune();
        if let Some(op) = self.active.get(&id) { op.cancel(); }
        else {
            if self.cancelled.len() >= 64 { return Err("Pending cancellation limit".into()); }
            self.cancelled.insert(id,Instant::now());
        }
        Ok(())
    }
}
#[derive(Default)]
pub struct Operations(Mutex<Registry>);
impl Operations { pub fn shutdown(&self) { if let Ok(mut ops) = self.0.lock() { for (_,op) in ops.active.drain() { op.cancel(); } ops.cancelled.clear(); } } }
struct Guard { id: String, op: Arc<Operation>, app: tauri::AppHandle, done: Arc<AtomicBool> }
impl Drop for Guard {
    fn drop(&mut self) {
        self.done.store(true,Ordering::SeqCst); self.op.stop();
        if let Ok(mut ops) = self.app.state::<Operations>().0.lock() { ops.active.remove(&self.id); }
    }
}
fn operation_id(id: &str) -> Result<()> {
    if id.len() != 36 || !id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') { return Err("Invalid operation ID".into()); }
    Ok(())
}
fn register(id: &str, app: &tauri::AppHandle) -> Result<Guard> {
    operation_id(id)?;
    let state = app.state::<Operations>(); let mut ops = state.0.lock().map_err(|_| "Operation lock failed")?;
    let op = Arc::new(Operation::default()); ops.insert(id,op.clone())?;
    let done = Arc::new(AtomicBool::new(false));
    let weak = Arc::downgrade(&op); let finished = done.clone();
    // A bounded watchdog also interrupts a blocked pipe read/write on both platforms.
    std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(120);
        while !finished.load(Ordering::SeqCst) {
            if Instant::now() >= deadline { if let Some(op) = weak.upgrade() { op.cancel(); } break; }
            std::thread::sleep(Duration::from_millis(100));
        }
    });
    Ok(Guard { id:id.into(),op,app:app.clone(),done })
}
fn transport_args(d: &Destination) -> Result<Vec<String>> {
    let mut args = ssh::arguments(&d.host,d.port,&d.username,AuthMode::Key)?;
    args.retain(|a| a != "-tt" && a != "-oBatchMode=no" && a != "-oStrictHostKeyChecking=ask");
    // Insert before destination/options end. First value wins in OpenSSH.
    let mut strict = vec!["-T".into(),"-s".into(),"-oBatchMode=yes".into(),"-oStrictHostKeyChecking=yes".into(),"-oLogLevel=ERROR".into()];
    strict.extend(args); strict.push("sftp".into()); Ok(strict)
}
type Sftp = Client<std::process::ChildStdout,std::process::ChildStdin>;
fn connect(d: &Destination, op: &Operation) -> Result<Sftp> {
    op.check()?;
    let mut command = Command::new("ssh");
    if let Some(socket)=&d.control {
        // If the master vanished, fail closed instead of reconnecting/falling back.
        command.args(["-S",socket,"-oProxyCommand=false"]);
    }
    command.args(transport_args(d)?);
    spawn_transport(command,op)
}
fn spawn_transport(mut command: Command, op: &Operation) -> Result<Sftp> {
    command.env("SSH_ASKPASS_REQUIRE","never").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    let mut slot = op.child.lock().map_err(|_| "Process lock failed")?; op.check()?;
    let mut child = command.spawn().map_err(|_| "Cannot start OpenSSH".to_string())?;
    let reader = child.stdout.take().ok_or("Missing SSH output")?; let writer = child.stdin.take().ok_or("Missing SSH input")?;
    *slot = Some(child); drop(slot); Client::new(reader,writer)
}
fn local_dir(path: &str) -> Result<PathBuf> {
    let p = if path.is_empty() {
        std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from).ok_or("Home directory unavailable")?
    } else { PathBuf::from(path) };
    if !p.is_absolute() || p.components().any(|c| matches!(c,std::path::Component::ParentDir)) { return Err("Absolute local path required; no parent traversal".into()); }
    let p = fs::canonicalize(p).map_err(|_| "Local directory unavailable")?;
    if !p.is_dir() { return Err("Not a local directory".into()); } Ok(p)
}
fn local_list(path: &str, op: &Operation) -> Result<Listing> {
    let p = local_dir(path)?; let mut entries = vec![];
    for e in fs::read_dir(&p).map_err(|_| "Cannot read local directory")? {
        op.check()?;
        let e = e.map_err(|_| "Cannot read local entry")?; let m = fs::symlink_metadata(e.path()).map_err(|_| "Cannot inspect local entry")?;
        let name = e.file_name().into_string().map_err(|_| "Non-UTF-8 filename is unsupported")?;
        let kind = if m.is_symlink() { "symlink" } else if m.is_dir() { "directory" } else if m.is_file() { "file" } else { "other" };
        #[cfg(unix)] let permissions = { use std::os::unix::fs::PermissionsExt; Some(m.permissions().mode()) };
        #[cfg(not(unix))] let permissions = None;
        entries.push(Entry { name,kind:kind.into(),size:Some(m.len()), modified:m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d|d.as_secs()),permissions });
        if entries.len() > wire::MAX_ENTRIES { return Err("Directory entry limit (10000)".into()); }
    }
    let path = p.to_str().ok_or("Non-UTF-8 local path")?.to_string();
    Ok(Listing { path,entries })
}
fn remote_list(c: &mut Sftp, path: &str, op: &Operation) -> Result<Listing> {
    wire::path(path)?; let path = c.realpath(path)?; op.check()?;
    let entries = c.list(&path)?.into_iter().map(|(name,a)| Entry { name,kind:a.kind().into(),size:a.size,modified:a.modified.map(u64::from),permissions:a.permissions }).collect();
    op.check()?; Ok(Listing {path,entries})
}
#[tauri::command]
pub async fn files_list(id: String, mut destination: Option<Destination>, path: String, app: tauri::AppHandle) -> Result<Listing> {
    if let Some(d)=&mut destination { resolve_auth(d,&app)?; }
    let g = register(&id,&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = &g;
        match destination { Some(d) => { let mut c = connect(&d,&g.op)?; remote_list(&mut c,&path,&g.op) }, None => local_list(&path,&g.op) }
    }).await.map_err(|_| "File task failed".to_string())?
}
#[tauri::command]
pub fn files_cancel(id: String, state: State<'_,Operations>) -> Result<()> {
    operation_id(&id)?;
    state.0.lock().map_err(|_| "Operation lock failed")?.cancel(id)
}
fn private_new(path: &Path) -> Result<fs::File> {
    let mut options = OpenOptions::new(); options.write(true).create_new(true);
    #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
    options.open(path).map_err(|_| "Cannot create local file (destination may exist)".into())
}
struct PartialLocal(PathBuf);
impl Drop for PartialLocal { fn drop(&mut self) { let _ = fs::remove_file(&self.0); } }
fn copy_upload(c: &mut Sftp, source: &Path, remote: &str, temp: &str, op: &Operation, events: &Channel<Progress>) -> Result<()> {
    let before = fs::symlink_metadata(source).map_err(|_| "Local source unavailable")?;
    if !before.is_file() || before.is_symlink() { return Err("Only regular files can be uploaded".into()); }
    let mut options = OpenOptions::new(); options.read(true);
    #[cfg(windows)] { use std::os::windows::fs::OpenOptionsExt; options.custom_flags(0x00200000); } // OPEN_REPARSE_POINT
    let mut f = options.open(source).map_err(|_| "Cannot open local source")?;
    let opened = f.metadata().map_err(|_| "Cannot inspect local file")?;
    if !opened.is_file() || opened.is_symlink() { return Err("Source is not a regular file".into()); }
    #[cfg(unix)] {
        use std::os::unix::fs::MetadataExt;
        if before.dev() != opened.dev() || before.ino() != opened.ino() { return Err("Local source changed before open".into()); }
    }
    let size = opened.len();
    // EXCL|CREAT|WRITE; never opens/clobbers an existing remote path.
    let h = c.open(temp,2|8|32)?;
    let mut offset = 0; let mut bytes = vec![0;CHUNK];
    loop {
        op.check()?;
        let n = f.read(&mut bytes).map_err(|_| "Local read failed")?; if n == 0 { break; }
        c.write(&h,offset,&bytes[..n])?; offset += n as u64;
        events.send(Progress { bytes:offset,total:Some(size) }).map_err(|_| "Transfer view closed")?;
    }
    if offset != size || f.metadata().map_err(|_| "Cannot inspect source")?.len() != size { return Err("Source changed during upload".into()); }
    c.close(&h)?; op.check()?;
    let mut b = vec![]; wire::string(&mut b,temp.as_bytes()); wire::string(&mut b,remote.as_bytes());
    // SFTP v3 RENAME must fail if newpath already exists. Never use posix-rename.
    Client::<std::process::ChildStdout,std::process::ChildStdin>::ok(&c.request(18,b)?)
}
fn copy_download(c: &mut Sftp, remote: &str, target: &Path, temp: &Path, op: &Operation, events: &Channel<Progress>) -> Result<()> {
    let a = c.lstat(remote)?; if a.kind() != "file" { return Err("Only regular remote files can be downloaded".into()); }
    if target.symlink_metadata().is_ok() { return Err("Local destination already exists".into()); }
    let mut f = private_new(temp)?; let _partial = PartialLocal(temp.into()); let h = c.open(remote,1)?;
    let mut offset = 0;
    loop {
        op.check()?;
        let Some(bytes) = c.read(&h,offset)? else { break; };
        f.write_all(&bytes).map_err(|_| "Local write failed")?; offset += bytes.len() as u64;
        events.send(Progress {bytes:offset,total:a.size}).map_err(|_| "Transfer view closed")?;
    }
    c.close(&h)?;
    if a.size.is_some_and(|size| size != offset) { return Err("Remote source changed during download".into()); }
    f.sync_all().map_err(|_| "Local sync failed")?; drop(f); op.check()?;
    // Atomic no-replace publication (rename would overwrite on Unix).
    fs::hard_link(temp,target).map_err(|_| "Cannot publish download: destination exists or filesystem lacks hard links".to_string())?;
    Ok(())
}
#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Transfer { destination: Destination, local_directory: String, remote_directory: String, name: String, upload: bool }
#[tauri::command]
pub async fn files_transfer(id: String, mut request: Transfer, events: Channel<Progress>, app: tauri::AppHandle) -> Result<()> {
    resolve_auth(&mut request.destination,&app)?;
    wire::name(&request.name)?; wire::path(&request.remote_directory)?;
    let g = register(&id,&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = &g; let local = local_dir(&request.local_directory)?;
        let target = local.join(&request.name); let mut c = connect(&request.destination,&g.op)?;
        let parent = c.realpath(&request.remote_directory)?; let remote = wire::join(&parent,&request.name)?;
        let partial = format!(".nodedesk-{id}.part");
        if request.upload {
            let temp = wire::join(&parent,&partial)?;
            copy_upload(&mut c,&target,&remote,&temp,&g.op,&events).map_err(|e|format!("{e}; incomplete upload may remain at {temp}"))
        } else { copy_download(&mut c,&remote,&target,&local.join(partial),&g.op,&events) }
    }).await.map_err(|_| "Transfer task failed".to_string())?
}
#[cfg(all(test,unix))]
pub(crate) fn verify_auth_bridge(socket: &str, user: &str, case: i32, fixture: &str) {
    let d=Destination {host:"127.0.0.1".into(),port:22229,username:user.into(),auth_session:None,control:Some(socket.into())};
    let op=Arc::new(Operation::default());
    let result=(|| -> Result<()> {
        // Exercise the production connect/list/copy functions, not a parallel
        // test-only SSH command. No developer identity or secret is available.
        let mut c=connect(&d,&op)?;
        let home=c.realpath(".")?;
        remote_list(&mut c,&home,&op)?;
        let local=PathBuf::from(fixture).join(format!("auth-local-{case}")); fs::create_dir(&local).unwrap();
        let source=local.join("source.bin");
        let bytes:Vec<u8>=(0..65537).map(|n|(n%256) as u8).collect(); fs::write(&source,&bytes).unwrap();
        let remote=wire::join(&home,&format!("bridge-{case}.bin"))?;
        let temp=wire::join(&home,&format!(".bridge-{case}.part"))?;
        let events=Channel::<Progress>::new(|_|Ok(()));
        copy_upload(&mut c,&source,&remote,&temp,&op,&events)?;
        let target=local.join("download.bin"); let partial=local.join(".download.part");
        copy_download(&mut c,&remote,&target,&partial,&op,&events)?;
        assert_eq!(fs::read(&target).unwrap(),bytes);
        assert!(copy_download(&mut c,&remote,&target,&partial,&op,&events).is_err());
        let cancelled=Arc::new(Operation::default()); let mut slave=connect(&d,&cancelled)?;
        let cancel_op=cancelled.clone(); let cancel_events=Channel::<Progress>::new(move |_|{cancel_op.cancel();Ok(())});
        assert!(copy_download(&mut slave,&remote,&local.join("cancelled.bin"),&partial,&cancelled,&cancel_events).is_err());
        assert!(!partial.exists()); assert!(!local.join("cancelled.bin").exists());
        // Cancelling a transfer kills only its subsystem child; login survives.
        assert_eq!(c.realpath(".")?,home);
        Ok(())
    })();
    op.stop(); result.unwrap();
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn strict_transport_no_password_or_shell() {
        let d = Destination { host:"localhost".into(),port:22,username:"user".into(),auth_session:None,control:None };
        let a = transport_args(&d).unwrap();
        for s in ["-T","-s","-oBatchMode=yes","-oStrictHostKeyChecking=yes","-oForwardAgent=no","-oPasswordAuthentication=no","-oKbdInteractiveAuthentication=no"] { assert!(a.contains(&s.into())); }
        assert_eq!(a.last().unwrap(),"sftp"); assert!(!a.contains(&"-tt".into()));
        assert!(!a.iter().any(|s|s.contains("StrictHostKeyChecking=ask") || s.contains("BatchMode=no")));
        assert!(transport_args(&Destination {host:"-oProxyCommand=evil".into(),..d}).is_err());
    }
    #[test] fn cancellation_is_idempotent() { let op = Operation::default(); assert!(op.check().is_ok()); op.cancel(); op.cancel(); assert!(op.check().is_err()); }
    #[test] fn cancel_before_registration_and_limits() {
        let mut registry = Registry::default(); registry.cancel("late".into()).unwrap();
        assert!(registry.insert("late",Arc::new(Operation::default())).is_err());
        let op = Arc::new(Operation::default()); registry.insert("active",op.clone()).unwrap();
        registry.cancel("active".into()).unwrap(); assert!(op.check().is_err());
        for n in 0..64 { registry.cancel(n.to_string()).unwrap(); }
        assert!(registry.cancel("overflow".into()).is_err());
        assert!(operation_id("../malicious").is_err());
    }
    #[test] fn local_no_replace_and_partial_cleanup() {
        let root = std::env::temp_dir().join(format!("nodedesk-test-{}",std::process::id())); fs::create_dir_all(&root).unwrap();
        let path = root.join("target"); let _ = fs::remove_file(&path);
        let f = private_new(&path).unwrap(); drop(f); assert!(private_new(&path).is_err());
        drop(PartialLocal(path.clone())); assert!(!path.exists()); fs::remove_dir(root).unwrap();
        assert!(local_dir("../").is_err());
    }
    #[cfg(unix)]
    #[test]
    fn real_structured_sftp_binary_trust_and_cancel() {
        let Ok(dir) = std::env::var("NODEDESK_SSH_FIXTURE") else { return; };
        let d = Destination {host:"127.0.0.1".into(),port:22229,username:std::env::var("USER").unwrap(),auth_session:None,control:None};
        let open = |known: &str, op: &Operation| {
            let mut cmd = Command::new("ssh");
            cmd.args([format!("-oUserKnownHostsFile={dir}/{known}"),"-oGlobalKnownHostsFile=/dev/null".into(),"-oIdentitiesOnly=yes".into(),"-i".into(),format!("{dir}/client")]);
            cmd.args(transport_args(&d).unwrap()); spawn_transport(cmd,op)
        };
        for known in ["unknown-gui","changed","revoked"] {
            let op = Operation::default(); assert!(open(known,&op).is_err(),"trust must reject {known}"); op.stop();
        }
        // real_host_key_checks separately verifies first trust via the existing console.
        let op = Arc::new(Operation::default());
        let weak = Arc::downgrade(&op);
        let timer = std::thread::spawn(move || { std::thread::sleep(Duration::from_secs(20)); if let Some(op)=weak.upgrade() { op.cancel(); } });
        let mut c = open("trusted-gui",&op).unwrap();
        let local = PathBuf::from(&dir).join("gui-local"); let remote = PathBuf::from(&dir).join("gui-remote");
        fs::create_dir(&local).unwrap(); fs::create_dir(&remote).unwrap();
        let remote_path = remote.to_str().unwrap();
        let filename = "binary пробел ;$(x).bin";
        let bytes: Vec<u8> = (0..131_077).map(|n| (n % 256) as u8).collect();
        let source = local.join(filename); fs::write(&source,&bytes).unwrap();
        let dest = wire::join(remote_path,filename).unwrap(); let temp = wire::join(remote_path,".upload.part").unwrap();
        let events = Channel::<Progress>::new(|_| Ok(()));
        copy_upload(&mut c,&source,&dest,&temp,&op,&events).unwrap();
        assert_eq!(fs::read(&dest).unwrap(),bytes);
        let listing = remote_list(&mut c,remote_path,&op).unwrap();
        assert!(listing.entries.iter().any(|e|e.name==filename && e.kind=="file"));
        let downloaded = local.join("download.bin"); let partial = local.join(".download.part");
        copy_download(&mut c,&dest,&downloaded,&partial,&op,&events).unwrap();
        assert_eq!(fs::read(&downloaded).unwrap(),bytes); assert!(!partial.exists());
        assert!(copy_download(&mut c,&dest,&downloaded,&partial,&op,&events).is_err());
        assert!(copy_upload(&mut c,&source,&dest,&temp,&op,&events).is_err());
        assert_eq!(fs::read(&dest).unwrap(),bytes); // collision must never clobber
        assert!(c.lstat(&format!("{remote_path}/missing")).is_err());
        std::os::unix::fs::symlink(&dest,remote.join("link")).unwrap();
        assert!(copy_download(&mut c,&format!("{remote_path}/link"),&local.join("link-copy"),&partial,&op,&events).is_err());
        // Cancel during a real transfer, not just before the command: the first
        // progress callback kills the transport and the local partial is removed.
        let cancelled = Arc::new(Operation::default());
        let mut cc = open("trusted-gui",&cancelled).unwrap();
        let cancel_op = cancelled.clone();
        let cancel_events = Channel::<Progress>::new(move |_| { cancel_op.cancel(); Ok(()) });
        let cancelled_target = local.join("cancelled.bin");
        assert!(copy_download(&mut cc,&dest,&cancelled_target,&partial,&cancelled,&cancel_events).is_err());
        assert!(!partial.exists()); assert!(!cancelled_target.exists());
        assert!(cancelled.child.lock().unwrap().is_none());
        // An exclusive remote partial remains identifiable after upload cancel;
        // the requested final name is never published.
        let cancelled_upload = Arc::new(Operation::default());
        let mut cu = open("trusted-gui",&cancelled_upload).unwrap();
        let cancel_op = cancelled_upload.clone();
        let cancel_events = Channel::<Progress>::new(move |_| { cancel_op.cancel(); Ok(()) });
        let cancelled_remote = wire::join(remote_path,"cancelled.bin").unwrap();
        let cancelled_partial = wire::join(remote_path,".cancelled.part").unwrap();
        assert!(copy_upload(&mut cu,&source,&cancelled_remote,&cancelled_partial,&cancelled_upload,&cancel_events).is_err());
        assert!(!Path::new(&cancelled_remote).exists()); assert!(Path::new(&cancelled_partial).exists());
        assert!(cancelled_upload.child.lock().unwrap().is_none());
        op.cancel(); assert!(op.check().is_err()); assert!(c.realpath(".").is_err()); drop(c); drop(op);
        // No child survives cancellation; the timer is a fixture-only upper bound.
        timer.join().unwrap();
    }
}
