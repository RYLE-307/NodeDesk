mod ssh;
mod sftp_wire;
mod files;
mod native_auth;
mod rdp;
mod direct_rdp;
mod direct_vnc;
mod vnc;
mod vpn;
mod network;
mod tunnels;
mod monitoring;
mod vault;
use tauri::Manager;
pub fn run() {
    tauri::Builder::default()
        .manage(ssh::Sessions::default())
        .manage(files::Operations::default())
        .manage(native_auth::Logins::default())
        .manage(network::Diagnostics::default())
        .manage(tunnels::Tunnels::default())
        .manage(vpn::VpnActions::default())
        .manage(vault::Vault::default())
        .manage(direct_vnc::Sessions::default())
        .manage(direct_rdp::Sessions::default())
        .invoke_handler(tauri::generate_handler![ssh::files_auth_ready, ssh::ssh_config_preview, ssh::ssh_connect, ssh::ssh_write, ssh::ssh_resize, ssh::ssh_disconnect, files::files_capabilities, files::files_list, files::files_transfer, files::files_mutate, files::files_chmod, files::files_cancel, files::files_preview, files::files_save_text_copy, rdp::rdp_launch, direct_rdp::rdp_direct_connect, direct_rdp::rdp_direct_connect_saved, direct_rdp::rdp_direct_disconnect, direct_rdp::rdp_direct_resize, direct_rdp::rdp_direct_input, direct_rdp::rdp_direct_release_input, vnc::vnc_launch, direct_vnc::vnc_direct_connect, direct_vnc::vnc_direct_connect_saved, direct_vnc::vnc_direct_disconnect, direct_vnc::vnc_direct_input, vpn::vpn_list, vpn::vpn_set, vpn::vpn_health, network::network_probe, network::network_ping, network::network_trace, network::network_cancel, network::network_scan_ports, tunnels::tunnel_start, tunnels::tunnel_stop, monitoring::monitor_snapshot, vault::vault_status, vault::vault_unlock, vault::vault_lock, vault::vault_has, vault::vault_put, vault::vault_get, vault::vault_delete])
        .on_window_event(|window, event| { if matches!(event, tauri::WindowEvent::Destroyed) { window.state::<ssh::Sessions>().shutdown(); window.state::<files::Operations>().shutdown(); window.state::<native_auth::Logins>().shutdown(); window.state::<network::Diagnostics>().shutdown(); window.state::<tunnels::Tunnels>().shutdown(); window.state::<direct_rdp::Sessions>().shutdown(); window.state::<direct_vnc::Sessions>().shutdown(); window.state::<vault::Vault>().lock(); } })
        .run(tauri::generate_context!())
        .expect("failed to run NodeDesk");
}
