//! Disposable CLIPRDR roundtrip over a pinned hybrid/CredSSP connection.
use super::*;
use ironrdp::cliprdr::backend::{ClipboardMessage, CliprdrBackend, CliprdrBackendFactory};
use ironrdp::cliprdr::pdu::{
    ClipboardFormat, ClipboardFormatId, ClipboardGeneralCapabilityFlags, FileContentsRequest,
    FileContentsResponse, FormatDataRequest, FormatDataResponse, LockDataId,
};
use ironrdp::core::{impl_as_any, IntoOwned};
use ironrdp::server::{
    CliprdrServerFactory, Credentials, DesktopSize, DisplayContext, DisplayUpdate, RdpServer,
    RdpServerDisplay, RdpServerDisplayUpdates, ServerEvent, ServerEventSender, ServerResult,
    TlsIdentityCtx,
};
use tokio::sync::mpsc::UnboundedSender;

const TEXT: &str = "NodeDesk disposable clipboard";

// The server's built-in no-display handler reports 0x0, which a real RDP
// client must reject during capability negotiation. Give this fixture a valid
// fixed framebuffer while still producing no image updates.
struct FixtureDisplay;
struct FixtureDisplayUpdates;

#[async_trait::async_trait]
impl RdpServerDisplay for FixtureDisplay {
    async fn size(&mut self) -> DesktopSize {
        DesktopSize {
            width: 800,
            height: 600,
        }
    }

    async fn updates(
        &mut self,
        _: DisplayContext,
    ) -> ServerResult<Box<dyn RdpServerDisplayUpdates>> {
        Ok(Box::new(FixtureDisplayUpdates))
    }
}

#[async_trait::async_trait]
impl RdpServerDisplayUpdates for FixtureDisplayUpdates {
    async fn next_update(&mut self) -> ServerResult<Option<DisplayUpdate>> {
        std::future::pending().await
    }
}

#[derive(Default)]
struct Observed {
    server_received: bool,
    client_received: bool,
}

#[derive(Clone)]
enum Sender {
    Client(RdpInputSender),
    Server(Arc<Mutex<Option<UnboundedSender<ServerEvent>>>>),
}
impl Sender {
    fn send(&self, message: ClipboardMessage) {
        match self {
            Self::Client(sender) => {
                sender
                    .send_clipboard(message)
                    .expect("fixture client clipboard closed");
            }
            Self::Server(sender) => {
                sender
                    .lock()
                    .unwrap()
                    .as_ref()
                    .unwrap()
                    .send(ServerEvent::Clipboard(message))
                    .unwrap();
            }
        }
    }
}

struct Backend {
    sender: Sender,
    observed: Arc<Mutex<Observed>>,
}
impl std::fmt::Debug for Backend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DisposableClipboardBackend")
    }
}
impl_as_any!(Backend);

fn encoded_text() -> Vec<u8> {
    TEXT.encode_utf16()
        .chain(std::iter::once(0))
        .flat_map(u16::to_le_bytes)
        .collect()
}
fn received_text(response: FormatDataResponse<'_>) -> bool {
    if response.is_error() || response.data().len() % 2 != 0 {
        return false;
    }
    let units: Vec<u16> = response
        .data()
        .chunks_exact(2)
        .map(|bytes| u16::from_le_bytes([bytes[0], bytes[1]]))
        .collect();
    String::from_utf16(&units)
        .ok()
        .is_some_and(|text| text.trim_end_matches('\0') == TEXT)
}

