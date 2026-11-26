//! A retiring worker may remove only the session instance it owns.
use std::{collections::HashMap, sync::{Arc, Mutex}};

pub(crate) fn remove_owned<T>(
    registry: &Mutex<HashMap<String, Arc<T>>>,
    id: &str,
    owner: &Arc<T>,
) {
    remove_matching(registry, id, |current| Arc::ptr_eq(current, owner));
}

pub(crate) fn remove_matching<T>(
    registry: &Mutex<HashMap<String, T>>,
    id: &str,
    owns: impl FnOnce(&T) -> bool,
) {
    if let Ok(mut sessions) = registry.lock() {
        if sessions.get(id).is_some_and(owns) {
            sessions.remove(id);
        }
    }
}

/// Serialize publication with cancellation, including while an OS vault read
/// is running. A cancelled worker cannot publish a connection later.
#[derive(Default)]
pub(crate) struct PendingStarts(Arc<Mutex<HashMap<String, Arc<()>>>>);

pub(crate) struct StartPermit {
    pending: Arc<Mutex<HashMap<String, Arc<()>>>>,
    id: String,
    owner: Arc<()>,
}

impl PendingStarts {
    pub(crate) fn begin(&self, id: &str) -> Result<StartPermit, String> {
        let mut pending = self.0.lock().map_err(|_| "Connection state unavailable")?;
        if pending.contains_key(id) || pending.len() >= 16 {
            return Err("Connection start already pending or limit reached".into());
        }
        let owner = Arc::new(());
        pending.insert(id.into(), Arc::clone(&owner));
        Ok(StartPermit { pending: Arc::clone(&self.0), id: id.into(), owner })
    }

    pub(crate) fn cancel_with<T>(&self, id: &str, close: impl FnOnce() -> T) -> T {
        // Keep publication and active-session removal in the same critical section.
        let mut pending = self.0.lock().unwrap_or_else(|e| e.into_inner());
        pending.remove(id);
        close()
    }

    pub(crate) fn shutdown_with(&self, close: impl FnOnce()) {
        let mut pending = self.0.lock().unwrap_or_else(|e| e.into_inner());
        pending.clear();
        close();
    }
}

impl StartPermit {
    pub(crate) fn publish<T>(&self, start: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        let pending = self.pending.lock().map_err(|_| "Connection state unavailable")?;
        if !pending.get(&self.id).is_some_and(|owner| Arc::ptr_eq(owner, &self.owner)) {
            return Err("Connection start cancelled".into());
        }
        start()
    }
}

impl Drop for StartPermit {
    fn drop(&mut self) { remove_owned(&self.pending, &self.id, &self.owner); }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_during_vault_read_prevents_late_publication_and_preserves_retry() {
        let starts = PendingStarts::default();
        let old = starts.begin("fixture").unwrap();
        assert!(starts.begin("fixture").is_err());
        starts.cancel_with("fixture", || ());
        let new = starts.begin("fixture").unwrap();
        assert!(old.publish(|| -> Result<(), String> { panic!("cancelled start ran") }).is_err());
        drop(old);
        assert_eq!(new.publish(|| Ok(42)).unwrap(), 42);
        drop(new);
        assert!(starts.begin("fixture").is_ok());
    }

    #[test]
    fn shutdown_cancels_pending_starts_and_failure_releases_id() {
        let starts = PendingStarts::default();
        let pending = starts.begin("fixture").unwrap();
        starts.shutdown_with(|| ());
        assert!(pending.publish(|| Ok(())).is_err());
        drop(pending);
        let failed = starts.begin("fixture").unwrap();
        assert!(failed.publish(|| Err::<(), _>("fixture failure".into())).is_err());
        drop(failed);
        assert!(starts.begin("fixture").is_ok());
    }

    #[test]
    fn retiring_worker_cannot_remove_replacement_with_same_id() {
        let old = Arc::new(());
        let new = Arc::new(());
        let registry = Mutex::new(HashMap::from([("fixture".into(), old.clone())]));
        registry.lock().unwrap().remove("fixture");
        registry.lock().unwrap().insert("fixture".into(), new.clone());
        remove_owned(&registry, "fixture", &old);
        assert!(Arc::ptr_eq(registry.lock().unwrap().get("fixture").unwrap(), &new));
        remove_owned(&registry, "fixture", &new);
        assert!(registry.lock().unwrap().is_empty());
    }

    #[test]
    fn cleanup_is_idempotent_and_preserves_other_sessions() {
        let owner = Arc::new(());
        let other = Arc::new(());
        let registry = Mutex::new(HashMap::from([
            ("fixture".into(), owner.clone()), ("other".into(), other.clone()),
        ]));
        remove_owned(&registry, "fixture", &owner);
        remove_owned(&registry, "fixture", &owner);
        remove_owned(&registry, "missing", &owner);
        let sessions = registry.lock().unwrap();
        assert_eq!(sessions.len(), 1);
        assert!(Arc::ptr_eq(sessions.get("other").unwrap(), &other));
    }

    #[test]
    fn failed_start_releases_only_its_reservation() {
        let owner = Arc::new(());
        let registry = Mutex::new(HashMap::from([("fixture".into(), owner.clone())]));
        remove_owned(&registry, "fixture", &owner);
        assert!(registry.lock().unwrap().is_empty());
        registry.lock().unwrap().insert("fixture".into(), Arc::new(()));
        remove_owned(&registry, "fixture", &owner);
        assert_eq!(registry.lock().unwrap().len(), 1);
    }
}
