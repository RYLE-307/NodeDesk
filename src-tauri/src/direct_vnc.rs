//! Direct RFB client. Only VeNCrypt X509 password subtypes are permitted.
//! The pinned SPKI is checked by rustls before vnc-core authenticates.
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::Cursor,
    sync::{Arc, Mutex},
};
use tauri::{ipc::Channel, State};
use vnc_core::{
    session::{Session, SessionHandle},
    types::{
        ClientCommand, ConnectOptions, Credentials, QualityPreset, Rect, RectPayload, SessionEvent,
        SessionState,
    },
};

const MAX_WIDTH: u16 = 4096;
const MAX_HEIGHT: u16 = 2160;

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
    Resize {
        width: u16,
        height: u16,
    },
    Frame {
        x: u16,
        y: u16,
        width: u16,
        height: u16,
        png: String,
    },
    Clipboard {
        text: String,
    },
    Error {
        message: &'static str,
    },
}

struct Active {
    handle: Arc<SessionHandle>,
    clipboard: bool,
}

#[derive(Default)]
pub struct Sessions(Arc<Mutex<HashMap<String, Active>>>);
impl Sessions {
    pub fn shutdown(&self) {
        if let Ok(mut sessions) = self.0.lock() {
            for session in sessions.values() {
                session.handle.shutdown();
            }
            sessions.clear();
        }
    }
}

fn options(
    target: &Target,
    password: String,
    spki_sha256: String,
) -> Result<ConnectOptions, String> {
    if target.id.len() != 36
        || !target.id.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
        || crate::vnc::endpoint(&target.host, target.port).is_err()
        || target.username.len() > 200
        || target.username.chars().any(char::is_control)
        || password.is_empty()
        || password.len() > 1024
        || password.contains('\0')
        || spki_sha256.len() != 64
        || !spki_sha256.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("Invalid direct VNC target, credential or TLS SPKI pin".into());
    }
    if std::env::var_os("SSLKEYLOGFILE").is_some() {
        return Err("Disable TLS key logging before direct VNC".into());
    }
    let mut result = ConnectOptions::vnc(target.host.clone(), target.port);
    result.credentials = Credentials::user_pass(target.username.clone(), password);
    result.cert_pins.tls = Some(spki_sha256.to_ascii_uppercase());
    result.vnc_mut().security_pref = Some("vencrypt".into());
    result.vnc_mut().allow_insecure = false;
    result.quality = QualityPreset::High; // no H.264 dependency in the WebView
    result.reconnect.max_attempts = Some(3);
    Ok(result)
}

