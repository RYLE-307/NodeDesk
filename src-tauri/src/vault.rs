//! Opt-in OS credential storage. No vault bytes are written to the catalog,
//! WebView storage, command lines, logs or application files. The OS store is
//! the persistence and encryption boundary; this process starts locked.
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::State;
use zeroize::{Zeroize, Zeroizing};

const SERVICE:&str="org.nodedesk.credentials.v1";
const LIMIT:usize=1024; // Windows Credential Manager's blob limit is 2560 bytes.

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Target {
    id:String, protocol:String, host:String, port:u16, username:String,
}
impl Target {
    fn validate(&self)->Result<(),String> {
        if self.id.len()!=36 || !self.id.bytes().enumerate().all(|(i,b)|
            if [8,13,18,23].contains(&i) {b==b'-'} else {b.is_ascii_hexdigit()})
            || !matches!(self.protocol.as_str(),"SSH"|"RDP"|"VNC")
            || self.host.is_empty() || self.host.len()>253
            || self.host.chars().any(|c|c.is_control()||c.is_whitespace()||"/@?#\\".contains(c))
            || self.port==0 || self.username.len()>200
            || self.username.chars().any(char::is_control) {
            return Err("Invalid vault connection identity".into());
        }
        Ok(())
    }
    fn key(&self)->String {format!("{}:{}",self.protocol.to_ascii_lowercase(),self.id.to_ascii_lowercase())}
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record { version:u8, target:Target, secret:String }
impl Drop for Record {fn drop(&mut self){self.secret.zeroize();}}

trait Store:Send+Sync {
    fn probe(&self)->Result<(),String>;
    fn read(&self,key:&str)->Result<Option<String>,String>;
    fn write(&self,key:&str,value:&str)->Result<(),String>;
    fn remove(&self,key:&str)->Result<(),String>;
}
struct OsStore;
impl OsStore {
    fn entry(key:&str)->Result<keyring::Entry,String> {
        keyring::Entry::new(SERVICE,key).map_err(|_|"OS credential store unavailable".into())
    }
}
impl Store for OsStore {
    fn probe(&self)->Result<(),String> {
        let entry=Self::entry("__probe__")?;
        match entry.get_password() {
            Ok(value) if value=="v1"=>Ok(()),
            Err(keyring::Error::NoEntry)=>entry.set_password("v1")
                .map_err(|_|"OS credential store locked or unavailable".into()),
            _=>Err("OS credential store locked or unavailable".into())
        }
    }
    fn read(&self,key:&str)->Result<Option<String>,String> {
        match Self::entry(key)?.get_password() {
            Ok(value)=>Ok(Some(value)),
            Err(keyring::Error::NoEntry)=>Ok(None),
            Err(_)=>Err("Cannot read OS credential store".into()),
        }
    }
    fn write(&self,key:&str,value:&str)->Result<(),String> {
        Self::entry(key)?.set_password(value).map_err(|_|"Cannot write OS credential store".into())
    }
    fn remove(&self,key:&str)->Result<(),String> {
        match Self::entry(key)?.delete_credential() {
            Ok(())|Err(keyring::Error::NoEntry)=>Ok(()),
            Err(_)=>Err("Cannot delete OS credential".into()),
        }
    }
}

#[derive(Clone)]
pub struct Vault {
    gate:Arc<Mutex<bool>>,
    store:Arc<dyn Store>,
}
impl Default for Vault {
    fn default()->Self {Self {gate:Arc::new(Mutex::new(false)),store:Arc::new(OsStore)}}
}
impl Vault {
    pub(crate) fn read_connection(&self,id:String,protocol:&str,host:String,port:u16,username:String)
        ->Result<Option<Zeroizing<String>>,String> {
        self.read(&Target{id,protocol:protocol.into(),host,port,username})
    }
    fn locked(&self)->bool { !self.gate.lock().map(|open|*open).unwrap_or(false) }
    fn unlock(&self)->Result<(),String> {
        let mut open=self.gate.lock().map_err(|_|"Vault lock unavailable")?;
        self.store.probe()?; *open=true; Ok(())
    }
    pub fn lock(&self) {if let Ok(mut open)=self.gate.lock(){*open=false;}}
    fn with_open<T>(&self, f:impl FnOnce(&dyn Store)->Result<T,String>)->Result<T,String> {
        let open=self.gate.lock().map_err(|_|"Vault lock unavailable")?;
        if !*open {return Err("Vault is locked".into());}
        f(self.store.as_ref())
    }
    fn read(&self,target:&Target)->Result<Option<Zeroizing<String>>,String> {
        target.validate()?;
        self.with_open(|store| {
            let Some(raw)=store.read(&target.key())? else {return Ok(None)};
            let raw=Zeroizing::new(raw);
            let mut record:Record=serde_json::from_str(&raw)
                .map_err(|_|"Stored credential is invalid; remove it explicitly".to_string())?;
            if record.version!=1 || record.target!=*target {
                return Err("Stored credential belongs to a different connection; remove it explicitly".into());
            }
            Ok(Some(Zeroizing::new(std::mem::take(&mut record.secret))))
        })
    }
    fn put(&self,target:&Target,secret:Zeroizing<String>)->Result<(),String> {
        target.validate()?;
        if secret.is_empty() || secret.len()>LIMIT || secret.chars().any(|c|c=='\0') {
            return Err("Credential must be 1–1024 UTF-8 bytes without NUL".into());
        }
        self.with_open(|store| {
            // A changed endpoint cannot silently inherit a saved password.
            if let Some(existing)=store.read(&target.key())? {
                let existing=Zeroizing::new(existing);
                let old:Record=serde_json::from_str(&existing)
                    .map_err(|_|"Stored credential is invalid; remove it explicitly".to_string())?;
                if old.target!=*target {return Err("Connection changed; remove old credential explicitly".into());}
            }
            let record=Record {version:1,target:target.clone(),secret:secret.to_string()};
            let encoded=Zeroizing::new(serde_json::to_string(&record)
                .map_err(|_|"Cannot encode credential".to_string())?);
            if encoded.len()>2400 {return Err("Credential record exceeds OS store limit".into());}
            store.write(&target.key(),&encoded)
        })
    }
    fn remove(&self,target:&Target)->Result<(),String> {
        target.validate()?;
        self.with_open(|store|store.remove(&target.key()))
    }
}

#[tauri::command]
pub fn vault_status(state:State<'_,Vault>)->bool { !state.locked() }
#[tauri::command]
pub async fn vault_unlock(state:State<'_,Vault>)->Result<(),String> {
    let vault=state.inner().clone();
    tauri::async_runtime::spawn_blocking(move ||vault.unlock()).await
        .map_err(|_|"Vault worker failed".to_string())?
}
#[tauri::command]
pub fn vault_lock(state:State<'_,Vault>) {state.lock();}
#[tauri::command]
pub async fn vault_has(state:State<'_,Vault>,target:Target)->Result<bool,String> {
    let vault=state.inner().clone();
    tauri::async_runtime::spawn_blocking(move ||vault.read(&target).map(|v|v.is_some())).await
        .map_err(|_|"Vault worker failed".to_string())?
}
#[tauri::command]
pub async fn vault_put(state:State<'_,Vault>,target:Target,secret:String)->Result<(),String> {
    let vault=state.inner().clone();
    tauri::async_runtime::spawn_blocking(move ||vault.put(&target,Zeroizing::new(secret))).await
        .map_err(|_|"Vault worker failed".to_string())?
}
#[tauri::command]
pub async fn vault_get(state:State<'_,Vault>,target:Target)->Result<Option<String>,String> {
    let vault=state.inner().clone();
    tauri::async_runtime::spawn_blocking(move ||vault.read(&target).map(|v|v.map(|s|s.to_string()))).await
        .map_err(|_|"Vault worker failed".to_string())?
}
#[tauri::command]
pub async fn vault_delete(state:State<'_,Vault>,target:Target)->Result<(),String> {
    let vault=state.inner().clone();
    tauri::async_runtime::spawn_blocking(move ||vault.remove(&target)).await
        .map_err(|_|"Vault worker failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    #[derive(Default)] struct MemoryStore(Mutex<HashMap<String,String>>);
    impl Store for MemoryStore {
        fn probe(&self)->Result<(),String>{Ok(())}
        fn read(&self,key:&str)->Result<Option<String>,String>{Ok(self.0.lock().unwrap().get(key).cloned())}
        fn write(&self,key:&str,value:&str)->Result<(),String>{self.0.lock().unwrap().insert(key.into(),value.into());Ok(())}
        fn remove(&self,key:&str)->Result<(),String>{self.0.lock().unwrap().remove(key);Ok(())}
    }
    fn fixture()->(Vault,Target) {
        let vault=Vault{gate:Arc::new(Mutex::new(false)),store:Arc::new(MemoryStore::default())};
        let target=Target{id:"123e4567-e89b-12d3-a456-426614174000".into(),
            protocol:"SSH".into(),host:"127.0.0.1".into(),port:22229,username:"fixture".into()};
        (vault,target)
    }
    #[test]
    fn direct_session_reads_only_matching_unlocked_identity() {
        let (vault,mut target)=fixture();
        target.protocol="RDP".into();
        let read=||vault.read_connection(target.id.clone(),"RDP",target.host.clone(),
            target.port,target.username.clone());
        assert!(read().is_err());
        vault.unlock().unwrap();
        vault.put(&target,Zeroizing::new("fixture-only".into())).unwrap();
        assert_eq!(read().unwrap().unwrap().as_str(),"fixture-only");
        assert!(vault.read_connection(target.id.clone(),"RDP","other.example".into(),
            target.port,target.username.clone()).is_err());
        assert!(vault.read_connection(target.id.clone(),"VNC",target.host.clone(),
            target.port,target.username.clone()).unwrap().is_none());
        vault.lock();
        assert!(read().is_err());
    }
    #[test] fn locked_by_default_and_no_secret_in_errors() {
        let (vault,target)=fixture();
        assert!(vault.locked());
        assert_eq!(vault.put(&target,Zeroizing::new("fixture-secret".into())).unwrap_err(),"Vault is locked");
        vault.unlock().unwrap(); vault.put(&target,Zeroizing::new("fixture-secret".into())).unwrap();
        assert_eq!(vault.read(&target).unwrap().unwrap().as_str(),"fixture-secret");
        vault.lock(); assert!(vault.read(&target).is_err());
        assert!(!format!("{:?}",vault.read(&target)).contains("fixture-secret"));
    }
    #[test] fn endpoint_change_cannot_reuse_secret_and_delete_is_explicit() {
        let (vault,target)=fixture(); vault.unlock().unwrap();
        vault.put(&target,Zeroizing::new("fixture-secret".into())).unwrap();
        let changed=Target{host:"other.example".into(),..target.clone()};
        assert!(vault.read(&changed).is_err());
        assert!(vault.put(&changed,Zeroizing::new("new-secret".into())).is_err());
        vault.remove(&changed).unwrap();
        assert!(vault.read(&target).unwrap().is_none());
        vault.put(&changed,Zeroizing::new("new-secret".into())).unwrap();
        assert_eq!(vault.read(&changed).unwrap().unwrap().as_str(),"new-secret");
    }
    #[test] fn rejects_invalid_identity_and_oversized_secret() {
        let (vault,target)=fixture(); vault.unlock().unwrap();
        for bad in [Target{id:"not-uuid".into(),..target.clone()},
                    Target{host:"bad\nname".into(),..target.clone()},
                    Target{port:0,..target.clone()}] {
            assert!(vault.put(&bad,Zeroizing::new("secret".into())).is_err());
        }
        assert!(vault.put(&target,Zeroizing::new("x".repeat(LIMIT+1))).is_err());
        assert!(vault.read(&target).unwrap().is_none());
    }
    #[cfg(windows)]
    #[test] fn windows_ci_credential_manager_roundtrip_uses_disposable_record() {
        // CI's throwaway Windows user only. Never touch a developer's store.
        if std::env::var("CI").ok().as_deref()!=Some("true") {return;}
        let store=OsStore;
        let key=format!("ci-disposable-{}",std::process::id());
        let _=store.remove(&key);
        store.write(&key,"fixture-only-secret").unwrap();
        assert_eq!(store.read(&key).unwrap().as_deref(),Some("fixture-only-secret"));
        store.remove(&key).unwrap();
        assert!(store.read(&key).unwrap().is_none());
    }
}
