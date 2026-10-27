//! Audio del sistema en Linux: monitor del dispositivo de salida de PulseAudio (o PipeWire, que
//! habla el mismo protocolo). Cliente en Rust puro: no enlaza `libpulse` ni `libasound`.
//!
//! Se pide al servidor un flujo de grabación ya en mono, `f32` a 16 kHz, así que la mezcla y el
//! remuestreo los hace él. Los datos solo pasan por memoria hacia el callback.

use std::ffi::CString;
use std::io::{BufReader, Read};
use std::net::Shutdown;
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::thread::{self, JoinHandle};

use pulseaudio::protocol::{self, Command};
use tr_core::ports::ChunkCallback;
use tr_core::types::SAMPLE_RATE;
use tr_core::{AudioCapture, CoreError, Result};

use super::chunker::{CHUNK_SAMPLES, Chunker};

fn capture_error(message: impl Into<String>) -> CoreError {
    CoreError::Capture(message.into())
}

/// Un fragmento por trozo de audio (`f32` = 4 bytes por muestra): latencia de ~100 ms.
const FRAGMENT_BYTES: u32 = (CHUNK_SAMPLES * 4) as u32;

/// Tamaño de la cookie de autenticación de PulseAudio.
const COOKIE_BYTES: usize = 256;

type Connection = (BufReader<UnixStream>, u16);

fn connect(socket: Option<PathBuf>) -> Result<Connection> {
    let path = socket
        .or_else(pulseaudio::socket_path_from_env)
        .ok_or_else(|| {
            capture_error("PulseAudio/PipeWire is not available (no sound server socket found)")
        })?;
    let stream = UnixStream::connect(&path)
        .map_err(|e| capture_error(format!("could not connect to the sound server: {e}")))?;
    let mut sock = BufReader::new(stream);

    // El protocolo exige una cookie de exactamente 256 bytes; sin archivo de cookie (servidores con
    // acceso anónimo, como WSLg) se envía una nula y el servidor decide.
    let mut cookie = pulseaudio::cookie_path_from_env()
        .and_then(|path| std::fs::read(path).ok())
        .unwrap_or_default();
    if cookie.len() != COOKIE_BYTES {
        cookie = vec![0; COOKIE_BYTES];
    }
    let auth = protocol::AuthParams {
        version: protocol::MAX_VERSION,
        supports_shm: false,
        supports_memfd: false,
        cookie,
    };
    let fail = |what: &str, e: protocol::ProtocolError| {
        capture_error(format!("sound server {what} failed: {e}"))
    };
    protocol::write_command_message(
        sock.get_mut(),
        0,
        &Command::Auth(auth),
        protocol::MAX_VERSION,
    )
    .map_err(|e| fail("authentication", e))?;
    let (_, reply) =
        protocol::read_reply_message::<protocol::AuthReply>(&mut sock, protocol::MAX_VERSION)
            .map_err(|e| fail("authentication", e))?;
    let version = protocol::MAX_VERSION.min(reply.version);

    let mut props = protocol::Props::new();
    props.set(
        protocol::Prop::ApplicationName,
        CString::new("translate").unwrap_or_default(),
    );
    protocol::write_command_message(sock.get_mut(), 1, &Command::SetClientName(props), version)
        .map_err(|e| fail("setup", e))?;
    protocol::read_reply_message::<protocol::SetClientNameReply>(&mut sock, version)
        .map_err(|e| fail("setup", e))?;
    Ok((sock, version))
}

/// Nombre del monitor del dispositivo de salida por defecto (`<salida>.monitor`).
fn default_monitor(sock: &mut BufReader<UnixStream>, version: u16) -> Result<CString> {
    let fail =
        |e: protocol::ProtocolError| capture_error(format!("sound server query failed: {e}"));
    protocol::write_command_message(sock.get_mut(), 2, &Command::GetServerInfo, version)
        .map_err(fail)?;
    let (_, info) =
        protocol::read_reply_message::<protocol::ServerInfo>(sock, version).map_err(fail)?;
    let sink = info
        .default_sink_name
        .ok_or_else(|| capture_error("the sound server has no default output device"))?;
    let mut name = sink.into_bytes();
    name.extend_from_slice(b".monitor");
    CString::new(name).map_err(|_| capture_error("invalid output device name"))
}