impl CliprdrBackend for Backend {
    fn temporary_directory(&self) -> &str {
        ".cliprdr-fixture"
    }
    fn client_capabilities(&self) -> ClipboardGeneralCapabilityFlags {
        ClipboardGeneralCapabilityFlags::empty()
    }
    fn on_ready(&mut self) {}
    fn on_request_format_list(&mut self) {
        if matches!(&self.sender, Sender::Client(_)) {
            self.sender.send(ClipboardMessage::SendInitiateCopy(vec![
                ClipboardFormat::new(ClipboardFormatId::CF_UNICODETEXT),
            ]));
        }
    }
    fn on_process_negotiated_capabilities(&mut self, _: ClipboardGeneralCapabilityFlags) {}
    fn on_remote_copy(&mut self, formats: &[ClipboardFormat]) {
        if formats
            .iter()
            .any(|format| format.id() == ClipboardFormatId::CF_UNICODETEXT)
        {
            self.sender.send(ClipboardMessage::SendInitiatePaste(
                ClipboardFormatId::CF_UNICODETEXT,
            ));
        }
    }
    fn on_format_data_request(&mut self, request: FormatDataRequest) {
        if request.format == ClipboardFormatId::CF_UNICODETEXT {
            self.sender.send(ClipboardMessage::SendFormatData(
                FormatDataResponse::new_data(encoded_text()).into_owned(),
            ));
        }
    }
    fn on_format_data_response(&mut self, response: FormatDataResponse<'_>) {
        let valid = received_text(response);
        let mut observed = self.observed.lock().unwrap();
        match &self.sender {
            Sender::Server(_) => {
                observed.server_received = valid;
                drop(observed);
                if valid {
                    self.sender.send(ClipboardMessage::SendInitiateCopy(vec![
                        ClipboardFormat::new(ClipboardFormatId::CF_UNICODETEXT),
                    ]));
                }
            }
            Sender::Client(_) => observed.client_received = valid,
        }
    }
    fn on_file_contents_request(&mut self, _: FileContentsRequest) {}
    fn on_file_contents_response(&mut self, _: FileContentsResponse<'_>) {}
    fn on_lock(&mut self, _: LockDataId) {}
    fn on_unlock(&mut self, _: LockDataId) {}
}

struct ClientFactory {
    sender: RdpInputSender,
    observed: Arc<Mutex<Observed>>,
}
impl CliprdrBackendFactory for ClientFactory {
    fn build_cliprdr_backend(&self) -> Box<dyn CliprdrBackend> {
        Box::new(Backend {
            sender: Sender::Client(self.sender.clone()),
            observed: self.observed.clone(),
        })
    }
}

struct ServerFactory {
    sender: Arc<Mutex<Option<UnboundedSender<ServerEvent>>>>,
    observed: Arc<Mutex<Observed>>,
}
impl CliprdrBackendFactory for ServerFactory {
    fn build_cliprdr_backend(&self) -> Box<dyn CliprdrBackend> {
        Box::new(Backend {
            sender: Sender::Server(self.sender.clone()),
            observed: self.observed.clone(),
        })
    }
}
impl ServerEventSender for ServerFactory {
    fn set_sender(&mut self, sender: UnboundedSender<ServerEvent>) {
        *self.sender.lock().unwrap() = Some(sender);
    }
}
impl CliprdrServerFactory for ServerFactory {}

#[test]
fn disposable_hybrid_clipboard_text_roundtrip() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let local = tokio::task::LocalSet::new();
    runtime.block_on(local.run_until(async {
        let fixture = rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
        let directory = tempfile::tempdir().unwrap();
        let certificate = directory.path().join("fixture.crt");
        let key = directory.path().join("fixture.key");
        std::fs::write(&certificate, fixture.cert.pem()).unwrap();
        std::fs::write(&key, fixture.signing_key.serialize_pem()).unwrap();
        let pin = hex::encode(Sha256::digest(fixture.cert.der().as_ref()));
        let identity = TlsIdentityCtx::init_from_paths(&certificate, &key).unwrap();
        let acceptor = identity.make_acceptor().unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let observed = Arc::new(Mutex::new(Observed::default()));
        let mut server = RdpServer::builder()
            .with_addr(address)
            .with_hybrid(acceptor, identity.pub_key)
            .with_no_input()
            .with_display_handler(FixtureDisplay)
            .with_cliprdr_factory(Some(Box::new(ServerFactory {
                sender: Arc::new(Mutex::new(None)), observed: observed.clone(),
            })))
            .build();
        server.set_credentials(Some(Credentials {
            username: "fixture".into(), password: "fixture-only".into(), domain: None,
        }));
        let server_task = tokio::task::spawn_local(async move { server.run().await });
        tokio::time::sleep(Duration::from_millis(100)).await;
        let target = Target {
            id: "123e4567-e89b-12d3-a456-426614174002".into(),
            host: "localhost".into(), port: address.port(), username: "fixture".into(),
        };
        let settings = config_pinned(&target, "fixture-only".into(), 800, 600, true, Some(pin)).unwrap();
        let (output, mut events) = output_channel(16);
        let client = RdpClient::new(settings, output);
        let sender = client.input_sender();
        let client = client.with_cliprdr_backend_factory(Box::new(ClientFactory {
            sender: sender.clone(), observed: observed.clone(),
        }));
        let client_task = tokio::task::spawn_local(client.run());
        let result = tokio::time::timeout(Duration::from_secs(20), async {
            loop {
                let state = observed.lock().unwrap();
                if state.server_received && state.client_received { return Ok(()); }
                drop(state);
                tokio::select! {
                    event = events.recv() => match event {
                        Some(RdpOutputEvent::ConnectionFailure(error)) => return Err(format!("connect: {error:?}")),
                        Some(RdpOutputEvent::Terminated(result)) => return Err(format!("terminated: {result:?}")),
                        _ => {},
                    },
                    _ = tokio::time::sleep(Duration::from_millis(20)) => {},
                }
            }
        }).await.expect("disposable CLIPRDR roundtrip timed out");
        sender.request_close();
        client_task.abort();
        server_task.abort();
        assert!(result.is_ok(), "disposable CLIPRDR roundtrip failed: {result:?}");
    }));
}

