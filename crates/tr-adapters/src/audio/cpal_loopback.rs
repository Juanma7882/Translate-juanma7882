//! Audio del sistema en Windows y macOS con `cpal`.
//!
//! - Windows: abrir el dispositivo de **salida** por defecto como entrada activa el modo loopback
//!   de WASAPI, que entrega lo mismo que suena por los altavoces.
//! - macOS: `cpal` crea un "tap" del dispositivo de salida (requiere macOS 14.6 o posterior y el
//!   permiso de captura de audio del sistema).
//!
//! El flujo de `cpal` no se puede mover entre hilos en todas las plataformas, así que vive en un
//! hilo propio desde su creación hasta `stop`. El audio solo pasa por memoria hacia el callback.

use std::sync::mpsc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Sample, SampleFormat, SizedSample, Stream, StreamConfig};
use tr_core::ports::ChunkCallback;
use tr_core::{AudioCapture, CoreError, Result};

use super::chunker::Chunker;
use super::resample::{Resampler, to_mono};

/// Espera máxima a que el hilo de captura abra el dispositivo.
const START_TIMEOUT: Duration = Duration::from_secs(10);

fn capture_error(message: impl Into<String>) -> CoreError {
    CoreError::Capture(message.into())
}

/// Del formato del dispositivo a trozos de 16 kHz mono.
struct Pipe {
    channels: usize,
    resampler: Resampler,
    chunker: Chunker,
}

impl Pipe {
    fn push(&mut self, interleaved: &[f32]) {
        let mono = to_mono(interleaved, self.channels);
        let resampled = self.resampler.process(&mono);
        self.chunker.push(&resampled);
    }
}

fn input_stream<T>(device: &cpal::Device, config: StreamConfig, mut pipe: Pipe) -> Result<Stream>
where
    T: SizedSample,
    f32: cpal::FromSample<T>,
{
    device
        .build_input_stream(
            config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                let samples: Vec<f32> = data.iter().map(|&s| f32::from_sample(s)).collect();
                pipe.push(&samples);
            },
            // Los errores del flujo no llevan contenido, pero tampoco hay dónde registrarlos.
            |_error: cpal::Error| {},
            None,
        )
        .map_err(|e| capture_error(format!("could not open the output device for capture: {e}")))
}

fn build(on_chunk: ChunkCallback) -> Result<Stream> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| capture_error("there is no default audio output device"))?;
    let supported = device
        .default_output_config()
        .map_err(|e| capture_error(format!("could not read the output device format: {e}")))?;
    let format = supported.sample_format();
    let config: StreamConfig = supported.into();
    let pipe = Pipe {
        channels: usize::from(config.channels.max(1)),
        resampler: Resampler::new(config.sample_rate),
        chunker: Chunker::new(on_chunk),
    };
    match format {
        SampleFormat::F32 => input_stream::<f32>(&device, config, pipe),
        SampleFormat::I16 => input_stream::<i16>(&device, config, pipe),
        SampleFormat::I32 => input_stream::<i32>(&device, config, pipe),
        SampleFormat::U16 => input_stream::<u16>(&device, config, pipe),
        other => Err(capture_error(format!(
            "unsupported audio sample format {other:?}"
        ))),
    }
}

struct Worker {
    /// Soltar el emisor (o enviar) despierta al hilo y le hace cerrar el flujo.
    stop: mpsc::SyncSender<()>,
    handle: JoinHandle<()>,
}

/// Captura del audio que suena por el dispositivo de salida por defecto.
#[derive(Default)]
pub struct CpalLoopback {
    worker: Option<Worker>,
}

impl CpalLoopback {
    pub fn new() -> Self {
        Self::default()
    }
}

impl AudioCapture for CpalLoopback {
    fn start(&mut self, on_chunk: ChunkCallback) -> Result<()> {
        if self.worker.is_some() {
            return Err(capture_error("audio capture is already running"));
        }
        let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<()>>(1);
        let (stop_tx, stop_rx) = mpsc::sync_channel::<()>(0);
        let handle = thread::spawn(move || {
            let stream = match build(on_chunk) {
                Ok(stream) => stream,
                Err(error) => {
                    let _ = ready_tx.send(Err(error));
                    return;
                }
            };
            if let Err(e) = stream.play() {
                let _ = ready_tx.send(Err(capture_error(format!(
                    "could not start the audio capture: {e}"
                ))));
                return;
            }
            let _ = ready_tx.send(Ok(()));
            let _ = stop_rx.recv();
            drop(stream);
        });
        match ready_rx.recv_timeout(START_TIMEOUT) {
            Ok(Ok(())) => {
                self.worker = Some(Worker {
                    stop: stop_tx,
                    handle,
                });
                Ok(())
            }
            Ok(Err(error)) => {
                let _ = handle.join();
                Err(error)
            }
            Err(_) => {
                drop(stop_tx);
                Err(capture_error("timed out opening the audio output device"))
            }
        }
    }

    fn stop(&mut self) {
        if let Some(worker) = self.worker.take() {
            drop(worker.stop);
            let _ = worker.handle.join();
        }
    }
}

impl Drop for CpalLoopback {
    fn drop(&mut self) {
        self.stop();
    }
}
