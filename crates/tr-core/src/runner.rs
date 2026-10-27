//! Bucle de captura reutilizable: un hilo captura frames y otro los procesa.
//!
//! Entre ambos hay un [`LatestSlot`]: si el procesamiento es más lento que la captura se
//! descartan los frames viejos (backpressure "último gana").

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crossbeam_channel::{RecvTimeoutError, Sender, bounded, unbounded};

use crate::ports::{EventSink, ScreenCapture};
use crate::slot::LatestSlot;
use crate::types::{Event, Frame, Region};

/// Cada cuánto el hilo de proceso revisa órdenes y la señal de parada.
const POLL: Duration = Duration::from_millis(20);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Command {
    Pause,
    Resume,
}

/// Lo que se ejecuta en el hilo de proceso. Es el único dueño de su estado, sin locks.
pub trait FrameHandler: Send {
    /// Se llama una vez, antes del primer frame.
    fn init(&mut self) {}
    fn handle(&mut self, frame: Frame);
    fn command(&mut self, _command: Command) {}
    /// `true` pide capturar con `idle_interval` en vez de `interval`.
    fn low_rate(&self) -> bool {
        false
    }
    /// Se llama una vez al terminar el hilo; debe liberar recursos.
    fn shutdown(&mut self) {}
}

#[derive(Debug, Clone, Copy)]
pub struct LoopTiming {
    /// Pausa entre capturas en régimen normal.
    pub interval: Duration,
    /// Pausa entre capturas cuando el handler pide baja frecuencia.
    pub idle_interval: Duration,
}

impl Default for LoopTiming {
    fn default() -> Self {
        Self {
            interval: Duration::from_millis(200),
            idle_interval: Duration::from_secs(1),
        }
    }
}

pub struct CaptureLoop {
    stop: Arc<AtomicBool>,
    /// Soltar el emisor despierta de inmediato al hilo de captura que espera su turno.
    stop_signal: Option<Sender<()>>,
    paused: Arc<AtomicBool>,
    slot: Arc<LatestSlot<Frame>>,
    commands: Sender<Command>,
    capture: Option<JoinHandle<()>>,
    worker: Option<JoinHandle<()>>,
}

impl CaptureLoop {
    pub fn start(
        region: Region,
        mut screen: Box<dyn ScreenCapture>,
        mut handler: Box<dyn FrameHandler>,
        sink: Arc<dyn EventSink>,
        timing: LoopTiming,
    ) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let paused = Arc::new(AtomicBool::new(false));
        let low_rate = Arc::new(AtomicBool::new(false));
        let slot = Arc::new(LatestSlot::new());
        let (commands, command_rx) = unbounded();
        let (stop_signal, stop_rx) = bounded::<()>(0);

        let capture = {
            let (paused, low_rate, slot) = (paused.clone(), low_rate.clone(), slot.clone());
            thread::spawn(move || {
                loop {
                    let wait = if paused.load(Ordering::Acquire) {
                        POLL
                    } else {
                        match screen.grab(&region) {
                            Ok(frame) => {
                                slot.put(frame);
                            }
                            Err(error) => sink.emit(Event::from(&error)),
                        }
                        if low_rate.load(Ordering::Acquire) {
                            timing.idle_interval
                        } else {
                            timing.interval
                        }
                    };
                    // Solo un vencimiento del plazo sigue; cualquier otra cosa es "parar".
                    if !matches!(stop_rx.recv_timeout(wait), Err(RecvTimeoutError::Timeout)) {
                        break;
                    }
                }
            })
        };

        let worker = {
            let (stop, paused, slot) = (stop.clone(), paused.clone(), slot.clone());
            thread::spawn(move || {
                handler.init();
                low_rate.store(handler.low_rate(), Ordering::Release);
                loop {
                    while let Ok(command) = command_rx.try_recv() {
                        handler.command(command);
                        low_rate.store(handler.low_rate(), Ordering::Release);
                    }
                    if stop.load(Ordering::Acquire) {
                        break;
                    }
                    if let Some(frame) = slot.take_timeout(POLL) {
                        // Un frame capturado antes de pausar no debe procesarse después.
                        if !paused.load(Ordering::Acquire) {
                            handler.handle(frame);
                            low_rate.store(handler.low_rate(), Ordering::Release);
                        }
                    }
                }
                handler.shutdown();
            })
        };

        Self {
            stop,
            stop_signal: Some(stop_signal),
            paused,
            slot,
            commands,
            capture: Some(capture),
            worker: Some(worker),
        }
    }

    /// Deja de capturar pantalla de inmediato y avisa al handler.
    pub fn pause(&self) {
        self.paused.store(true, Ordering::Release);
        self.slot.try_take();
        let _ = self.commands.send(Command::Pause);
    }

    pub fn resume(&self) {
        let _ = self.commands.send(Command::Resume);
        self.paused.store(false, Ordering::Release);
    }

    /// Detiene ambos hilos y espera a que terminen: tras volver no se emiten más eventos.
    /// Es idempotente.
    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::Release);
        self.stop_signal.take();
        self.slot.close();
        for handle in [self.capture.take(), self.worker.take()]
            .into_iter()
            .flatten()
        {
            let _ = handle.join();
        }
    }
}

impl Drop for CaptureLoop {
    fn drop(&mut self) {
        self.stop();
    }
}