struct Framebuffer {
    width: u16,
    height: u16,
    rgba: Vec<u8>,
}
impl Framebuffer {
    fn resize(&mut self, width: u16, height: u16) -> Result<(), String> {
        if width == 0 || height == 0 || width > MAX_WIDTH || height > MAX_HEIGHT {
            return Err("Unsupported VNC framebuffer dimensions".into());
        }
        self.width = width;
        self.height = height;
        self.rgba = vec![0; width as usize * height as usize * 4];
        Ok(())
    }
    fn apply(&mut self, rect: Rect, payload: RectPayload) -> Result<String, String> {
        let end_x = rect
            .x
            .checked_add(rect.width)
            .ok_or("Invalid VNC rectangle")?;
        let end_y = rect
            .y
            .checked_add(rect.height)
            .ok_or("Invalid VNC rectangle")?;
        if rect.width == 0 || rect.height == 0 || end_x > self.width || end_y > self.height {
            return Err("Invalid VNC rectangle".into());
        }
        let expected = rect.width as usize * rect.height as usize * 4;
        let rgba = match payload {
            RectPayload::Rgba(data) if data.len() == expected => data,
            RectPayload::Jpeg(data) if data.len() <= 16 * 1024 * 1024 => {
                let mut reader =
                    image::ImageReader::with_format(Cursor::new(&data), image::ImageFormat::Jpeg);
                let mut limits = image::Limits::default();
                limits.max_image_width = Some(rect.width as u32);
                limits.max_image_height = Some(rect.height as u32);
                limits.max_alloc = Some(expected as u64 * 4);
                reader.limits(limits);
                let decoded = reader.decode().map_err(|_| "Invalid VNC JPEG rectangle")?;
                if decoded.width() != rect.width as u32 || decoded.height() != rect.height as u32 {
                    return Err("VNC JPEG dimensions mismatch".into());
                }
                decoded.to_rgba8().into_raw()
            }
            RectPayload::CopyRect { src_x, src_y } => {
                if src_x.checked_add(rect.width).is_none_or(|v| v > self.width)
                    || src_y
                        .checked_add(rect.height)
                        .is_none_or(|v| v > self.height)
                {
                    return Err("Invalid VNC copy source".into());
                }
                let mut data = Vec::with_capacity(expected);
                for row in 0..rect.height {
                    let start = ((src_y + row) as usize * self.width as usize + src_x as usize) * 4;
                    data.extend_from_slice(&self.rgba[start..start + rect.width as usize * 4]);
                }
                data
            }
            _ => return Err("Unsupported or invalid VNC rectangle".into()),
        };
        for row in 0..rect.height as usize {
            let source = row * rect.width as usize * 4;
            let destination = ((rect.y as usize + row) * self.width as usize + rect.x as usize) * 4;
            self.rgba[destination..destination + rect.width as usize * 4]
                .copy_from_slice(&rgba[source..source + rect.width as usize * 4]);
        }
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, rect.width as u32, rect.height as u32);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .write_header()
                .and_then(|mut writer| writer.write_image_data(&rgba))
                .map_err(|_| "Cannot encode VNC rectangle")?;
        }
        if bytes.len() > 16 * 1024 * 1024 {
            return Err("VNC rectangle too large".into());
        }
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    }
}

#[tauri::command]
pub async fn vnc_direct_connect_saved(
    sessions: State<'_, Sessions>,
    vault: State<'_, crate::vault::Vault>,
    target: Target,
    spki_sha256: String,
    clipboard: bool,
    events: Channel<Event>,
) -> Result<(), String> {
    // The vault binds its record to this entire public identity. The secret
    // stays in the native process and is never returned to WebView.
    let store = vault.inner().clone();
    let identity = target.clone();
    let secret = tauri::async_runtime::spawn_blocking(move || {
        store.read_connection(
            identity.id,
            "VNC",
            identity.host,
            identity.port,
            identity.username,
        )
    })
    .await
    .map_err(|_| "Vault worker failed".to_string())??
    .ok_or("Saved VNC credential not found")?;
    vnc_direct_connect(
        sessions,
        target,
        secret.to_string(),
        spki_sha256,
        clipboard,
        events,
    )
    .await
}

