//! A retiring worker may remove only the session instance it owns.
use std::{collections::HashMap, sync::{Arc, Mutex}};

pub(crate) fn remove_owned<T>(
    registry: &Mutex<HashMap<String, Arc<T>>>,
    id: &str,
    owner: &Arc<T>,
) {
    if let Ok(mut sessions) = registry.lock() {
        if sessions.get(id).is_some_and(|current| Arc::ptr_eq(current, owner)) {
            sessions.remove(id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