/// Abre el flujo de grabación del monitor y devuelve la conexión lista para leer datos.
fn open_stream(socket: Option<PathBuf>) -> Result<Connection> {
    let (mut sock, version) = connect(socket)?;
    let monitor = default_monitor(&mut sock, version)?;
    let fail =
        |e: protocol::ProtocolError| capture_error(format!("sound server stream failed: {e}"));

    protocol::write_command_message(
        sock.get_mut(),
        3,
        &Command::CreateRecordStream(protocol::RecordStreamParams {
            sample_spec: protocol::SampleSpec {
                format: protocol::SampleFormat::Float32Le,
                channels: 1,
                sample_rate: SAMPLE_RATE,
            },
            channel_map: protocol::ChannelMap::mono(),
            source_name: Some(monitor),
            buffer_attr: protocol::stream::BufferAttr {
                fragment_size: FRAGMENT_BYTES,
                ..Default::default()
            },
            flags: protocol::stream::StreamFlags {
                adjust_latency: true,
                ..Default::default()
            },
            cvolume: Some(protocol::ChannelVolume::norm(1)),
            ..Default::default()
        }),
        version,
    )
    .map_err(fail)?;
    protocol::read_reply_message::<protocol::CreateRecordStreamReply>(&mut sock, version)
        .map_err(|e| capture_error(format!("could not open the output monitor: {e}")))?;
    Ok((sock, version))
}

fn read_loop(mut sock: BufReader<UnixStream>, version: u16, mut chunker: Chunker) {
    let mut bytes: Vec<u8> = Vec::new();
    let mut carry: Vec<u8> = Vec::new();
    loop {
        let Ok(descriptor) = protocol::read_descriptor(&mut sock) else {
            return;
        };
        // El canal -1 son mensajes de control (eventos del servidor): se leen y se ignoran.
        if descriptor.channel == u32::MAX {
            if Command::read_tag_prefixed(&mut sock, version).is_err() {
                return;
            }
            continue;
        }
        bytes.resize(descriptor.length as usize, 0);
        if sock.read_exact(&mut bytes).is_err() {
            return;
        }
        carry.extend_from_slice(&bytes);
        let usable = carry.len() / 4 * 4;
        let samples: Vec<f32> = carry[..usable]
            .as_chunks::<4>()
            .0
            .iter()
            .map(|b| f32::from_le_bytes(*b))
            .collect();
        carry.drain(..usable);
        chunker.push(&samples);
    }
}

struct Worker {
    /// Copia del socket para interrumpir la lectura bloqueada al detener.
    socket: UnixStream,
    handle: JoinHandle<()>,
}

/// Captura del monitor del dispositivo de salida por defecto.
#[derive(Default)]
pub struct PulseLoopback {
    /// Socket del servidor; `None` lo toma del entorno (`PULSE_SERVER`, `XDG_RUNTIME_DIR`).
    socket: Option<PathBuf>,
    worker: Option<Worker>,
}

impl PulseLoopback {
    pub fn new() -> Self {
        Self::default()
    }

    /// Con el socket de un servidor concreto (pruebas, o un servidor no estándar).
    pub fn with_socket(socket: impl Into<PathBuf>) -> Self {
        Self {
            socket: Some(socket.into()),
            worker: None,
        }
    }
}

impl AudioCapture for PulseLoopback {
    fn start(&mut self, on_chunk: ChunkCallback) -> Result<()> {
        if self.worker.is_some() {
            return Err(capture_error("audio capture is already running"));
        }
        // La conexión se abre aquí para que un servidor ausente se informe al arrancar.
        let (sock, version) = open_stream(self.socket.clone())?;
        let socket = sock
            .get_ref()
            .try_clone()
            .map_err(|e| capture_error(format!("could not share the sound connection: {e}")))?;
        let handle = thread::spawn(move || read_loop(sock, version, Chunker::new(on_chunk)));
        self.worker = Some(Worker { socket, handle });
        Ok(())
    }

    fn stop(&mut self) {
        if let Some(worker) = self.worker.take() {
            // Cerrar el socket desbloquea la lectura; al terminar el hilo suelta sus búferes.
            let _ = worker.socket.shutdown(Shutdown::Both);
            let _ = worker.handle.join();
        }
    }
}

impl Drop for PulseLoopback {
    fn drop(&mut self) {
        self.stop();
    }
}
