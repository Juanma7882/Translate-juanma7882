//! Captura de audio por aplicación en Windows (WASAPI *process loopback*, Windows 10 2004 o posterior).
//!
//! - [`WindowsAudio`] implementa [`AudioCapture`]: `start` / `start_source(System)` delegan en
//!   [`CpalLoopback`] (todo el sistema) y `start_source(Process { id, .. })` captura solo el audio de
//!   ese proceso **y su árbol de procesos** (`INCLUDE_TARGET_PROCESS_TREE`), pensado para navegadores y
//!   Discord, cuyo audio sale de procesos hijos.
//! - [`WindowsSourceLister`] implementa [`AudioSourceLister`]: sesiones de audio activas del
//!   dispositivo de salida por defecto, agrupadas por nombre de programa.
//!
//! Sin `unsafe` propio: las llamadas COM las hace la caja `wasapi` (ver docs/adr/0008-audio-por-aplicacion.md).
//! El audio solo pasa por memoria hacia el callback.
//!
//! # Fin de la aplicación
//! Si el proceso objetivo termina durante la captura (o el flujo falla), el hilo de captura se detiene
//! solo, marca [`WindowsAudio::ended`] y llama al aviso registrado con
//! [`WindowsAudio::set_on_ended`] (desde el hilo de captura; no debe bloquear). Después `stop` sigue
//! siendo seguro y el motor puede volver a llamar a `start_source`.

use std::collections::{BTreeMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, mpsc};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use tr_core::ports::ChunkCallback;
use tr_core::{AppAudio, AudioCapture, AudioSource, AudioSourceLister, CoreError, Result};
use wasapi::{
    AudioClient, DeviceEnumerator, Direction, SampleType, SessionState, StreamMode, WaveFormat,
    initialize_mta,
};

use super::chunker::Chunker;
use super::cpal_loopback::CpalLoopback;
use super::resample::{Resampler, to_mono};

/// Espera máxima a que el hilo de captura active el cliente de audio.
const START_TIMEOUT: Duration = Duration::from_secs(10);
/// Cada cuánto despierta el hilo de captura para mirar la parada y si el proceso sigue vivo.
const WAKE_MS: u32 = 100;
const LIVENESS_EVERY: Duration = Duration::from_millis(1000);
const RATE: usize = 48_000;
const CHANNELS: usize = 2;
const BYTES_PER_FRAME: usize = CHANNELS * 4;

/// Aviso de que la aplicación capturada terminó. Se llama desde el hilo de captura.
pub type EndedCallback = Arc<dyn Fn() + Send + Sync>;

fn capture_error(message: impl Into<String>) -> CoreError {
    CoreError::Capture(message.into())
}

fn process_exists(system: &mut System, pid: u32) -> bool {
    let pid = Pid::from_u32(pid);
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[pid]),
        true,
        ProcessRefreshKind::nothing(),
    );
    system.process(pid).is_some()
}

struct Worker {
    stop: Arc<AtomicBool>,
    handle: JoinHandle<()>,
}

/// Captura de audio de Windows: todo el sistema o una aplicación.
#[derive(Default)]
pub struct WindowsAudio {
    system: CpalLoopback,
    process: Option<Worker>,
    on_ended: Option<EndedCallback>,
    ended: Arc<AtomicBool>,
}

impl WindowsAudio {
    pub fn new() -> Self {
        Self::default()
    }

    /// Registra el aviso de "la aplicación terminó" (ver la documentación del módulo).
    pub fn set_on_ended(&mut self, callback: EndedCallback) {
        self.on_ended = Some(callback);
    }

    /// `true` si la última captura por aplicación se detuvo porque el proceso terminó o el flujo falló.
    /// Se reinicia al llamar a `start_source`.
    pub fn ended(&self) -> bool {
        self.ended.load(Ordering::SeqCst)
    }

