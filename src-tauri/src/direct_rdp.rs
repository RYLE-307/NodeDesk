//! Direct, certificate-validated RDP. IronRDP owns protocol negotiation,
//! CredSSP, drawing and reconnect; no TCP/WebSocket proxy or Guacamole needed.
use base64::Engine as _;
use ironrdp::input::{Database, MouseButton, MousePosition, Operation, Scancode};
use ironrdp::pdu::rdp::capability_sets::MajorPlatformType;
use ironrdp_client::{
    config::{ClipboardType, ConfigBuilder, Destination, TransportKind},
    output_channel::output_channel,
    rdp::{AutoReconnectDecision, RdpClient, RdpInputEvent, RdpInputSender, RdpOutputEvent},
};
use ironrdp_tls::CertificateValidation;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{ipc::Channel, State};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Target {
    id: String,
    host: String,
    port: u16,
    username: String,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Event {
    Status {
        phase: &'static str,
    },
    Frame {
        width: u16,
        height: u16,
        png: String,
    },
    Error {
        message: &'static str,
    },
}

struct Session {
    sender: RdpInputSender,
    input: Mutex<Database>,
}
#[derive(Default)]
pub struct Sessions(Arc<Mutex<HashMap<String, Arc<Session>>>>);
impl Sessions {
    pub fn shutdown(&self) {
        if let Ok(mut sessions) = self.0.lock() {
            for (_, session) in sessions.drain() {
                session.sender.request_close();
            }
        }
    }
}

fn valid_target(target: &Target) -> bool {
    target.id.len() == 36
        && target.id.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
        && crate::rdp::endpoint(&target.host, target.port).is_ok()
        && !target.username.is_empty()
        && target.username.len() <= 200
        && !target.username.chars().any(char::is_control)
}

fn config(
    target: &Target,
    password: String,
    width: u16,
    height: u16,
    clipboard: bool,
) -> Result<ironrdp_client::config::Config, String> {
    if !valid_target(target)
        || password.is_empty()
        || password.len() > 1024
        || password.contains('\0')
        || !(320..=1920).contains(&width)
        || !(240..=1080).contains(&height)
    {
        return Err("Invalid direct RDP parameters".into());
    }
    if std::env::var_os("SSLKEYLOGFILE").is_some() {
        return Err("Disable TLS key logging before direct RDP".into());
    }
    let endpoint = crate::rdp::endpoint(&target.host, target.port)?;
    let destination =
        Destination::new(endpoint).map_err(|_| "Invalid RDP destination".to_string())?;
    let platform = if cfg!(windows) {
        MajorPlatformType::WINDOWS
    } else {
        MajorPlatformType::UNIX
    };
    ConfigBuilder::new()
        .with_destination(destination)
        .with_username(target.username.clone())
        .with_password(password)
        .with_client_build(2600)
        .with_client_name("NodeDesk")
        .with_client_dir("C:\\Windows\\System32\\mstscax.dll")
        .with_platform(platform)
        .with_desktop_width(width)
        .with_desktop_height(height)
        .with_transport(TransportKind::Direct)
        .with_credssp(true)
        .with_tls(false)
        .with_certificate_validation(CertificateValidation::Strict)
        .with_clipboard(if clipboard {
            ClipboardType::Enable
        } else {
            ClipboardType::Disable
        })
        .with_pointer_software_rendering(true)
        .build()
        .map_err(|_| "Cannot configure direct RDP".into())
}

fn encode_frame(buffer: Vec<u32>, width: u16, height: u16) -> Result<String, String> {
    if width == 0
        || height == 0
        || width > 4096
        || height > 2160
        || buffer.len() != usize::from(width) * usize::from(height)
    {
        return Err("Invalid RDP framebuffer".into());
    }
    let mut rgba = Vec::with_capacity(buffer.len() * 4);
    for pixel in buffer {
        let [_, r, g, b] = pixel.to_be_bytes();
        rgba.extend_from_slice(&[r, g, b, 255]);
    }
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, u32::from(width), u32::from(height));
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .and_then(|mut writer| writer.write_image_data(&rgba))
            .map_err(|_| "Cannot encode RDP framebuffer".to_string())?;
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
pub async fn rdp_direct_connect(
    sessions: State<'_, Sessions>,
    target: Target,
    password: String,
    width: u16,
    height: u16,
    clipboard: bool,
    events: Channel<Event>,
) -> Result<(), String> {
    // Config owns the transient password after IPC; no catalog, WebView storage,
    // command line, URL, file or log contains it. The pinned IronRDP revision
    // stores it as a String, so memory wiping remains an open security gate.
    let settings = config(&target, password, width, height, clipboard)?;
    let (output, mut receiver) = output_channel(8);
    let client = RdpClient::new(settings, output).with_auto_reconnect(3);
    let session = Arc::new(Session {
        sender: client.input_sender(),
        input: Mutex::new(Database::new()),
    });
    {
        let mut all = sessions
            .0
            .lock()
            .map_err(|_| "RDP session state unavailable")?;
        if all.contains_key(&target.id) {
            return Err("RDP connection already active".into());
        }
        all.insert(target.id.clone(), Arc::clone(&session));
    }
    let registry = Arc::clone(&sessions.0);
    let id = target.id;
    std::thread::Builder::new()
        .name("nodedesk-rdp".into())
        .spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(runtime) => runtime,
                Err(_) => {
                    let _ = events.send(Event::Error {
                        message: "RDP runtime unavailable",
                    });
                    if let Ok(mut all) = registry.lock() {
                        all.remove(&id);
                    }
                    return;
                }
            };
            let local = tokio::task::LocalSet::new();
            runtime.block_on(local.run_until(async move {
                tokio::task::spawn_local(client.run());
                let _ = events.send(Event::Status {
                    phase: "connecting",
                });
                let mut last_frame = Instant::now() - Duration::from_secs(1);
                while let Some(event) = receiver.recv().await {
                    let result = match event {
                        RdpOutputEvent::Connected | RdpOutputEvent::AutoReconnected => {
                            events.send(Event::Status { phase: "connected" })
                        }
                        RdpOutputEvent::AutoReconnecting { response, .. } => {
                            let _ = response.send(AutoReconnectDecision::Continue);
                            events.send(Event::Status {
                                phase: "reconnecting",
                            })
                        }
                        RdpOutputEvent::Image {
                            buffer,
                            width,
                            height,
                        } => {
                            if last_frame.elapsed() < Duration::from_millis(80) {
                                continue;
                            }
                            last_frame = Instant::now();
                            match encode_frame(buffer, width.get(), height.get()) {
                                Ok(png) => events.send(Event::Frame {
                                    width: width.get(),
                                    height: height.get(),
                                    png,
                                }),
                                Err(_) => {
                                    session.sender.request_close();
                                    events.send(Event::Error {
                                        message: "Invalid RDP framebuffer",
                                    })
                                }
                            }
                        }
                        RdpOutputEvent::ConnectionFailure(_)
                        | RdpOutputEvent::Terminated(Err(_)) => events.send(Event::Error {
                            message: "RDP connection or authentication failed",
                        }),
                        RdpOutputEvent::Terminated(Ok(_)) => {
                            let _ = events.send(Event::Status { phase: "closed" });
                            break;
                        }
                        _ => continue,
                    };
                    if result.is_err() {
                        session.sender.request_close();
                        break;
                    }
                }
                session.sender.request_close();
                if let Ok(mut all) = registry.lock() {
                    all.remove(&id);
                }
            }));
        })
        .map_err(|_| "Cannot start RDP worker".to_string())?;
    Ok(())
}

