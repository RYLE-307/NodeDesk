//! Read-only local metrics. Called only while the operator enables monitoring.
//! No process names, mount paths, interface names, hostnames or remote requests.
use serde::Serialize;
use std::sync::{Mutex, OnceLock};
use sysinfo::{Disks, Networks, System};

static CPU: OnceLock<Mutex<System>> = OnceLock::new();

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    cpu_percent: f32,
    memory_used_bytes: u64,
    memory_total_bytes: u64,
    disk_used_bytes: u64,
    disk_total_bytes: u64,
    network_received_bytes: u64,
    network_transmitted_bytes: u64,
}

fn snapshot() -> Result<Snapshot, String> {
    let system = CPU.get_or_init(|| Mutex::new(System::new()));
    let mut system = system.lock().map_err(|_| "Monitoring state unavailable")?;
    system.refresh_cpu_usage();
    system.refresh_memory();
    let cpu_percent = system.global_cpu_usage().clamp(0.0, 100.0);
    let disks = Disks::new_with_refreshed_list();
    let (disk_used_bytes, disk_total_bytes) =
        disks.iter().fold((0u64, 0u64), |(used, total), disk| {
            let size = disk.total_space();
            (
                used.saturating_add(size.saturating_sub(disk.available_space())),
                total.saturating_add(size),
            )
        });
    let networks = Networks::new_with_refreshed_list();
    let (network_received_bytes, network_transmitted_bytes) =
        networks
            .iter()
            .fold((0u64, 0u64), |(received, sent), (_, data)| {
                (
                    received.saturating_add(data.total_received()),
                    sent.saturating_add(data.total_transmitted()),
                )
            });
    Ok(Snapshot {
        cpu_percent,
        memory_used_bytes: system.used_memory(),
        memory_total_bytes: system.total_memory(),
        disk_used_bytes,
        disk_total_bytes,
        network_received_bytes,
        network_transmitted_bytes,
    })
}

#[tauri::command]
pub async fn monitor_snapshot() -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(snapshot)
        .await
        .map_err(|_| "Monitoring worker failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_snapshot_is_bounded_and_consistent() {
        let value = snapshot().unwrap();
        assert!((0.0..=100.0).contains(&value.cpu_percent));
        assert!(value.memory_used_bytes <= value.memory_total_bytes);
        assert!(value.disk_used_bytes <= value.disk_total_bytes);
    }
}
