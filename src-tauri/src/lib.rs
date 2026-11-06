mod ssh;
mod sftp_wire;
mod files;
use tauri::Manager;
pub fn run() {
    tauri::Builder::default()
        .manage(ssh::Sessions::default())
        .manage(files::Operations::default())
        .invoke_handler(tauri::generate_handler![ssh::files_auth_ready, ssh::ssh_connect, ssh::ssh_write, ssh::ssh_resize, ssh::ssh_disconnect, files::files_capabilities, files::files_list, files::files_transfer, files::files_mutate, files::files_cancel])
        .on_window_event(|window, event| { if matches!(event, tauri::WindowEvent::Destroyed) { window.state::<ssh::Sessions>().shutdown(); window.state::<files::Operations>().shutdown(); } })
        .run(tauri::generate_context!())
        .expect("failed to run NodeDesk");
}