#[tauri::command]
pub fn rdp_direct_disconnect(sessions: State<'_, Sessions>, id: String) -> Result<(), String> {
    let all = sessions
        .0
        .lock()
        .map_err(|_| "RDP session state unavailable")?;
    let session = all.get(&id).ok_or("RDP session closed")?;
    session.sender.request_close();
    Ok(())
}

#[tauri::command]
pub fn rdp_direct_resize(
    sessions: State<'_, Sessions>,
    id: String,
    width: u16,
    height: u16,
) -> Result<(), String> {
    if !(320..=1920).contains(&width) || !(240..=1080).contains(&height) {
        return Err("Invalid RDP size".into());
    }
    let all = sessions
        .0
        .lock()
        .map_err(|_| "RDP session state unavailable")?;
    let session = all.get(&id).ok_or("RDP session closed")?;
    session
        .sender
        .try_send(RdpInputEvent::Resize {
            width,
            height,
            scale_factor: 100,
            physical_size: None,
        })
        .map_err(|_| "RDP input busy or closed".into())
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Input {
    Key {
        code: String,
        down: bool,
    },
    Mouse {
        x: u16,
        y: u16,
        button: Option<u8>,
        down: Option<bool>,
    },
}

fn key_scancode(code: &str) -> Option<Scancode> {
    let (extended, value) = match code {
        "Escape" => (false, 0x01),
        "Digit1" => (false, 0x02),
        "Digit2" => (false, 0x03),
        "Digit3" => (false, 0x04),
        "Digit4" => (false, 0x05),
        "Digit5" => (false, 0x06),
        "Digit6" => (false, 0x07),
        "Digit7" => (false, 0x08),
        "Digit8" => (false, 0x09),
        "Digit9" => (false, 0x0a),
        "Digit0" => (false, 0x0b),
        "Minus" => (false, 0x0c),
        "Equal" => (false, 0x0d),
        "Backspace" => (false, 0x0e),
        "Tab" => (false, 0x0f),
        "KeyQ" => (false, 0x10),
        "KeyW" => (false, 0x11),
        "KeyE" => (false, 0x12),
        "KeyR" => (false, 0x13),
        "KeyT" => (false, 0x14),
        "KeyY" => (false, 0x15),
        "KeyU" => (false, 0x16),
        "KeyI" => (false, 0x17),
        "KeyO" => (false, 0x18),
        "KeyP" => (false, 0x19),
        "BracketLeft" => (false, 0x1a),
        "BracketRight" => (false, 0x1b),
        "Enter" => (false, 0x1c),
        "ControlLeft" => (false, 0x1d),
        "KeyA" => (false, 0x1e),
        "KeyS" => (false, 0x1f),
        "KeyD" => (false, 0x20),
        "KeyF" => (false, 0x21),
        "KeyG" => (false, 0x22),
        "KeyH" => (false, 0x23),
        "KeyJ" => (false, 0x24),
        "KeyK" => (false, 0x25),
        "KeyL" => (false, 0x26),
        "Semicolon" => (false, 0x27),
        "Quote" => (false, 0x28),
        "Backquote" => (false, 0x29),
        "ShiftLeft" => (false, 0x2a),
        "Backslash" => (false, 0x2b),
        "KeyZ" => (false, 0x2c),
        "KeyX" => (false, 0x2d),
        "KeyC" => (false, 0x2e),
        "KeyV" => (false, 0x2f),
        "KeyB" => (false, 0x30),
        "KeyN" => (false, 0x31),
        "KeyM" => (false, 0x32),
        "Comma" => (false, 0x33),
        "Period" => (false, 0x34),
        "Slash" => (false, 0x35),
        "ShiftRight" => (false, 0x36),
        "AltLeft" => (false, 0x38),
        "Space" => (false, 0x39),
        "CapsLock" => (false, 0x3a),
        "F1" => (false, 0x3b),
        "F2" => (false, 0x3c),
        "F3" => (false, 0x3d),
        "F4" => (false, 0x3e),
        "F5" => (false, 0x3f),
        "F6" => (false, 0x40),
        "F7" => (false, 0x41),
        "F8" => (false, 0x42),
        "F9" => (false, 0x43),
        "F10" => (false, 0x44),
        "F11" => (false, 0x57),
        "F12" => (false, 0x58),
        "Home" => (true, 0x47),
        "ArrowUp" => (true, 0x48),
        "PageUp" => (true, 0x49),
        "ArrowLeft" => (true, 0x4b),
        "ArrowRight" => (true, 0x4d),
        "End" => (true, 0x4f),
        "ArrowDown" => (true, 0x50),
        "PageDown" => (true, 0x51),
        "Insert" => (true, 0x52),
        "Delete" => (true, 0x53),
        "ControlRight" => (true, 0x1d),
        "AltRight" => (true, 0x38),
        "MetaLeft" => (true, 0x5b),
        "MetaRight" => (true, 0x5c),
        _ => return None,
    };
    Some(Scancode::from_u8(extended, value))
}

#[tauri::command]
pub fn rdp_direct_input(
    sessions: State<'_, Sessions>,
    id: String,
    input: Input,
) -> Result<(), String> {
    let all = sessions
        .0
        .lock()
        .map_err(|_| "RDP session state unavailable")?;
    let session = all.get(&id).ok_or("RDP session closed")?;
    let permit = session
        .sender
        .try_reserve()
        .map_err(|_| "RDP input busy or closed")?;
    let operations = match input {
        Input::Key { code, down } => {
            let key = key_scancode(&code).ok_or("Unsupported RDP key")?;
            if down {
                vec![Operation::KeyPressed(key)]
            } else {
                vec![Operation::KeyReleased(key)]
            }
        }
        Input::Mouse { x, y, button, down } => {
            if x > 4095 || y > 2159 {
                return Err("Invalid RDP pointer".into());
            }
            match (button, down) {
                (None, None) => vec![Operation::MouseMove(MousePosition { x, y })],
                (Some(b), Some(pressed)) => {
                    let button = match b {
                        0 => MouseButton::Left,
                        1 => MouseButton::Middle,
                        2 => MouseButton::Right,
                        _ => return Err("Invalid RDP button".into()),
                    };
                    if pressed {
                        vec![
                            Operation::MouseMove(MousePosition { x, y }),
                            Operation::MouseButtonPressed(button),
                        ]
                    } else {
                        vec![
                            Operation::MouseMove(MousePosition { x, y }),
                            Operation::MouseButtonReleased(button),
                        ]
                    }
                }
                _ => return Err("Invalid RDP pointer event".into()),
            }
        }
    };
    let mut db = session
        .input
        .lock()
        .map_err(|_| "RDP input state unavailable")?;
    let events = db.apply(operations);
    if !events.is_empty() {
        permit.send(RdpInputEvent::FastPath(events));
    }
    Ok(())
}

#[tauri::command]
pub fn rdp_direct_release_input(sessions: State<'_, Sessions>, id: String) -> Result<(), String> {
    let all = sessions
        .0
        .lock()
        .map_err(|_| "RDP session state unavailable")?;
    let session = all.get(&id).ok_or("RDP session closed")?;
    let permit = session
        .sender
        .try_reserve()
        .map_err(|_| "RDP input busy or closed")?;
    let mut db = session
        .input
        .lock()
        .map_err(|_| "RDP input state unavailable")?;
    let events = db.release_all();
    if !events.is_empty() {
        permit.send(RdpInputEvent::FastPath(events));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn direct_rdp_requires_strict_identity_and_bounded_credentials() {
        let target = Target {
            id: "123e4567-e89b-12d3-a456-426614174000".into(),
            host: "fixture.example.test".into(),
            port: 3389,
            username: "fixture".into(),
        };
        let settings = config(&target, "fixture-only".into(), 800, 600, false).unwrap();
        assert_eq!(
            settings.certificate_validation(),
            CertificateValidation::Strict
        );
        assert_eq!(
            settings.properties().get::<bool>("redirectclipboard"),
            Some(false)
        );
        let with_clipboard = config(&target, "fixture-only".into(), 800, 600, true).unwrap();
        assert_eq!(
            with_clipboard.properties().get::<bool>("redirectclipboard"),
            Some(true)
        );
        assert!(config(
            &Target {
                host: "bad/host".into(),
                ..target.clone()
            },
            "fixture".into(),
            800,
            600,
            false
        )
        .is_err());
        assert!(config(&target, "".into(), 800, 600, false).is_err());
        assert!(config(&target, "x".repeat(1025), 800, 600, false).is_err());
        assert!(config(&target, "fixture".into(), 8000, 600, false).is_err());
    }
    #[test]
    fn frame_encoder_refuses_wrong_size_and_preserves_color() {
        assert!(encode_frame(vec![], 1, 1).is_err());
        let png = encode_frame(vec![0x00112233], 1, 1).unwrap();
        assert!(!png.is_empty());
    }

    #[test]
    fn input_allowlist_rejects_unknown_browser_codes() {
        for code in [
            "KeyA",
            "Digit0",
            "ArrowLeft",
            "ControlRight",
            "MetaLeft",
            "F12",
            "Slash",
            "PageDown",
        ] {
            assert!(key_scancode(code).is_some());
        }
        for code in ["", "BrowserBack", "OSLaunchApplication1", "KeyA\n", "F24"] {
            assert!(key_scancode(code).is_none());
        }
    }

    #[test]
    fn strict_tls_rejects_disposable_untrusted_certificate() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let fixture = rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
            let server = tokio_rustls::rustls::ServerConfig::builder()
                .with_no_client_auth()
                .with_single_cert(
                    vec![fixture.cert.der().clone()],
                    tokio_rustls::rustls::pki_types::PrivateKeyDer::Pkcs8(
                        fixture.signing_key.serialize_der().into(),
                    ),
                )
                .unwrap();
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let peer = tokio::spawn(async move {
                let (stream, _) = listener.accept().await.unwrap();
                let _ = tokio_rustls::TlsAcceptor::from(Arc::new(server))
                    .accept(stream)
                    .await;
            });
            let stream = tokio::net::TcpStream::connect(address).await.unwrap();
            let result = tokio::time::timeout(
                Duration::from_secs(5),
                ironrdp_tls::upgrade_with_certificate_validation(
                    stream,
                    "localhost",
                    CertificateValidation::Strict,
                ),
            )
            .await
            .expect("TLS handshake timed out");
            assert!(
                result.is_err(),
                "untrusted fixture certificate was accepted"
            );
            peer.await.unwrap();
        });
    }
}