#[tauri::command]
pub async fn vnc_direct_connect(
    sessions: State<'_, Sessions>,
    target: Target,
    password: String,
    spki_sha256: String,
    clipboard: bool,
    events: Channel<Event>,
) -> Result<(), String> {
    let config = options(&target, password, spki_sha256)?;
    let (tx, mut rx) = tokio::sync::mpsc::channel(16);
    let handle = {
        let mut active = sessions
            .0
            .lock()
            .map_err(|_| "VNC session state unavailable")?;
        if active.contains_key(&target.id) {
            return Err("VNC connection already active".into());
        }
        let handle = Arc::new(Session::spawn(target.id.clone(), config, tx));
        active.insert(
            target.id.clone(),
            Active {
                handle: Arc::clone(&handle),
                clipboard,
            },
        );
        handle
    };
    let registry = Arc::clone(&sessions.0);
    let id = target.id;
    tauri::async_runtime::spawn(async move {
        let mut frame = Framebuffer {
            width: 0,
            height: 0,
            rgba: Vec::new(),
        };
        while let Some(event) = rx.recv().await {
            let result = match event {
                SessionEvent::StateChanged(SessionState::Connected) => {
                    events.send(Event::Status { phase: "connected" })
                }
                SessionEvent::StateChanged(SessionState::Reconnecting { .. }) => {
                    events.send(Event::Status {
                        phase: "reconnecting",
                    })
                }
                SessionEvent::StateChanged(SessionState::Disconnected { .. }) => {
                    let _ = events.send(Event::Status { phase: "closed" });
                    break;
                }
                SessionEvent::DesktopResize { width, height } => {
                    match frame.resize(width, height) {
                        Ok(()) => events.send(Event::Resize { width, height }),
                        Err(_) => {
                            let _ = events.send(Event::Error {
                                message: "Invalid VNC framebuffer",
                            });
                            break;
                        }
                    }
                }
                SessionEvent::FramebufferUpdate { rects, .. } => {
                    let mut failed = false;
                    for tile in rects {
                        let rect = tile.rect;
                        match frame.apply(rect, tile.payload) {
                            Ok(png) => {
                                if events
                                    .send(Event::Frame {
                                        x: rect.x,
                                        y: rect.y,
                                        width: rect.width,
                                        height: rect.height,
                                        png,
                                    })
                                    .is_err()
                                {
                                    failed = true;
                                }
                            }
                            Err(_) => {
                                let _ = events.send(Event::Error {
                                    message: "Invalid VNC frame",
                                });
                                failed = true;
                            }
                        }
                        if failed {
                            break;
                        }
                    }
                    if failed {
                        break;
                    }
                    continue;
                }
                SessionEvent::ClipboardText(text) if clipboard && text.len() <= 65536 => {
                    events.send(Event::Clipboard { text })
                }
                SessionEvent::CertificatePrompt { .. } => {
                    let _ = events.send(Event::Error {
                        message: "VNC certificate was not verified",
                    });
                    break;
                }
                SessionEvent::CredentialsRequired(_) | SessionEvent::Error(_) => {
                    let _ = events.send(Event::Error {
                        message: "VNC connection or authentication failed",
                    });
                    break;
                }
                _ => continue,
            };
            if result.is_err() {
                break;
            }
        }
        handle.shutdown();
        if let Ok(mut active) = registry.lock() {
            active.remove(&id);
        }
    });
    Ok(())
}