    fn start_process(&mut self, pid: u32, on_chunk: ChunkCallback) -> Result<()> {
        if pid == 0 || !process_exists(&mut System::new(), pid) {
            return Err(capture_error(format!(
                "the application (process {pid}) is not running"
            )));
        }
        self.ended.store(false, Ordering::SeqCst);
        let stop = Arc::new(AtomicBool::new(false));
        let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<()>>(1);
        let handle = {
            let (stop, ended, on_ended) = (stop.clone(), self.ended.clone(), self.on_ended.clone());
            thread::spawn(move || run(pid, on_chunk, &stop, &ended, on_ended, ready_tx))
        };
        match ready_rx.recv_timeout(START_TIMEOUT) {
            Ok(Ok(())) => {
                self.process = Some(Worker { stop, handle });
                Ok(())
            }
            Ok(Err(error)) => {
                let _ = handle.join();
                Err(error)
            }
            Err(_) => {
                // El hilo aún puede estar activando; al ver `stop` termina solo y nadie lo espera.
                stop.store(true, Ordering::SeqCst);
                Err(capture_error("timed out opening the application audio"))
            }
        }
    }
}

impl AudioCapture for WindowsAudio {
    fn start(&mut self, on_chunk: ChunkCallback) -> Result<()> {
        if self.process.is_some() {
            return Err(capture_error("audio capture is already running"));
        }
        self.system.start(on_chunk)
    }

    fn start_source(&mut self, source: &AudioSource, on_chunk: ChunkCallback) -> Result<()> {
        match source {
            AudioSource::System => self.start(on_chunk),
            AudioSource::Process { id, .. } => {
                if self.process.is_some() {
                    return Err(capture_error("audio capture is already running"));
                }
                self.start_process(*id, on_chunk)
            }
        }
    }

    fn stop(&mut self) {
        self.system.stop();
        if let Some(worker) = self.process.take() {
            worker.stop.store(true, Ordering::SeqCst);
            let _ = worker.handle.join();
        }
    }
}

