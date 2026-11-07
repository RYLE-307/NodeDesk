mod ssh;
mod sftp_wire;
mod files;
mod native_auth;
mod rdp;
mod vnc;
mod vpn;
mod network;
mod tunnels;
use tauri::Manager;
pub fn run() {
    tauri::Builder::default()
        .manage(ssh::Sessions::default())
        .manage(files::Operations::default())
        .manage(native_auth::Logins::default())
        .manage(tunnels::Tunnels::default())
        .invoke_handler(tauri::generate_handler![ssh::files_auth_ready, ssh::ssh_connect, ssh::ssh_write, ssh::ssh_resize, ssh::ssh_disconnect, files::files_capabilities, files::files_list, files::files_transfer, files::files_mutate, files::files_cancel, rdp::rdp_launch, vnc::vnc_launch, vpn::vpn_list, vpn::vpn_set, network::network_probe, network::network_ping, tunnels::tunnel_start, tunnels::tunnel_stop])
        .on_window_event(|window, event| { if matches!(event, tauri::WindowEvent::Destroyed) { window.state::<ssh::Sessions>().shutdown(); window.state::<files::Operations>().shutdown(); window.state::<native_auth::Logins>().shutdown(); window.state::<tunnels::Tunnels>().shutdown(); } })
        .run(tauri::generate_context!())
        .expect("failed to run NodeDesk");
}