#[tauri::command]
pub fn vnc_direct_disconnect(sessions: State<'_, Sessions>, id: String) {
    if let Ok(mut active) = sessions.0.lock() {
        if let Some(session) = active.remove(&id) {
            session.handle.shutdown();
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Input {
    Pointer { x: u16, y: u16, button_mask: u16 },
    Key { keysym: u32, down: bool },
    Clipboard { text: String },
    Resize { width: u16, height: u16 },
    Refresh,
    ReleaseKeys,
}

#[tauri::command]
pub fn vnc_direct_input(
    sessions: State<'_, Sessions>,
    id: String,
    input: Input,
) -> Result<(), String> {
    let active = sessions
        .0
        .lock()
        .map_err(|_| "VNC session state unavailable")?;
    let session = active.get(&id).ok_or("VNC session closed")?;
    let command = match input {
        Input::Pointer { x, y, button_mask }
            if x < MAX_WIDTH && y < MAX_HEIGHT && button_mask <= 0xff =>
        {
            ClientCommand::Pointer { x, y, button_mask }
        }
        Input::Key { keysym, down } if keysym != 0 => ClientCommand::Key {
            keysym,
            keycode: None,
            down,
        },
        Input::Clipboard { text }
            if session.clipboard && text.len() <= 65536 && !text.contains('\0') =>
        {
            ClientCommand::ClipboardText(text)
        }
        Input::Resize { width, height }
            if width >= 320 && height >= 240 && width <= MAX_WIDTH && height <= MAX_HEIGHT =>
        {
            ClientCommand::RequestResize { width, height }
        }
        Input::Refresh => ClientCommand::Refresh,
        Input::ReleaseKeys => ClientCommand::ReleaseAllKeys,
        _ => return Err("Invalid or disabled VNC input".into()),
    };
    session
        .handle
        .try_send(command)
        .map_err(|_| "VNC input busy or closed".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use vnc_core::security::vencrypt::{select_subtype, VeNCryptSubtype as S};
    fn target() -> Target {
        Target {
            id: "123e4567-e89b-12d3-a456-426614174002".into(),
            host: "localhost".into(),
            port: 5900,
            username: "fixture".into(),
        }
    }
    #[test]
    fn password_auth_requires_pinned_x509_vencrypt() {
        let valid = options(&target(), "fixture-only".into(), "A".repeat(64)).unwrap();
        assert_eq!(
            valid.vnc_options().unwrap().security_pref.as_deref(),
            Some("vencrypt")
        );
        assert!(!valid.vnc_options().unwrap().allow_insecure);
        assert_eq!(
            valid.cert_pins.tls.as_deref(),
            Some("A".repeat(64).as_str())
        );
        assert!(options(&target(), "fixture-only".into(), String::new()).is_err());
        assert!(options(&target(), "fixture-only".into(), "Z".repeat(64)).is_err());
        assert!(options(&target(), "".into(), "A".repeat(64)).is_err());
        for offered in [
            vec![S::Plain],
            vec![S::TlsVnc],
            vec![S::X509None],
            vec![S::Plain, S::TlsNone],
        ] {
            assert!(select_subtype(&offered, &valid).is_err());
        }
        assert_eq!(
            select_subtype(&[S::Plain, S::X509Vnc], &valid).unwrap(),
            S::X509Vnc
        );
    }
    #[test]
    fn framebuffer_rejects_out_of_bounds_and_copies_overlap_safely() {
        let mut frame = Framebuffer {
            width: 0,
            height: 0,
            rgba: Vec::new(),
        };
        frame.resize(4, 2).unwrap();
        assert!(frame
            .apply(Rect::new(3, 0, 2, 1), RectPayload::Rgba(vec![0; 8]))
            .is_err());
        frame
            .apply(Rect::new(0, 0, 2, 1), RectPayload::Rgba(vec![1; 8]))
            .unwrap();
        frame
            .apply(
                Rect::new(1, 0, 2, 1),
                RectPayload::CopyRect { src_x: 0, src_y: 0 },
            )
            .unwrap();
        assert_eq!(&frame.rgba[0..12], &[1; 12]);
    }

    #[test]
    fn disposable_x509_server_checks_pin_before_password_and_delivers_frame() {
        use sha2::{Digest, Sha256};
        use std::time::Duration;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            for correct_pin in [false, true] {
                let certificate =
                    rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
                let spki = rdp_pdu::asn1::der::extract_spki(certificate.cert.der()).unwrap();
                let true_pin = hex::encode_upper(Sha256::digest(spki));
                let pin = if correct_pin {
                    true_pin
                } else {
                    "A".repeat(64)
                };
                let tls = tokio_rustls::rustls::ServerConfig::builder()
                    .with_no_client_auth()
                    .with_single_cert(
                        vec![certificate.cert.der().clone()],
                        tokio_rustls::rustls::pki_types::PrivateKeyDer::Pkcs8(
                            certificate.signing_key.serialize_der().into(),
                        ),
                    )
                    .unwrap();
                let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
                let port = listener.local_addr().unwrap().port();
                let server = tokio::spawn(async move {
                    let (mut stream, _) = listener.accept().await.unwrap();
                    stream.write_all(b"RFB 003.008\n").await.unwrap();
                    let mut banner = [0; 12];
                    stream.read_exact(&mut banner).await.unwrap();
                    assert_eq!(&banner, b"RFB 003.008\n");
                    stream.write_all(&[1, 19, 0, 2]).await.unwrap();
                    let mut selected = [0; 3];
                    stream.read_exact(&mut selected).await.unwrap();
                    assert_eq!(selected, [19, 0, 2]);
                    stream.write_all(&[0, 1, 0, 0, 1, 6]).await.unwrap();
                    let mut subtype = [0; 4];
                    stream.read_exact(&mut subtype).await.unwrap();
                    assert_eq!(u32::from_be_bytes(subtype), 262);
                    stream.write_all(&[1]).await.unwrap();
                    let accepted = tokio_rustls::TlsAcceptor::from(Arc::new(tls))
                        .accept(stream)
                        .await;
                    let Ok(mut secure) = accepted else {
                        return (false, false, false, false);
                    };
                    let mut lengths = [0; 8];
                    if secure.read_exact(&mut lengths).await.is_err() {
                        return (false, false, false, false);
                    }
                    let user_len = u32::from_be_bytes(lengths[0..4].try_into().unwrap()) as usize;
                    let pass_len = u32::from_be_bytes(lengths[4..8].try_into().unwrap()) as usize;
                    assert!(user_len <= 200 && pass_len <= 1024);
                    let mut credentials = vec![0; user_len + pass_len];
                    secure.read_exact(&mut credentials).await.unwrap();
                    assert_eq!(&credentials[..user_len], b"fixture");
                    assert_eq!(&credentials[user_len..], b"fixture-only");
                    credentials.fill(0);
                    secure.write_all(&0u32.to_be_bytes()).await.unwrap();
                    let mut init = [0];
                    secure.read_exact(&mut init).await.unwrap();
                    let mut server_init = Vec::new();
                    server_init.extend_from_slice(&2u16.to_be_bytes());
                    server_init.extend_from_slice(&2u16.to_be_bytes());
                    server_init.extend_from_slice(&[
                        32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0, 0, 0, 0,
                    ]);
                    server_init.extend_from_slice(&7u32.to_be_bytes());
                    server_init.extend_from_slice(b"fixture");
                    secure.write_all(&server_init).await.unwrap();
                    // One 2x2 raw rectangle. The client has already selected a
                    // 32-bit true-colour pixel format in this fixture.
                    secure
                        .write_all(&[
                            0, 0, 0, 1, 0, 0, 0, 0, 0, 2, 0, 2, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0,
                            255, 0, 0, 0, 255, 0, 0, 0, 255, 0,
                        ])
                        .await
                        .unwrap();
                    let remote_text = b"remote fixture";
                    secure.write_all(&[3, 0, 0, 0]).await.unwrap();
                    secure
                        .write_all(&(remote_text.len() as u32).to_be_bytes())
                        .await
                        .unwrap();
                    secure.write_all(remote_text).await.unwrap();
                    let observed = tokio::time::timeout(Duration::from_secs(5), async {
                        let mut pointer = false;
                        let mut key = false;
                        let mut clipboard = false;
                        while !(pointer && key && clipboard) {
                            let kind = secure.read_u8().await.unwrap();
                            match kind {
                                0 => {
                                    let mut body = [0; 19];
                                    secure.read_exact(&mut body).await.unwrap();
                                }
                                2 => {
                                    let mut header = [0; 3];
                                    secure.read_exact(&mut header).await.unwrap();
                                    let count = u16::from_be_bytes([header[1], header[2]]) as usize;
                                    assert!(count <= 128);
                                    let mut body = vec![0; count * 4];
                                    secure.read_exact(&mut body).await.unwrap();
                                }
                                3 => {
                                    let mut body = [0; 9];
                                    secure.read_exact(&mut body).await.unwrap();
                                }
                                4 => {
                                    let mut body = [0; 7];
                                    secure.read_exact(&mut body).await.unwrap();
                                    key = body[0] == 1
                                        && u32::from_be_bytes(body[3..7].try_into().unwrap())
                                            == 0x61;
                                }
                                5 => {
                                    let mut body = [0; 5];
                                    secure.read_exact(&mut body).await.unwrap();
                                    pointer = body == [1, 0, 1, 0, 1];
                                }
                                6 => {
                                    let mut header = [0; 7];
                                    secure.read_exact(&mut header).await.unwrap();
                                    let len = u32::from_be_bytes(header[3..7].try_into().unwrap())
                                        as usize;
                                    assert!(len <= 65536);
                                    let mut body = vec![0; len];
                                    secure.read_exact(&mut body).await.unwrap();
                                    clipboard = body == b"local fixture";
                                }
                                other => panic!("unexpected disposable VNC client message {other}"),
                            }
                        }
                        (pointer, key, clipboard)
                    })
                    .await
                    .expect("disposable VNC input timed out");
                    (true, observed.0, observed.1, observed.2)
                });
                let mut target = target();
                target.port = port;
                let mut config = options(&target, "fixture-only".into(), pin).unwrap();
                config.reconnect.enabled = false;
                let (events, mut receiver) = tokio::sync::mpsc::channel(16);
                let handle = Session::spawn("fixture".into(), config, events);
                let outcome = tokio::time::timeout(Duration::from_secs(10), async {
                    let mut connected = false;
                    let mut frame = false;
                    let mut clipboard = false;
                    while let Some(event) = receiver.recv().await {
                        match event {
                            SessionEvent::StateChanged(SessionState::Connected) => connected = true,
                            SessionEvent::FramebufferUpdate { rects, .. } => {
                                frame = !rects.is_empty();
                            }
                            SessionEvent::ClipboardText(text) => {
                                clipboard = text == "remote fixture"
                            }
                            SessionEvent::StateChanged(SessionState::Disconnected { .. }) => break,
                            _ => {}
                        }
                        if connected && frame && clipboard {
                            handle
                                .try_send(ClientCommand::Pointer {
                                    x: 1,
                                    y: 1,
                                    button_mask: 1,
                                })
                                .unwrap();
                            handle
                                .try_send(ClientCommand::Key {
                                    keysym: 0x61,
                                    keycode: None,
                                    down: true,
                                })
                                .unwrap();
                            handle
                                .try_send(ClientCommand::ClipboardText("local fixture".into()))
                                .unwrap();
                            break;
                        }
                    }
                    (connected, frame, clipboard)
                })
                .await
                .unwrap();
                let observed = tokio::time::timeout(Duration::from_secs(10), server)
                    .await
                    .expect("disposable VNC server timed out")
                    .unwrap();
                handle.shutdown();
                assert_eq!(
                    observed,
                    if correct_pin {
                        (true, true, true, true)
                    } else {
                        (false, false, false, false)
                    }
                );
                assert_eq!(
                    outcome,
                    if correct_pin {
                        (true, true, true)
                    } else {
                        (false, false, false)
                    }
                );
            }
        });
    }

    #[test]
    fn disposable_x509_session_reconnects_after_server_disconnect() {
        use sha2::{Digest, Sha256};
        use std::time::Duration;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        async fn serve_one(
            mut stream: tokio::net::TcpStream,
            acceptor: &tokio_rustls::TlsAcceptor,
        ) -> tokio_rustls::server::TlsStream<tokio::net::TcpStream> {
            stream.write_all(b"RFB 003.008\n").await.unwrap();
            let mut banner = [0; 12];
            stream.read_exact(&mut banner).await.unwrap();
            assert_eq!(&banner, b"RFB 003.008\n");
            stream.write_all(&[1, 19, 0, 2]).await.unwrap();
            let mut selected = [0; 3];
            stream.read_exact(&mut selected).await.unwrap();
            assert_eq!(selected, [19, 0, 2]);
            stream.write_all(&[0, 1, 0, 0, 1, 6]).await.unwrap();
            let mut subtype = [0; 4];
            stream.read_exact(&mut subtype).await.unwrap();
            assert_eq!(u32::from_be_bytes(subtype), 262);
            stream.write_all(&[1]).await.unwrap();
            let mut secure = acceptor.accept(stream).await.unwrap();
            let mut lengths = [0; 8];
            secure.read_exact(&mut lengths).await.unwrap();
            let user_len = u32::from_be_bytes(lengths[0..4].try_into().unwrap()) as usize;
            let pass_len = u32::from_be_bytes(lengths[4..8].try_into().unwrap()) as usize;
            assert_eq!((user_len, pass_len), (7, 12));
            let mut credentials = vec![0; user_len + pass_len];
            secure.read_exact(&mut credentials).await.unwrap();
            assert_eq!(&credentials, b"fixturefixture-only");
            credentials.fill(0);
            secure.write_all(&0u32.to_be_bytes()).await.unwrap();
            let mut init = [0];
            secure.read_exact(&mut init).await.unwrap();
            let mut server_init = Vec::new();
            server_init.extend_from_slice(&2u16.to_be_bytes());
            server_init.extend_from_slice(&2u16.to_be_bytes());
            server_init
                .extend_from_slice(&[32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0, 0, 0, 0]);
            server_init.extend_from_slice(&7u32.to_be_bytes());
            server_init.extend_from_slice(b"fixture");
            secure.write_all(&server_init).await.unwrap();
            secure
        }

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let cert = rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
            let pin = hex::encode_upper(Sha256::digest(
                rdp_pdu::asn1::der::extract_spki(cert.cert.der()).unwrap(),
            ));
            let config = tokio_rustls::rustls::ServerConfig::builder()
                .with_no_client_auth()
                .with_single_cert(
                    vec![cert.cert.der().clone()],
                    tokio_rustls::rustls::pki_types::PrivateKeyDer::Pkcs8(
                        cert.signing_key.serialize_der().into(),
                    ),
                )
                .unwrap();
            let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            let first_close = Arc::new(tokio::sync::Notify::new());
            let second_close = Arc::new(tokio::sync::Notify::new());
            let server_first = Arc::clone(&first_close);
            let server_second = Arc::clone(&second_close);
            let server = tokio::spawn(async move {
                let (stream, _) = listener.accept().await.unwrap();
                let first = serve_one(stream, &acceptor).await;
                server_first.notified().await;
                drop(first);
                let (stream, _) = listener.accept().await.unwrap();
                let second = serve_one(stream, &acceptor).await;
                server_second.notified().await;
                drop(second);
            });
            let mut target = target();
            target.port = port;
            let mut options = options(&target, "fixture-only".into(), pin).unwrap();
            options.reconnect.max_attempts = Some(2);
            options.reconnect.initial_delay_ms = 10;
            options.reconnect.jitter = 0.0;
            let (events, mut receiver) = tokio::sync::mpsc::channel(16);
            let handle = Session::spawn("fixture-reconnect".into(), options, events);
            let (connected, reconnecting) = tokio::time::timeout(Duration::from_secs(10), async {
                let mut connected = 0;
                let mut reconnecting = false;
                while let Some(event) = receiver.recv().await {
                    match event {
                        SessionEvent::StateChanged(SessionState::Connected) => {
                            connected += 1;
                            if connected == 1 {
                                first_close.notify_one();
                            }
                            if connected == 2 {
                                second_close.notify_one();
                                break;
                            }
                        }
                        SessionEvent::StateChanged(SessionState::Reconnecting { .. }) => {
                            reconnecting = true
                        }
                        SessionEvent::StateChanged(SessionState::Disconnected { .. }) => break,
                        _ => {}
                    }
                }
                (connected, reconnecting)
            })
            .await
            .expect("disposable VNC reconnect timed out");
            handle.shutdown();
            tokio::time::timeout(Duration::from_secs(5), server)
                .await
                .expect("disposable VNC server did not stop")
                .unwrap();
            assert_eq!(connected, 2);
            assert!(reconnecting);
        });
    }
}
