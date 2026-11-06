mod ssh;
use tauri::Manager;
pub fn run() {
    tauri::Builder::default()
        .manage(ssh::Sessions::default())
        .invoke_handler(tauri::generate_handler![ssh::ssh_connect, ssh::ssh_write, ssh::ssh_resize, ssh::ssh_disconnect])
        .on_window_event(|window, event| { if matches!(event, tauri::WindowEvent::Destroyed) { window.state::<ssh::Sessions>().shutdown(); } })
        .run(tauri::generate_context!())
        .expect("failed to run NodeDesk");
}