impl Drop for WindowsAudio {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Hilo de captura: activa el cliente, avisa de que está listo y entrega trozos hasta `stop` o fin.
fn run(
    pid: u32,
    on_chunk: ChunkCallback,
    stop: &AtomicBool,
    ended: &AtomicBool,
    on_ended: Option<EndedCallback>,
    ready: mpsc::SyncSender<Result<()>>,
) {
    let _ = initialize_mta();
    let opened = open(pid);
    let (client, capture, event) = match opened {
        Ok(parts) => parts,
        Err(error) => {
            let _ = ready.send(Err(error));
            return;
        }
    };
    if stop.load(Ordering::SeqCst) {
        return;
    }
    if let Err(e) = client.start_stream() {
        let _ = ready.send(Err(capture_error(format!(
            "could not start the application audio capture: {e}"
        ))));
        return;
    }
    let _ = ready.send(Ok(()));

    let mut chunker = Chunker::new(on_chunk);
    let mut resampler = Resampler::new(RATE as u32);
    let mut bytes: VecDeque<u8> = VecDeque::new();
    let mut system = System::new();
    let mut last_check = Instant::now();
    let mut finished = false;
    while !stop.load(Ordering::SeqCst) {
        let signalled = event.wait_for_event(WAKE_MS).is_ok();
        if signalled {
            loop {
                match capture.get_next_packet_size() {
                    Ok(Some(n)) if n > 0 => {}
                    Ok(_) => break,
                    Err(_) => {
                        finished = true;
                        break;
                    }
                }
                if capture.read_from_device_to_deque(&mut bytes).is_err() {
                    finished = true;
                    break;
                }
                let whole = bytes.len() / BYTES_PER_FRAME * BYTES_PER_FRAME;
                let raw: Vec<u8> = bytes.drain(..whole).collect();
                let samples: Vec<f32> = raw
                    .as_chunks::<4>()
                    .0
                    .iter()
                    .map(|b| f32::from_le_bytes(*b))
                    .collect();
                let mono = to_mono(&samples, CHANNELS);
                chunker.push(&resampler.process(&mono));
            }
        }
        if !finished && last_check.elapsed() >= LIVENESS_EVERY {
            last_check = Instant::now();
            finished = !process_exists(&mut system, pid);
        }
        if finished {
            break;
        }
    }
    let _ = client.stop_stream();
    if finished && !stop.load(Ordering::SeqCst) {
        ended.store(true, Ordering::SeqCst);
        if let Some(callback) = on_ended {
            callback();
        }
    }
}

fn open(pid: u32) -> Result<(AudioClient, wasapi::AudioCaptureClient, wasapi::Handle)> {
    let mut client = AudioClient::new_application_loopback_client(pid, true).map_err(|e| {
        capture_error(format!(
            "could not capture the audio of process {pid}: {e} \
             (per-application capture needs Windows 10 version 2004 or later)"
        ))
    })?;
    let format = WaveFormat::new(32, 32, &SampleType::Float, RATE, CHANNELS, None);
    let mode = StreamMode::EventsShared {
        autoconvert: true,
        buffer_duration_hns: 200_000,
    };
    client
        .initialize_client(&format, &Direction::Capture, &mode)
        .map_err(|e| capture_error(format!("could not initialise the application capture: {e}")))?;
    let event = client
        .set_get_eventhandle()
        .map_err(|e| capture_error(format!("could not create the capture event: {e}")))?;
    let capture = client
        .get_audiocaptureclient()
        .map_err(|e| capture_error(format!("could not get the capture client: {e}")))?;
    Ok((client, capture, event))
}

/// Lista de aplicaciones que suenan ahora por el dispositivo de salida por defecto.
#[derive(Default)]
pub struct WindowsSourceLister;

impl WindowsSourceLister {
    pub fn new() -> Self {
        Self
    }
}

impl AudioSourceLister for WindowsSourceLister {
    fn list(&self) -> Result<Vec<AppAudio>> {
        // COM se inicia en un hilo propio y breve, para no dejar el del llamador con COM inicializado.
        thread::spawn(list_sessions)
            .join()
            .map_err(|_| capture_error("the audio session listing panicked"))?
    }
}

fn list_sessions() -> Result<Vec<AppAudio>> {
    let _ = initialize_mta();
    let fail = |what: &str, e: wasapi::WasapiError| capture_error(format!("{what}: {e}"));
    let device = DeviceEnumerator::new()
        .and_then(|d| d.get_default_device(&Direction::Render))
        .map_err(|e| fail("could not open the default audio output device", e))?;
    let sessions = device
        .get_iaudiosessionmanager()
        .and_then(|m| m.get_audiosessionenumerator())
        .map_err(|e| fail("could not read the audio sessions", e))?;
    let count = sessions
        .get_count()
        .map_err(|e| fail("could not count the audio sessions", e))?;

    let mut pids = Vec::new();
    for index in 0..count {
        let Ok(session) = sessions.get_session(index) else {
            continue;
        };
        if !matches!(session.get_state(), Ok(SessionState::Active)) {
            continue;
        }
        match session.get_process_id() {
            Ok(pid) if pid != 0 => pids.push(pid),
            _ => {}
        }
    }

    let mut system = System::new();
    system.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    let name_of = |pid: Pid| {
        system
            .process(pid)
            .map(|p| p.name().to_string_lossy().into_owned())
    };
    // nombre en minúsculas -> (nombre visible, pid raíz del grupo)
    let mut groups: BTreeMap<String, (String, u32)> = BTreeMap::new();
    for pid in pids {
        let pid = Pid::from_u32(pid);
        let Some(name) = name_of(pid) else { continue };
        let key = name.to_lowercase();
        let root = root_of(&system, pid, &key);
        let entry = groups.entry(key).or_insert((name, root.as_u32()));
        // Varias sesiones del mismo programa: el raíz más antiguo (menor PID) cubre más árbol.
        if root.as_u32() < entry.1 {
            entry.1 = root.as_u32();
        }
    }
    Ok(groups
        .into_values()
        .map(|(name, id)| AppAudio { id, name })
        .collect())
}

/// Sube por los padres mientras sean del mismo programa: la captura con árbol de procesos desde esa
/// raíz incluye también a los hermanos que suenan.
fn root_of(system: &System, mut pid: Pid, key: &str) -> Pid {
    for _ in 0..16 {
        let Some(parent) = system.process(pid).and_then(|p| p.parent()) else {
            break;
        };
        let same = system
            .process(parent)
            .is_some_and(|p| p.name().to_string_lossy().to_lowercase() == key);
        if !same {
            break;
        }
        pid = parent;
    }
    pid
}