#[test]
fn disposable_hybrid_reconnects_after_transport_loss() {
    use ironrdp::server::ServerAutoReconnect;

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let local = tokio::task::LocalSet::new();
    runtime.block_on(local.run_until(async {
        let fixture = rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
        let directory = tempfile::tempdir().unwrap();
        let certificate = directory.path().join("fixture.crt");
        let key = directory.path().join("fixture.key");
        std::fs::write(&certificate, fixture.cert.pem()).unwrap();
        std::fs::write(&key, fixture.signing_key.serialize_pem()).unwrap();
        let pin = hex::encode(Sha256::digest(fixture.cert.der().as_ref()));
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);

        let make_server = || {
            let identity = TlsIdentityCtx::init_from_paths(&certificate, &key).unwrap();
            let acceptor = identity.make_acceptor().unwrap();
            let mut server = RdpServer::builder()
                .with_addr(address)
                .with_hybrid(acceptor, identity.pub_key)
                .with_no_input()
                .with_display_handler(FixtureDisplay)
                .with_auto_reconnect_cookie(Some(ServerAutoReconnect {
                    logon_id: 7,
                    random_bits: [0x5a; 16],
                }))
                .build();
            server.set_credentials(Some(Credentials {
                username: "fixture".into(),
                password: "fixture-only".into(),
                domain: None,
            }));
            server
        };
        let mut server = make_server();
        let first = tokio::task::spawn_local(async move { server.run().await });
        tokio::time::sleep(Duration::from_millis(100)).await;
        let target = Target {
            id: "123e4567-e89b-12d3-a456-426614174003".into(),
            host: "localhost".into(),
            port: address.port(),
            username: "fixture".into(),
        };
        let settings =
            config_pinned(&target, "fixture-only".into(), 800, 600, false, Some(pin)).unwrap();
        let (output, mut events) = output_channel(16);
        let client = RdpClient::new(settings, output).with_auto_reconnect(3);
        let sender = client.input_sender();
        let client_task = tokio::task::spawn_local(client.run());
        tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                match events.recv().await {
                    Some(RdpOutputEvent::Connected) => break,
                    Some(RdpOutputEvent::ConnectionFailure(error)) => {
                        panic!("initial connection: {error:?}")
                    }
                    Some(RdpOutputEvent::Terminated(result)) => {
                        panic!("initial termination: {result:?}")
                    }
                    None => panic!("initial RDP event stream closed"),
                    _ => {}
                }
            }
        })
        .await
        .expect("initial disposable RDP connection timed out");

        // Give Save Session Info time to deliver the reconnect cookie before
        // dropping only the disposable server's transport.
        tokio::time::sleep(Duration::from_millis(300)).await;
        first.abort();
        let _ = first.await;
        let mut server = make_server();
        let second = tokio::task::spawn_local(async move { server.run().await });
        let reconnect = tokio::time::timeout(Duration::from_secs(25), async {
            let mut reconnecting = false;
            loop {
                match events.recv().await {
                    Some(RdpOutputEvent::AutoReconnecting { response, .. }) => {
                        reconnecting = true;
                        let _ = response.send(AutoReconnectDecision::Continue);
                    }
                    Some(RdpOutputEvent::AutoReconnected) => return reconnecting,
                    Some(RdpOutputEvent::ConnectionFailure(error)) => {
                        panic!("reconnect failed: {error:?}")
                    }
                    Some(RdpOutputEvent::Terminated(result)) => {
                        panic!("reconnect terminated: {result:?}")
                    }
                    None => panic!("reconnect event stream closed"),
                    _ => {}
                }
            }
        })
        .await
        .expect("disposable RDP reconnect timed out");
        sender.request_close();
        client_task.abort();
        second.abort();
        assert!(reconnect, "reconnect occurred without a reconnecting phase");
    }));
}
