//! User-initiated file operations. OpenSSH supplies authentication and host trust;
//! SFTP packets supply filesystem semantics. No shell, CLI listing or secret input.
use crate::{sftp_wire::{self as wire, Client, Result, CHUNK}, ssh::{self, AuthMode}};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs::{self, OpenOptions}, io::{Read, Seek, SeekFrom, Write}, path::{Path, PathBuf}, process::{Child, Command, Stdio}, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}, time::{Duration, Instant}};
use tauri::{ipc::Channel, Manager, State};

#[derive(Clone, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Destination { host: String, port: u16, username: String, #[serde(default)] auth_session: Option<String>, #[serde(skip)] control: Option<String>, #[serde(skip)] native: Option<Arc<crate::native_auth::Login>> }
fn resolve_auth(d: &mut Destination, app: &tauri::AppHandle) -> Result<()> {
    if let Some(id)=&d.auth_session {
        #[cfg(windows)] {d.native=Some(app.state::<crate::native_auth::Logins>().get(id,&d.host,d.port,&d.username)?);}
        #[cfg(not(windows))] {d.control=Some(ssh::files_socket(&app.state::<ssh::Sessions>(),id,&d.host,d.port,&d.username)?);}
    }
    Ok(())
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Entry { name: String, kind: String, size: Option<u64>, modified: Option<u64>, permissions: Option<u32> }
#[derive(Serialize)]
pub struct Listing { path: String, entries: Vec<Entry> }
/** Platform capabilities, rather than user-agent guessing. The Unix OpenSSH
 * ControlMaster/PTTY bridge is unsupported by native Windows OpenSSH.
 * The direct key/agent transport is available on both target platforms.
 */
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct FileCapabilities { interactive_login: bool, key_agent: bool, native_login: bool }
#[tauri::command]
pub fn files_capabilities() -> FileCapabilities {
    FileCapabilities { interactive_login: cfg!(any(unix,windows)), key_agent: true, native_login: cfg!(windows) }
}

#[derive(Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub struct Progress { bytes: u64, total: Option<u64> }
#[derive(Default)]
struct Operation { cancelled: AtomicBool, child: Mutex<Option<Child>>, native: Mutex<Option<Arc<crate::native_auth::Login>>> }
impl Operation {
    fn check(&self) -> Result<()> { if self.cancelled.load(Ordering::SeqCst) { Err("Operation cancelled or timed out".into()) } else { Ok(()) } }
    fn cancel(&self) { self.cancelled.store(true,Ordering::SeqCst); if let Ok(login)=self.native.lock() {if let Some(login)=login.as_ref() {login.close();}} self.stop(); }
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
type Sftp = crate::native_auth::StreamClient;
fn connect(d: &Destination, op: &Operation) -> Result<Sftp> {
    op.check()?;
    if let Some(login)=&d.native {
        *op.native.lock().map_err(|_|"Operation lock failed")?=Some(login.clone());
        op.check()?;
        return crate::native_auth::subsystem(login);
    }
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
    *slot = Some(child); drop(slot); Client::new(Box::new(reader) as Box<dyn Read+Send>,Box::new(writer) as Box<dyn Write+Send>)
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

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
enum MutationAction { Mkdir, Rename, Delete }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mutation {
    destination: Option<Destination>,
    directory: String,
    name: String,
    action: MutationAction,
    #[serde(default)] new_name: Option<String>,
    #[serde(default)] expected_kind: Option<String>,
}
fn expected_kind(kind: &str) -> Result<()> {
    if kind == "file" || kind == "directory" { Ok(()) }
    else { Err("Only regular files and directories are supported; symlinks are read-only".into()) }
}
fn remote_mutate(c: &mut Sftp, directory: &str, name: &str, action: MutationAction, new_name: Option<&str>, kind: Option<&str>, op: &Operation) -> Result<()> {
    wire::path(directory)?; wire::name(name)?;
    let parent = c.realpath(directory)?; op.check()?;
    let source = wire::join(&parent,name)?;
    match action {
        MutationAction::Mkdir => {
            if !c.missing(&source)? { return Err("Destination already exists".into()); }
            op.check()?; c.mkdir(&source)
        },
        MutationAction::Rename => {
            let kind = kind.ok_or("Missing expected entry type")?; expected_kind(kind)?;
            if c.lstat(&source)?.kind() != kind { return Err("Source changed; refresh listing".into()); }
            let new_name = new_name.ok_or("Missing new filename")?; wire::name(new_name)?;
            if new_name == name { return Err("Choose a different name".into()); }
            let new_path = wire::join(&parent,new_name)?;
            if !c.missing(&new_path)? { return Err("Destination already exists; rename cannot overwrite".into()); }
            op.check()?; c.rename(&source,&new_path)
        },
        MutationAction::Delete => {
            let kind = kind.ok_or("Missing expected entry type")?; expected_kind(kind)?;
            if c.lstat(&source)?.kind() != kind { return Err("Source changed; refresh listing".into()); }
            op.check()?; c.remove(&source,kind == "directory")
        }
    }
}

/**
 * Rename a *directory* without replacing another entry. Using std::fs::rename
 * here is unsafe on Unix: it may silently replace an existing empty directory.
 * Linux renameat2(RENAME_NOREPLACE) and Win32 MoveFileExW without
 * MOVEFILE_REPLACE_EXISTING both provide fail-on-collision behavior.
 * Other platforms fail closed until an audited native implementation exists.
 */
#[cfg(target_os="linux")]
fn rename_directory_no_replace(from: &Path, to: &Path) -> Result<()> {
    use std::{ffi::{CString, c_char}, os::unix::ffi::OsStrExt};
    unsafe extern "C" {
        fn renameat2(olddirfd: i32, oldpath: *const c_char, newdirfd: i32, newpath: *const c_char, flags: u32) -> i32;
    }
    const AT_FDCWD: i32 = -100;
    const RENAME_NOREPLACE: u32 = 1;
    let old = CString::new(from.as_os_str().as_bytes()).map_err(|_| "Invalid source path")?;
    let new = CString::new(to.as_os_str().as_bytes()).map_err(|_| "Invalid destination path")?;
    if unsafe { renameat2(AT_FDCWD,old.as_ptr(),AT_FDCWD,new.as_ptr(),RENAME_NOREPLACE) } == 0 {
        Ok(())
    } else {
        Err(format!("Cannot rename directory without overwrite: {}",std::io::Error::last_os_error()))
    }
}
#[cfg(windows)]
fn rename_directory_no_replace(from: &Path, to: &Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name="Kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(existing: *const u16, destination: *const u16, flags: u32) -> i32;
    }
    let old: Vec<u16> = from.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let new: Vec<u16> = to.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    // 0 = neither REPLACE_EXISTING nor COPY_ALLOWED: same-volume only.
    if unsafe { MoveFileExW(old.as_ptr(),new.as_ptr(),0) } != 0 { Ok(()) }
    else { Err(format!("Cannot rename directory without overwrite: {}",std::io::Error::last_os_error())) }
}
#[cfg(not(any(target_os="linux",windows)))]
fn rename_directory_no_replace(_from: &Path, _to: &Path) -> Result<()> {
    Err("Safe directory rename is unsupported on this platform".into())
}

fn local_mutate(directory: &str, name: &str, action: MutationAction, new_name: Option<&str>, kind: Option<&str>, op: &Operation) -> Result<()> {
    wire::name(name)?;
    let parent = local_dir(directory)?; op.check()?;
    let source = parent.join(name);
    match action {
        MutationAction::Mkdir => {
            fs::create_dir(&source).map_err(|_| "Cannot create local directory (it may exist or be inaccessible)".into())
        },
        MutationAction::Rename | MutationAction::Delete => {
            let kind = kind.ok_or("Missing expected entry type")?; expected_kind(kind)?;
            let m = fs::symlink_metadata(&source).map_err(|_| "Source missing; refresh listing")?;
            if m.is_symlink() || (kind == "file" && !m.is_file()) || (kind == "directory" && !m.is_dir()) {
                return Err("Source changed or is a symlink; refresh listing".into());
            }
            op.check()?;
            match action {
                MutationAction::Delete => {
                    if kind == "directory" { fs::remove_dir(&source).map_err(|_| "Cannot delete directory (must be empty)".into()) }
                    else { fs::remove_file(&source).map_err(|_| "Cannot delete local file".into()) }
                },
                MutationAction::Rename => {
                    let new_name = new_name.ok_or("Missing new filename")?; wire::name(new_name)?;
                    if new_name == name { return Err("Choose a different name".into()); }
                    let new_path = parent.join(new_name);
                    if kind == "directory" {
                        // Atomic on supported filesystems, no hardlink fallback.
                        return rename_directory_no_replace(&source,&new_path);
                    }
                    // A hard link is created exclusively; it cannot overwrite an existing name.
                    // Then unlink the old name. If unlink fails both references remain.
                    // Filesystems lacking hardlinks fail without modifying the original.
                    fs::hard_link(&source,&new_path).map_err(|_| "Cannot rename locally: target exists or hardlinks unsupported".to_string())?;
                    fs::remove_file(&source).map_err(|_| "New hardlink created but old name could not be removed".to_string())
                },
                MutationAction::Mkdir => unreachable!(),
            }
        }
    }
}
#[tauri::command]
pub async fn files_mutate(id: String, mut request: Mutation, app: tauri::AppHandle) -> Result<()> {
    wire::name(&request.name)?;
    if let Some(name) = &request.new_name { wire::name(name)?; }
    if let Some(d) = &mut request.destination { resolve_auth(d,&app)?; }
    let guard = register(&id,&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = &guard;
        let kind = request.expected_kind.as_deref();
        match request.destination {
            Some(d) => {
                let mut client = connect(&d,&guard.op)?;
                remote_mutate(&mut client,&request.directory,&request.name,request.action,request.new_name.as_deref(),kind,&guard.op)
            },
            None => local_mutate(&request.directory,&request.name,request.action,request.new_name.as_deref(),kind,&guard.op),
        }
    }).await.map_err(|_| "File mutation task failed".to_string())?
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
/// Read-only small UTF-8 preview. No local temporary file, shell or write request.
const PREVIEW_LIMIT: usize = 128 * 1024;

#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
pub struct PreviewRequest { destination: Destination, directory: String, name: String }

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Preview { name: String, content: String, bytes: usize }

fn decode_preview(bytes: Vec<u8>) -> Result<String> {
    if bytes.len() > PREVIEW_LIMIT {return Err("Preview exceeds 128 KiB limit".into());}
    if bytes.iter().any(|b| *b == 0) {return Err("Binary files cannot be previewed".into());}
    let content=String::from_utf8(bytes).map_err(|_|"Only UTF-8 text can be previewed".to_string())?;
    if content.chars().any(|c| c.is_control() && !matches!(c,'\n'|'\r'|'\t')) {
        return Err("Unsupported control characters in text preview".into());
    }
    Ok(content)
}
fn preview_remote(c: &mut Sftp, directory: &str, name: &str, op: &Operation) -> Result<Preview> {
    wire::path(directory)?; wire::name(name)?; op.check()?;
    let parent=c.realpath(directory)?; op.check()?;
    let path=wire::join(&parent,name)?;
    let before=c.lstat(&path)?;
    if before.kind()!="file" {return Err("Preview requires a regular file".into());}
    let size=before.size.ok_or("File size unavailable; preview refused")?;
    if size > PREVIEW_LIMIT as u64 {return Err("Preview exceeds 128 KiB limit".into());}
    let handle=c.open(&path,1)?;
    let mut bytes=Vec::with_capacity(size as usize);
    loop {
        op.check()?;
        match c.read(&handle,bytes.len() as u64)? {
            None=>break,
            Some(chunk)=>{
                if chunk.len() > PREVIEW_LIMIT.saturating_sub(bytes.len()){
                    return Err("Preview exceeds 128 KiB limit".into());
                }
                bytes.extend_from_slice(&chunk);
            }
        }
    }
    c.close(&handle)?;op.check()?;
    if bytes.len() as u64 != size {return Err("File changed during preview".into());}
    let after=c.lstat(&path)?;
    if after.kind()!="file"||after.size!=before.size||after.modified!=before.modified{
        return Err("File changed during preview".into());
    }
    let bytes_len=bytes.len();
    Ok(Preview{name:name.to_owned(),content:decode_preview(bytes)?,bytes:bytes_len})
}
#[tauri::command]
pub async fn files_preview(id: String, mut request: PreviewRequest, app: tauri::AppHandle) -> Result<Preview> {
    wire::name(&request.name)?; wire::path(&request.directory)?;
    resolve_auth(&mut request.destination,&app)?;
    let guard=register(&id,&app)?;
    tauri::async_runtime::spawn_blocking(move||{
        let _guard=&guard;
        let mut client=connect(&request.destination,&guard.op)?;
        preview_remote(&mut client,&request.directory,&request.name,&guard.op)
    }).await.map_err(|_|"File preview task failed".to_string())?
}


/** Non-destructive SFTP text editing: the original file is never opened for
 * writing. Save creates a *new* file with SSH_FXF_CREAT|SSH_FXF_EXCL; a remote
 * editor cannot honestly promise atomic compare-and-swap with SFTP v3.
 */
#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
pub struct SaveTextCopyRequest {
    destination: Destination,
    directory: String,
    original_name: String,
    original_content: String,
    new_name: String,
    content: String,
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct SavedTextCopy {name:String,bytes:usize,source_unchanged:bool}

fn save_text_copy(c:&mut Sftp,request:&SaveTextCopyRequest,op:&Operation)->Result<SavedTextCopy>{
    wire::path(&request.directory)?;
    wire::name(&request.original_name)?;
    wire::name(&request.new_name)?;
    if request.new_name==request.original_name {
        return Err("Choose a different filename; original cannot be overwritten".into());
    }
    // Both texts are sent in memory; neither is logged, stored or saved locally.
    decode_preview(request.original_content.as_bytes().to_vec())?;
    decode_preview(request.content.as_bytes().to_vec())?;
    op.check()?;
    let original=preview_remote(c,&request.directory,&request.original_name,op)?;
    if original.content!=request.original_content {
        return Err("Original file changed since opening; copy was not created".into());
    }
    let parent=c.realpath(&request.directory)?;op.check()?;
    let target=wire::join(&parent,&request.new_name)?;
    // The exclusive-create flag makes collisions fail *at the server*.
    // Never use RENAME or POSIX rename here: both could overwrite a target.
    let handle=c.open(&target,2|8|32)?;
    let bytes=request.content.as_bytes();
    let mut written=0usize;
    while written<bytes.len(){
        if let Err(e)=op.check(){
            let _=c.close(&handle);
            return Err(format!("{e}; new copy may be incomplete"));
        }
        let end=usize::min(written+CHUNK,bytes.len());
        if let Err(e)=c.write(&handle,written as u64,&bytes[written..end]){
            let _=c.close(&handle);
            return Err(format!("{e}; new copy may be incomplete"));
        }
        written=end;
    }
    if let Err(e)=c.close(&handle){
        return Err(format!("{e}; inspect newly created copy before retrying"));
    }
    op.check().map_err(|e|format!("{e}; new copy may exist"))?;
    let saved=preview_remote(c,&request.directory,&request.new_name,op)
        .map_err(|e|format!("New copy created but verification failed: {e}"))?;
    if saved.content!=request.content {
        return Err("New copy content verification failed; inspect manually".into());
    }
    // A concurrent, uncooperative writer may alter the source after the first
    // comparison. Original is untouched; report its latest observable state.
    let source_unchanged=preview_remote(c,&request.directory,&request.original_name,op)
        .map(|now|now.content==request.original_content).unwrap_or(false);
    Ok(SavedTextCopy{name:request.new_name.clone(),bytes:bytes.len(),source_unchanged})
}
#[tauri::command]
pub async fn files_save_text_copy(id:String,mut request:SaveTextCopyRequest,app:tauri::AppHandle)->Result<SavedTextCopy>{
    wire::path(&request.directory)?;
    wire::name(&request.original_name)?;
    wire::name(&request.new_name)?;
    resolve_auth(&mut request.destination,&app)?;
    let guard=register(&id,&app)?;
    tauri::async_runtime::spawn_blocking(move||{
        let _guard=&guard;
        let mut client=connect(&request.destination,&guard.op)?;
        save_text_copy(&mut client,&request,&guard.op)
    }).await.map_err(|_|"Text copy task failed".to_string())?
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
struct PartialLocal { path: PathBuf, keep_on_error: bool }
impl Drop for PartialLocal {
    fn drop(&mut self) {
        if !self.keep_on_error { let _ = fs::remove_file(&self.path); }
    }
}
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
/// Explicit resume: verify every byte of a remote partial against the opened
/// local source before writing, then recheck the entire file before publication.
/// Only previous NodeDesk operation IDs are accepted by the caller UI.
fn copy_upload_resume(c:&mut Sftp,source:&Path,remote:&str,temp:&str,
    op:&Operation,events:&Channel<Progress>)->Result<()> {
    let before=fs::symlink_metadata(source).map_err(|_|"Local source unavailable")?;
    if !before.is_file()||before.is_symlink(){return Err("Regular local file required".into());}
    let mut opts=OpenOptions::new();opts.read(true);
    #[cfg(windows)] {use std::os::windows::fs::OpenOptionsExt;opts.custom_flags(0x00200000);}
    let mut f=opts.open(source).map_err(|_|"Cannot open local source")?;
    let opened=f.metadata().map_err(|_|"Cannot stat local source")?;
    if !opened.is_file()||opened.is_symlink(){return Err("Regular local file required".into());}
    #[cfg(unix)] {
        use std::os::unix::fs::MetadataExt;
        if before.dev()!=opened.dev()||before.ino()!=opened.ino(){
            return Err("Local source changed".into());
        }
    }
    let size=opened.len();op.check()?;
    if !c.missing(remote)? {return Err("Target already exists; no overwrite".into());}
    let attrs=c.lstat(temp)?;
    if attrs.kind()!="file"{return Err("Regular partial required".into());}
    let prefix_len=attrs.size.ok_or("Partial size unavailable")?;
    if prefix_len==0||prefix_len>=size {
        return Err("Partial must contain between 1 and size-1 bytes".into());
    }
    // Compare remote prefix against local bytes before requesting write access.
    let read_handle=c.open(temp,1)?;
    let mut offset=0_u64;
    while offset<prefix_len {
        op.check()?;
        let chunk=c.read(&read_handle,offset)?.ok_or("Partial truncated")?;
        if chunk.len() as u64>prefix_len-offset{return Err("Partial exceeds prefix".into());}
        let mut local=vec![0;chunk.len()];
        f.read_exact(&mut local).map_err(|_|"Local source shortened")?;
        if chunk!=local{return Err("Partial differs from source; no write".into());}
        offset+=chunk.len() as u64;
    }
    c.close(&read_handle)?;op.check()?;
    let verified=c.lstat(temp)?;
    if verified.kind()!="file"||verified.size!=attrs.size||
        verified.modified!=attrs.modified{
        return Err("Partial changed during verification".into());
    }
    if !c.missing(remote)? {return Err("Target already exists; no overwrite".into());}
    // SSH_FXF_WRITE without CREATE, TRUNC or APPEND. The verified prefix stays.
    let h=c.open(temp,2)?;
    let mut bytes=vec![0;CHUNK];
    let mut written=prefix_len;
    while written<size {
        op.check()?;
        let n=f.read(&mut bytes).map_err(|_|"Local read failed")?;
        if n==0||n as u64>size-written{return Err("Local source changed".into());}
        c.write(&h,written,&bytes[..n])?;
        written+=n as u64;
        events.send(Progress{bytes:written,total:Some(size)})
            .map_err(|_|"Transfer view closed")?;
    }
    c.close(&h)?;op.check()?;
    if f.metadata().map_err(|_|"Cannot inspect local source")?.len()!=size {
        return Err("Local source changed during resume".into());
    }
    let full=c.lstat(temp)?;
    if full.kind()!="file"||full.size!=Some(size){
        return Err("Remote file size changed; not published".into());
    }
    // A second full-file comparison detects modifications to either prefix
    // or suffix. The original user file is only ever opened read-only.
    f.seek(SeekFrom::Start(0)).map_err(|_|"Cannot rewind local file")?;
    let reader=c.open(temp,1)?;
    let mut at=0_u64;
    while at<size {
        op.check()?;
        let chunk=c.read(&reader,at)?.ok_or("Remote file truncated")?;
        if chunk.len() as u64>size-at {return Err("Remote file grew".into());}
        let mut expected=vec![0;chunk.len()];
        f.read_exact(&mut expected).map_err(|_|"Local file changed")?;
        if chunk!=expected{return Err("Remote data mismatch; no publication".into());}
        at+=chunk.len() as u64;
    }
    c.close(&reader)?;op.check()?;
    if !c.missing(remote)? {return Err("Target already exists; no overwrite".into());}
    // SFTP v3 rename (not overwrite-capable posix-rename); hostile concurrent
    // writers cannot be excluded atomically by this protocol.
    c.rename(temp,remote)
}

fn copy_download(c: &mut Sftp, remote: &str, target: &Path, temp: &Path, op: &Operation, events: &Channel<Progress>, keep_partial: bool) -> Result<()> {
    let a = c.lstat(remote)?; if a.kind() != "file" { return Err("Only regular remote files can be downloaded".into()); }
    if target.symlink_metadata().is_ok() { return Err("Local destination already exists".into()); }
    let mut f = private_new(temp)?; let _partial = PartialLocal {path:temp.into(),keep_on_error:keep_partial}; let h = c.open(remote,1)?;
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
    if keep_partial {
        fs::remove_file(temp).map_err(|_|"Downloaded file published but partial cleanup failed".to_string())?;
    }
    Ok(())
}
/// Resumes an explicitly retained local partial from the current queue only.
/// No local file is opened for writing before checking its complete prefix
/// against the trusted SFTP source. Existing final targets are never replaced.
fn copy_download_resume(c:&mut Sftp,remote:&str,target:&Path,temp:&Path,
    op:&Operation,events:&Channel<Progress>)->Result<()> {
    op.check()?;
    if target.symlink_metadata().is_ok() {
        return Err("Local destination exists; overwrite disabled".into());
    }
    let source_before=c.lstat(remote)?;
    if source_before.kind()!="file" {return Err("Regular remote source required".into());}
    let total=source_before.size.ok_or("Remote size unavailable; cannot resume")?;
    let local_before=fs::symlink_metadata(temp).map_err(|_|"Local partial missing")?;
    if !local_before.is_file() || local_before.is_symlink() {
        return Err("Local partial must be a regular file".into());
    }
    #[cfg(windows)] {
        use std::os::windows::fs::MetadataExt;
        if local_before.file_attributes() & 0x400 != 0 {
            return Err("Windows reparse-point partial refused".into());
        }
    }
    #[cfg(unix)] {
        use std::os::unix::fs::MetadataExt;
        if local_before.nlink()!=1 {return Err("Hard-linked partial refused".into());}
    }
    // No FOLLOW: do not allow a symlink swapped in between lstat and open.
    let mut opts=OpenOptions::new();opts.read(true).write(true);
    #[cfg(target_os="linux")] {
        use std::os::unix::fs::OpenOptionsExt;
        opts.custom_flags(0o400000); // Linux O_NOFOLLOW
    }
    #[cfg(windows)] {
        use std::os::windows::fs::OpenOptionsExt;
        opts.custom_flags(0x00200000); // FILE_FLAG_OPEN_REPARSE_POINT
    }
    #[cfg(all(unix,not(target_os="linux")))] {
        return Err("Safe partial reopen is not supported on this platform".into());
    }
    let mut f=opts.open(temp).map_err(|_|"Cannot safely reopen local partial")?;
    let local_open=f.metadata().map_err(|_|"Cannot inspect local partial")?;
    if !local_open.is_file() || local_open.len()!=local_before.len() {
        return Err("Local partial changed before verification".into());
    }
    #[cfg(unix)] {
        use std::os::unix::fs::MetadataExt;
        if local_before.dev()!=local_open.dev() || local_before.ino()!=local_open.ino() ||
            local_open.nlink()!=1 {
            return Err("Local partial changed before verification".into());
        }
    }
    let prefix_len=local_open.len();
    if prefix_len==0 || prefix_len>total {
        return Err("Local partial size invalid for resume".into());
    }
    let h=c.open(remote,1)?;
    let mut at=0_u64;
    // A remote READ may return bytes beyond the end of the partial prefix.
    // Compare only bytes that are already present locally, then use that
    // same open SFTP source handle to download the remaining suffix.
    while at<prefix_len {
        op.check()?;
        let chunk=c.read(&h,at)?.ok_or("Remote source shortened")?;
        let compare=usize::min(chunk.len(),(prefix_len-at) as usize);
        let mut expected=vec![0;compare];
        f.read_exact(&mut expected).map_err(|_|"Local partial truncated")?;
        if chunk[..compare]!=expected {
            return Err("Local partial does not match remote source; no write".into());
        }
        at+=compare as u64;
    }
    op.check()?;
    let local_verified=fs::symlink_metadata(temp).map_err(|_|"Local partial vanished")?;
    if !local_verified.is_file() || local_verified.len()!=prefix_len {
        return Err("Local partial changed while verifying".into());
    }
    #[cfg(unix)] {
        use std::os::unix::fs::MetadataExt;
        if local_verified.dev()!=local_open.dev() ||
            local_verified.ino()!=local_open.ino() || local_verified.nlink()!=1 {
            return Err("Local partial changed while verifying".into());
        }
    }
    let source_verified=c.lstat(remote)?;
    if source_verified.kind()!="file" || source_verified.size!=source_before.size ||
        source_verified.modified!=source_before.modified {
        return Err("Remote source changed during verification".into());
    }
    if target.symlink_metadata().is_ok() {
        return Err("Local destination exists; overwrite disabled".into());
    }
    f.seek(SeekFrom::Start(prefix_len)).map_err(|_|"Cannot seek local partial")?;
    at=prefix_len;
    while at<total {
        op.check()?;
        let chunk=c.read(&h,at)?.ok_or("Remote source shortened during resume")?;
        if chunk.len() as u64>total-at {
            return Err("Remote source grew during resume".into());
        }
        f.write_all(&chunk).map_err(|_|"Cannot append local partial")?;
        at+=chunk.len() as u64;
        events.send(Progress{bytes:at,total:Some(total)}).map_err(|_|"Transfer view closed")?;
    }
    c.close(&h)?;op.check()?;
    f.sync_all().map_err(|_|"Cannot sync local partial")?;
    if f.metadata().map_err(|_|"Cannot inspect local partial")?.len()!=total {
        return Err("Local partial size changed".into());
    }
    let source_after=c.lstat(remote)?;
    if source_after.kind()!="file"||source_after.size!=source_before.size||
        source_after.modified!=source_before.modified {
        return Err("Remote source changed; download cannot be published".into());
    }
    // End-to-end verification through a fresh SFTP read, including the
    // previously retained prefix and newly downloaded suffix.
    f.seek(SeekFrom::Start(0)).map_err(|_|"Cannot rewind local partial")?;
    let check=c.open(remote,1)?;
    let mut check_at=0_u64;
    while check_at<total {
        op.check()?;
        let chunk=c.read(&check,check_at)?.ok_or("Remote source truncated during verification")?;
        if chunk.len() as u64>total-check_at {
            return Err("Remote source grew during verification".into());
        }
        let mut bytes=vec![0;chunk.len()];
        f.read_exact(&mut bytes).map_err(|_|"Local partial changed while verifying")?;
        if bytes!=chunk {return Err("Download integrity check failed; not published".into());}
        check_at+=chunk.len() as u64;
    }
    c.close(&check)?;op.check()?;
    let final_source=c.lstat(remote)?;
    if final_source.kind()!="file" || final_source.size!=source_before.size ||
        final_source.modified!=source_before.modified {
        return Err("Remote source changed before publication".into());
    }
    let final_partial=fs::symlink_metadata(temp).map_err(|_|"Local partial vanished")?;
    if !final_partial.is_file() || final_partial.is_symlink() ||
        final_partial.len()!=total {
        return Err("Local partial changed before publication".into());
    }
    #[cfg(unix)] {
        use std::os::unix::fs::MetadataExt;
        if final_partial.dev()!=local_open.dev() || final_partial.ino()!=local_open.ino() ||
            final_partial.nlink()!=1 {
            return Err("Local partial replaced before publication".into());
        }
    }
    #[cfg(windows)] {
        use std::os::windows::fs::MetadataExt;
        if final_partial.file_attributes() & 0x400 != 0 {
            return Err("Local partial changed to a reparse point".into());
        }
    }
    drop(f);
    // Atomic no-replace local publication, same as ordinary download.
    fs::hard_link(temp,target).map_err(|_|"Cannot publish download without overwrite".to_string())?;
    fs::remove_file(temp).map_err(|_|"Download published but partial cleanup failed".to_string())?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Transfer { destination: Destination, local_directory: String, remote_directory: String, name: String, upload: bool, #[serde(default)] resume_id: Option<String>, #[serde(default)] retain_partial: bool }
#[tauri::command]
pub async fn files_transfer(id: String, mut request: Transfer, events: Channel<Progress>, app: tauri::AppHandle) -> Result<()> {
    resolve_auth(&mut request.destination,&app)?;
    wire::name(&request.name)?; wire::path(&request.remote_directory)?;
    if let Some(previous)=&request.resume_id {
        if previous==&id{return Err("Invalid resume request".into());}
        operation_id(previous)?;
    }
    let g = register(&id,&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = &g; let local = local_dir(&request.local_directory)?;
        let target = local.join(&request.name); let mut c = connect(&request.destination,&g.op)?;
        let parent = c.realpath(&request.remote_directory)?; let remote = wire::join(&parent,&request.name)?;
        let partial = format!(".nodedesk-{id}.part");
        if request.upload {
            if let Some(previous)=request.resume_id.as_deref() {
                let old=wire::join(&parent,&format!(".nodedesk-{previous}.part"))?;
                copy_upload_resume(&mut c,&target,&remote,&old,&g.op,&events)
                    .map_err(|e|format!("{e}; partial remains at {old}"))
            } else {
                let temp=wire::join(&parent,&partial)?;
                copy_upload(&mut c,&target,&remote,&temp,&g.op,&events)
                    .map_err(|e|format!("{e}; incomplete upload may remain at {temp}"))
            }
        } else if let Some(previous)=request.resume_id.as_deref() {
            let old=local.join(format!(".nodedesk-{previous}.part"));
            copy_download_resume(&mut c,&remote,&target,&old,&g.op,&events)
                .map_err(|e|format!("{e}; partial remains at {}",old.display()))
        } else {
            copy_download(&mut c,&remote,&target,&local.join(partial),&g.op,&events,request.retain_partial)
        }
    }).await.map_err(|_| "Transfer task failed".to_string())?
}
#[cfg(all(test,unix))]
pub(crate) fn verify_auth_bridge(socket: &str, user: &str, case: i32, fixture: &str) {
    let d=Destination {host:"127.0.0.1".into(),port:22229,username:user.into(),auth_session:None,control:Some(socket.into()),native:None};
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
        copy_download(&mut c,&remote,&target,&partial,&op,&events,false)?;
        assert_eq!(fs::read(&target).unwrap(),bytes);
        assert!(copy_download(&mut c,&remote,&target,&partial,&op,&events,false).is_err());
        let cancelled=Arc::new(Operation::default()); let mut slave=connect(&d,&cancelled)?;
        let cancel_op=cancelled.clone(); let cancel_events=Channel::<Progress>::new(move |_|{cancel_op.cancel();Ok(())});
        assert!(copy_download(&mut slave,&remote,&local.join("cancelled.bin"),&partial,&cancelled,&cancel_events,false).is_err());
        assert!(!partial.exists()); assert!(!local.join("cancelled.bin").exists());
        // Cancelling a transfer kills only its subsystem child; login survives.
        assert_eq!(c.realpath(".")?,home);
        Ok(())
    })();
    op.stop(); result.unwrap();
}
#[cfg(test)]
pub(crate) fn verify_native_adapter(login: Arc<crate::native_auth::Login>, user:&str, fixture:&str, case:usize) {
    let d=Destination {host:"127.0.0.1".into(),port:22229,username:user.into(),auth_session:None,control:None,native:Some(login)};
    let op=Arc::new(Operation::default());
    let mut c=connect(&d,&op).unwrap();
    let home=c.realpath(".").unwrap(); remote_list(&mut c,&home,&op).unwrap();
    let local=PathBuf::from(fixture).join(format!("native-{case}"));fs::create_dir(&local).unwrap();
    let source=local.join("source.bin");let bytes:Vec<u8>=(0..65537).map(|n|(n%256)as u8).collect();fs::write(&source,&bytes).unwrap();
    let remote=wire::join(&home,&format!("native-{case}.bin")).unwrap();let temp=wire::join(&home,&format!(".native-{case}.part")).unwrap();
    let events=Channel::<Progress>::new(|_|Ok(()));
    copy_upload(&mut c,&source,&remote,&temp,&op,&events).unwrap();
    // Native Windows ssh2 adapter also verifies the real partial-resume path.
    let resume_remote=wire::join(&home,&format!("native-resumed-{case}.bin")).unwrap();
    let resume_part=wire::join(&home,&format!(".native-resume-{case}.part")).unwrap();
    let h=c.open(&resume_part,2|8|32).unwrap();
    c.write(&h,0,&bytes[..40000]).unwrap();c.close(&h).unwrap();
    copy_upload_resume(&mut c,&source,&resume_remote,&resume_part,&op,&events).unwrap();
    let resume_local=local.join("resumed.bin");
    let resume_tmp=local.join(".resumed.part");
    copy_download(&mut c,&resume_remote,&resume_local,&resume_tmp,&op,&events,false).unwrap();
    assert_eq!(fs::read(&resume_local).unwrap(),bytes);
    // Windows native ssh2: verified byte-offset download and corrupt prefix.
    let download_part=local.join(".native-down-resume.part");
    fs::write(&download_part,&bytes[..40000]).unwrap();
    let down_resumed=local.join("down-resumed.bin");
    copy_download_resume(&mut c,&remote,&down_resumed,&download_part,&op,&events).unwrap();
    assert_eq!(fs::read(&down_resumed).unwrap(),bytes);
    assert!(!download_part.exists());
    let bad_part=local.join(".native-bad.part");
    fs::write(&bad_part,vec![0xff_u8;30000]).unwrap();
    assert!(copy_download_resume(&mut c,&remote,&local.join("bad-down.bin"),&bad_part,&op,&events).is_err());
    assert_eq!(fs::read(&bad_part).unwrap(),vec![0xff_u8;30000]);
    let target=local.join("download.bin");let partial=local.join(".download.part");
    copy_download(&mut c,&remote,&target,&partial,&op,&events,false).unwrap();assert_eq!(fs::read(&target).unwrap(),bytes);
    assert!(copy_download(&mut c,&remote,&target,&partial,&op,&events,false).is_err());
    assert!(copy_upload(&mut c,&source,&remote,&temp,&op,&events).is_err());
    let folder=format!("native-folder-{case}");
    remote_mutate(&mut c,&home,&folder,MutationAction::Mkdir,None,None,&op).unwrap();
    assert!(remote_mutate(&mut c,&home,&folder,MutationAction::Mkdir,None,None,&op).is_err());
    remote_mutate(&mut c,&home,&folder,MutationAction::Delete,None,Some("directory"),&op).unwrap();
    let name=format!("native-{case}.bin");let renamed=format!("renamed-{case}.bin");
    remote_mutate(&mut c,&home,&name,MutationAction::Rename,Some(&renamed),Some("file"),&op).unwrap();
    remote_mutate(&mut c,&home,&renamed,MutationAction::Rename,Some(&name),Some("file"),&op).unwrap();
    let cancelled=Arc::new(Operation::default());let mut slave=connect(&d,&cancelled).unwrap();
    let cancel=cancelled.clone();let cancel_events=Channel::<Progress>::new(move |_|{cancel.cancel();Ok(())});
    assert!(copy_download(&mut slave,&remote,&local.join("cancelled.bin"),&partial,&cancelled,&cancel_events,false).is_err());
    assert!(!partial.exists());assert!(!local.join("cancelled.bin").exists());
    // Windows cancellation invalidates the login and refuses every new SFTP
    // channel. Do not assert an existing channel's *next* packet fails:
    // ssh2/OS transport may still return already-buffered data after shutdown.
    // Frontend never reuses an in-flight cancelled operation.
    assert!(connect(&d,&Operation::default()).is_err());
    drop(c);
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn strict_transport_no_password_or_shell() {
        let d = Destination { host:"localhost".into(),port:22,username:"user".into(),auth_session:None,control:None,native:None };
        let a = transport_args(&d).unwrap();
        for s in ["-T","-s","-oBatchMode=yes","-oStrictHostKeyChecking=yes","-oForwardAgent=no","-oPasswordAuthentication=no","-oKbdInteractiveAuthentication=no"] { assert!(a.contains(&s.into())); }
        assert_eq!(a.last().unwrap(),"sftp"); assert!(!a.contains(&"-tt".into()));
        assert!(!a.iter().any(|s|s.contains("StrictHostKeyChecking=ask") || s.contains("BatchMode=no")));
        assert!(transport_args(&Destination {host:"-oProxyCommand=evil".into(),..d}).is_err());
    }
    #[test] fn text_preview_rejects_binary_invalid_utf8_controls_and_oversize(){
        assert_eq!(decode_preview("Привет\nworld".as_bytes().to_vec()).unwrap(),"Привет\nworld");
        assert!(decode_preview(b"binary\0data".to_vec()).is_err());
        assert!(decode_preview(vec![0xff,0xfe]).is_err());
        assert!(decode_preview(vec![0x1b,0x5b,0x6d]).is_err());
        assert!(decode_preview(vec![b'a';PREVIEW_LIMIT+1]).is_err());
    }
    #[test] fn text_editor_rejects_nontext_and_oversize_content(){
        assert!(decode_preview(vec![0;1]).is_err());
        assert!(decode_preview(vec![b'x';PREVIEW_LIMIT+1]).is_err());
        assert_eq!(decode_preview("текст\n".as_bytes().to_vec()).unwrap(),"текст\n");
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
    #[test]
    fn capabilities_match_native_transport_support() {
        let capabilities=files_capabilities();
        assert_eq!(capabilities.interactive_login,cfg!(any(unix,windows)));
        assert!(capabilities.key_agent);
    }
    #[test] fn local_mutations_refuse_overwrite_symlinks_and_nonempty_dirs() {
        let root=std::env::temp_dir().join(format!("nd-mutate-{}",std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let dir=root.to_str().unwrap();
        let op=Operation::default();
        assert!(local_mutate(dir,"..",MutationAction::Mkdir,None,None,&op).is_err());
        local_mutate(dir,"newfolder",MutationAction::Mkdir,None,None,&op).unwrap();
        assert!(local_mutate(dir,"newfolder",MutationAction::Mkdir,None,None,&op).is_err());
        fs::write(root.join("file.txt"),b"original").unwrap();
        fs::write(root.join("exists.txt"),b"unchanged").unwrap();
        assert!(local_mutate(dir,"file.txt",MutationAction::Rename,Some("exists.txt"),Some("file"),&op).is_err());
        assert_eq!(fs::read(root.join("exists.txt")).unwrap(),b"unchanged");
        local_mutate(dir,"newfolder",MutationAction::Rename,Some("renamed"),Some("directory"),&op).unwrap();
        assert!(!root.join("newfolder").exists());
        assert!(root.join("renamed").is_dir());
        fs::create_dir(root.join("occupied")).unwrap();
        fs::write(root.join("occupied").join("protected"),b"keep").unwrap();
        assert!(local_mutate(dir,"renamed",MutationAction::Rename,Some("occupied"),Some("directory"),&op).is_err());
        assert_eq!(fs::read(root.join("occupied").join("protected")).unwrap(),b"keep");
        local_mutate(dir,"file.txt",MutationAction::Rename,Some("renamed.txt"),Some("file"),&op).unwrap();
        assert!(!root.join("file.txt").exists());
        assert_eq!(fs::read(root.join("renamed.txt")).unwrap(),b"original");
        fs::write(root.join("renamed").join("child"),b"x").unwrap();
        assert!(local_mutate(dir,"renamed",MutationAction::Delete,None,Some("directory"),&op).is_err());
        assert!(local_mutate(dir,"renamed.txt",MutationAction::Delete,None,Some("symlink"),&op).is_err());
        local_mutate(dir,"renamed.txt",MutationAction::Delete,None,Some("file"),&op).unwrap();
        local_mutate(root.join("renamed").to_str().unwrap(),"child",MutationAction::Delete,None,Some("file"),&op).unwrap();
        local_mutate(dir,"renamed",MutationAction::Delete,None,Some("directory"),&op).unwrap();
        fs::remove_file(root.join("occupied").join("protected")).unwrap();
        fs::remove_dir(root.join("occupied")).unwrap();
        fs::remove_file(root.join("exists.txt")).unwrap();
        fs::remove_dir(root).unwrap();
    }
    #[test] fn local_no_replace_and_partial_cleanup() {
        let root = std::env::temp_dir().join(format!("nodedesk-test-{}",std::process::id())); fs::create_dir_all(&root).unwrap();
        let path = root.join("target"); let _ = fs::remove_file(&path);
        let f = private_new(&path).unwrap(); drop(f); assert!(private_new(&path).is_err());
        drop(PartialLocal {path:path.clone(),keep_on_error:true});
        assert!(path.exists(),"explicit batch retention does not remove partial");
        drop(PartialLocal {path:path.clone(),keep_on_error:false});
        assert!(!path.exists());
        fs::remove_dir(root).unwrap();
        assert!(local_dir("../").is_err());
    }
    #[cfg(unix)]
    #[test]
    fn real_structured_sftp_binary_trust_and_cancel() {
        let Ok(dir) = std::env::var("NODEDESK_SSH_FIXTURE") else { return; };
        let d = Destination {host:"127.0.0.1".into(),port:22229,username:std::env::var("USER").unwrap(),auth_session:None,control:None,native:None};
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
        // Verified byte-offset upload: prefix is written through real SFTP v3,
        // remainder is appended only after an exact prefix comparison.
        let resume_dest=wire::join(remote_path,"resumed.bin").unwrap();
        let resume_part=wire::join(remote_path,".resume-test.part").unwrap();
        let partial_handle=c.open(&resume_part,2|8|32).unwrap();
        c.write(&partial_handle,0,&bytes[..45000]).unwrap();
        c.close(&partial_handle).unwrap();
        copy_upload_resume(&mut c,&source,&resume_dest,&resume_part,&op,&events).unwrap();
        assert_eq!(fs::read(&resume_dest).unwrap(),bytes);
        assert!(!Path::new(&resume_part).exists());
        assert!(copy_upload_resume(&mut c,&source,&resume_dest,&resume_part,&op,&events).is_err());
        // Refuse a remote partial whose bytes differ, leaving it untouched.
        let corrupt_dest=wire::join(remote_path,"corrupt-resume.bin").unwrap();
        let corrupt_part=wire::join(remote_path,".corrupt-resume.part").unwrap();
        let corrupt=vec![255_u8;40000];
        let h=c.open(&corrupt_part,2|8|32).unwrap();
        c.write(&h,0,&corrupt).unwrap();c.close(&h).unwrap();
        assert!(copy_upload_resume(&mut c,&source,&corrupt_dest,&corrupt_part,&op,&events).is_err());
        assert!(!Path::new(&corrupt_dest).exists());
        assert_eq!(fs::read(&corrupt_part).unwrap(),corrupt);
        // A destination collision must abort even if the partial matches.
        let collision_dest=wire::join(remote_path,"existing-target.bin").unwrap();
        fs::write(&collision_dest,b"untouched").unwrap();
        let matching_part=wire::join(remote_path,".matching-part.bin").unwrap();
        let h=c.open(&matching_part,2|8|32).unwrap();
        c.write(&h,0,&bytes[..32768]).unwrap();c.close(&h).unwrap();
        assert!(copy_upload_resume(&mut c,&source,&collision_dest,&matching_part,&op,&events).is_err());
        assert_eq!(fs::read(&collision_dest).unwrap(),b"untouched");
        assert_eq!(fs::read(&matching_part).unwrap(),&bytes[..32768]);
        let missing_part=wire::join(remote_path,".missing-resume.part").unwrap();
        assert!(copy_upload_resume(&mut c,&source,&wire::join(remote_path,"missing-resume.bin").unwrap(),
            &missing_part,&op,&events).is_err());
        let empty_part=wire::join(remote_path,".empty-resume.part").unwrap();
        fs::write(&empty_part,b"").unwrap();
        assert!(copy_upload_resume(&mut c,&source,&wire::join(remote_path,"empty-resume.bin").unwrap(),
            &empty_part,&op,&events).is_err());
        let oversized=wire::join(remote_path,".oversized-resume.part").unwrap();
        fs::write(&oversized,vec![0_u8;bytes.len()+1]).unwrap();
        assert!(copy_upload_resume(&mut c,&source,&wire::join(remote_path,"oversized-resume.bin").unwrap(),
            &oversized,&op,&events).is_err());
        let link_partial=wire::join(remote_path,".symlink-resume.part").unwrap();
        std::os::unix::fs::symlink(&source,&link_partial).unwrap();
        assert!(copy_upload_resume(&mut c,&source,&wire::join(remote_path,"symlink-resume.bin").unwrap(),
            &link_partial,&op,&events).is_err());
        let listing = remote_list(&mut c,remote_path,&op).unwrap();
        assert!(listing.entries.iter().any(|e|e.name==filename && e.kind=="file"));
        let downloaded = local.join("download.bin"); let partial = local.join(".download.part");
        copy_download(&mut c,&dest,&downloaded,&partial,&op,&events,false).unwrap();
        assert_eq!(fs::read(&downloaded).unwrap(),bytes); assert!(!partial.exists());
        assert!(copy_download(&mut c,&dest,&downloaded,&partial,&op,&events,false).is_err());
        // Recover an interrupted local download by validating every prefix
        // byte through real SFTP before writing any additional data.
        let resume_partial=local.join(".nodedesk-resume-download.part");
        fs::write(&resume_partial,&bytes[..45000]).unwrap();
        let resumed=local.join("download-resumed.bin");
        copy_download_resume(&mut c,&dest,&resumed,&resume_partial,&op,&events).unwrap();
        assert_eq!(fs::read(&resumed).unwrap(),bytes);
        assert!(!resume_partial.exists());
        assert!(copy_download_resume(&mut c,&dest,&resumed,&resume_partial,&op,&events).is_err());
        // An incorrect prefix fails closed, leaving the partial unchanged.
        let corrupt_partial=local.join(".nodedesk-corrupted.part");
        fs::write(&corrupt_partial,vec![0xff_u8;40000]).unwrap();
        let denied=local.join("denied-resume.bin");
        assert!(copy_download_resume(&mut c,&dest,&denied,&corrupt_partial,&op,&events).is_err());
        assert!(!denied.exists());
        assert_eq!(fs::read(&corrupt_partial).unwrap(),vec![0xff_u8;40000]);
        // Missing/empty/oversized/symlinked/hard-linked partials all refuse.
        let missing_partial=local.join(".missing.part");
        assert!(copy_download_resume(&mut c,&dest,&denied,&missing_partial,&op,&events).is_err());
        let empty_partial=local.join(".empty.part");fs::write(&empty_partial,b"").unwrap();
        assert!(copy_download_resume(&mut c,&dest,&denied,&empty_partial,&op,&events).is_err());
        let oversize_partial=local.join(".oversize.part");
        fs::write(&oversize_partial,vec![b'x';bytes.len()+1]).unwrap();
        assert!(copy_download_resume(&mut c,&dest,&denied,&oversize_partial,&op,&events).is_err());
        let symlink_partial=local.join(".symlink.part");
        std::os::unix::fs::symlink(&source,&symlink_partial).unwrap();
        assert!(copy_download_resume(&mut c,&dest,&denied,&symlink_partial,&op,&events).is_err());
        let hardlink_partial=local.join(".hardlink.part");
        fs::hard_link(&corrupt_partial,&hardlink_partial).unwrap();
        assert!(copy_download_resume(&mut c,&dest,&denied,&hardlink_partial,&op,&events).is_err());
        // Prevent publishing into an existing target without touching either.
        let existing=local.join("existing.bin");fs::write(&existing,b"untouched").unwrap();
        assert!(copy_download_resume(&mut c,&dest,&existing,&corrupt_partial,&op,&events).is_err());
        assert_eq!(fs::read(&existing).unwrap(),b"untouched");
        // Batch cancellation retains a private partial; the next independent
        // authenticated SFTP operation verifies and resumes it safely.
        let keep_op=Arc::new(Operation::default());
        let mut keep_c=open("trusted-gui",&keep_op).unwrap();
        let keep_cancel=keep_op.clone();
        let keep_events=Channel::<Progress>::new(move |_|{keep_cancel.cancel();Ok(())});
        let kept=local.join(".nodedesk-retained-download.part");
        let kept_target=local.join("retained-resumed.bin");
        assert!(copy_download(&mut keep_c,&dest,&kept_target,&kept,&keep_op,&keep_events,true).is_err());
        assert!(!kept_target.exists());
        assert!(kept.exists());
        assert!(fs::metadata(&kept).unwrap().len()>0);
        let resume_op=Arc::new(Operation::default());
        let mut fresh_c=open("trusted-gui",&resume_op).unwrap();
        copy_download_resume(&mut fresh_c,&dest,&kept_target,&kept,&resume_op,&events).unwrap();
        assert_eq!(fs::read(&kept_target).unwrap(),bytes);
        assert!(!kept.exists());
        resume_op.stop();
        assert!(copy_upload(&mut c,&source,&dest,&temp,&op,&events).is_err());
        assert_eq!(fs::read(&dest).unwrap(),bytes); // collision must never clobber
        // Read-only UTF-8 preview uses the same authenticated SFTP transport.
        let note="nodedesk-preview.txt";let note_path=wire::join(remote_path,note).unwrap();
        fs::write(&note_path,"Тестовая заметка\nsecond line").unwrap();
        let view=preview_remote(&mut c,remote_path,note,&op).unwrap();
        assert_eq!(view.content,"Тестовая заметка\nsecond line");
        assert_eq!(view.bytes,view.content.as_bytes().len());
        let request=SaveTextCopyRequest{
            destination:d.clone(),directory:remote_path.to_owned(),
            original_name:note.to_owned(),original_content:view.content.clone(),
            new_name:"nodedesk-preview-edited.txt".into(),
            content:"Тестовая заметка\nupdated text".into()
        };
        let saved=save_text_copy(&mut c,&request,&op).unwrap();
        assert_eq!(saved.bytes,request.content.as_bytes().len());
        assert!(saved.source_unchanged);
        assert_eq!(fs::read_to_string(remote.join(&request.new_name)).unwrap(),request.content);
        assert_eq!(fs::read_to_string(&note_path).unwrap(),view.content);
        // Existing output must never be replaced, including by a second save.
        assert!(save_text_copy(&mut c,&request,&op).is_err());
        assert_eq!(fs::read_to_string(remote.join(&request.new_name)).unwrap(),request.content);
        let mut conflict=SaveTextCopyRequest{
            new_name:"nodedesk-conflict-copy.txt".into(),..request
        };
        fs::write(&note_path,"changed on server").unwrap();
        assert!(save_text_copy(&mut c,&conflict,&op).is_err());
        assert!(!remote.join(&conflict.new_name).exists());
        // Client-supplied traversal and original-name overwrite are rejected.
        conflict.new_name="../outside".into();
        assert!(save_text_copy(&mut c,&conflict,&op).is_err());
        conflict.new_name=note.into();
        assert!(save_text_copy(&mut c,&conflict,&op).is_err());
        fs::remove_file(remote.join("nodedesk-preview-edited.txt")).unwrap();

        assert!(preview_remote(&mut c,remote_path,filename,&op).is_err());
        fs::write(remote.join("oversize.txt"),vec![b'x';PREVIEW_LIMIT+1]).unwrap();
        assert!(preview_remote(&mut c,remote_path,"oversize.txt",&op).is_err());
        assert!(preview_remote(&mut c,remote_path,"../outside",&op).is_err());
        fs::remove_file(remote.join(note)).unwrap();
        fs::remove_file(remote.join("oversize.txt")).unwrap();
        assert!(c.lstat(&format!("{remote_path}/missing")).is_err());
        // Real SFTP v3 CRUD: mkdir, collision refusal, rename without clobber,
        // non-recursive delete, and type/symlink validation.
        remote_mutate(&mut c,remote_path,"created folder",MutationAction::Mkdir,None,None,&op).unwrap();
        assert!(remote.join("created folder").is_dir());
        assert!(remote_mutate(&mut c,remote_path,"created folder",MutationAction::Mkdir,None,None,&op).is_err());
        remote_mutate(&mut c,remote_path,"created folder",MutationAction::Rename,Some("renamed folder"),Some("directory"),&op).unwrap();
        assert!(remote.join("renamed folder").is_dir());
        assert!(remote_mutate(&mut c,remote_path,"renamed folder",MutationAction::Rename,Some(filename),Some("directory"),&op).is_err());
        assert_eq!(fs::read(&dest).unwrap(),bytes);
        fs::write(remote.join("renamed folder").join("child"),b"x").unwrap();
        assert!(remote_mutate(&mut c,remote_path,"renamed folder",MutationAction::Delete,None,Some("directory"),&op).is_err());
        remote_mutate(&mut c,&format!("{remote_path}/renamed folder"),"child",MutationAction::Delete,None,Some("file"),&op).unwrap();
        remote_mutate(&mut c,remote_path,"renamed folder",MutationAction::Delete,None,Some("directory"),&op).unwrap();
        assert!(!remote.join("renamed folder").exists());
        std::os::unix::fs::symlink(&dest,remote.join("link")).unwrap();
        assert!(copy_download(&mut c,&format!("{remote_path}/link"),&local.join("link-copy"),&partial,&op,&events,false).is_err());
        // Cancel during a real transfer, not just before the command: the first
        // progress callback kills the transport and the local partial is removed.
        let cancelled = Arc::new(Operation::default());
        let mut cc = open("trusted-gui",&cancelled).unwrap();
        let cancel_op = cancelled.clone();
        let cancel_events = Channel::<Progress>::new(move |_| { cancel_op.cancel(); Ok(()) });
        let cancelled_target = local.join("cancelled.bin");
        assert!(copy_download(&mut cc,&dest,&cancelled_target,&partial,&cancelled,&cancel_events,false).is_err());
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
