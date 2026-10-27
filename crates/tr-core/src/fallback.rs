//! Alternancia automática entre traducir texto en pantalla y subtitular audio.
//!
//! La lógica de decisión es una función pura ([`step`]) sin I/O ni hilos; el
//! [`TextOrAudioPipeline`] solo ejecuta las acciones que ella devuelve.

use std::sync::Arc;
use std::time::Duration;

use crate::audio::AudioRunner;
use crate::ports::{Clock, EventSink, ScreenCapture};
use crate::region::RegionProcessor;
use crate::runner::{CaptureLoop, Command, FrameHandler, LoopTiming};
use crate::types::{Event, Frame, Mode, Region};

#[derive(Debug, Clone, Copy)]
pub struct FallbackConfig {
    /// Tiempo continuo sin texto antes de pasar a audio.
    pub no_text_for: Duration,
    /// Tiempo continuo con texto antes de volver a texto desde audio.
    pub text_for: Duration,
}

impl Default for FallbackConfig {
    fn default() -> Self {
        Self {
            no_text_for: Duration::from_secs(3),
            text_for: Duration::from_secs(1),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct State {
    pub mode: Mode,
    /// Modo al que se vuelve al reanudar (solo relevante en `Paused`).
    resume: Mode,
    absent_since: Option<Duration>,
    present_since: Option<Duration>,
}

impl State {
    /// Estado inicial: modo texto.
    pub fn new() -> Self {
        Self {
            mode: Mode::Text,
            resume: Mode::Text,
            absent_since: None,
            present_since: None,
        }
    }
}

impl Default for State {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Input {
    /// Resultado del OCR para el frame actual.
    Observation {
        has_text: bool,
        now: Duration,
    },
    Pause,
    Resume,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    StartAudio,
    StopAudio,
    ModeChanged(Mode),
}

/// Transición pura: dado el estado y una entrada devuelve el nuevo estado y las acciones.
pub fn step(state: State, input: Input, config: &FallbackConfig) -> (State, Vec<Action>) {
    let mut next = state;
    let mut actions = Vec::new();

    match (state.mode, input) {
        (Mode::Text, Input::Observation { has_text, now }) => {
            if has_text {
                next.absent_since = None;
            } else {
                let since = *next.absent_since.get_or_insert(now);
                if now.saturating_sub(since) >= config.no_text_for {
                    next.mode = Mode::Audio;
                    next.absent_since = None;
                    next.present_since = None;
                    actions.extend([Action::StartAudio, Action::ModeChanged(Mode::Audio)]);
                }
            }
        }
        (Mode::Audio, Input::Observation { has_text, now }) => {
            if has_text {
                let since = *next.present_since.get_or_insert(now);
                if now.saturating_sub(since) >= config.text_for {
                    next.mode = Mode::Text;
                    next.absent_since = None;
                    next.present_since = None;
                    actions.extend([Action::StopAudio, Action::ModeChanged(Mode::Text)]);
                }
            } else {
                next.present_since = None;
            }
        }
        (Mode::Paused, Input::Observation { .. }) => {}
        (Mode::Text | Mode::Audio, Input::Pause) => {
            next.resume = state.mode;
            next.mode = Mode::Paused;
            next.absent_since = None;
            next.present_since = None;
            if state.mode == Mode::Audio {
                actions.push(Action::StopAudio);
            }
            actions.push(Action::ModeChanged(Mode::Paused));
        }
        (Mode::Paused, Input::Pause) => {}
        (Mode::Paused, Input::Resume) => {
            next.mode = state.resume;
            if state.resume == Mode::Audio {
                actions.push(Action::StartAudio);
            }
            actions.push(Action::ModeChanged(state.resume));
        }
        (Mode::Text | Mode::Audio, Input::Resume) => {}
    }

    (next, actions)
}

struct FallbackHandler {
    config: FallbackConfig,
    state: State,
    region: RegionProcessor,
    audio: AudioRunner,
    sink: Arc<dyn EventSink>,
    clock: Arc<dyn Clock>,
}

impl FallbackHandler {
    fn apply(&mut self, input: Input) {
        let (state, actions) = step(self.state, input, &self.config);
        self.state = state;
        for action in actions {
            match action {
                // Si el audio no arranca, `start` ya informó el error como evento.
                Action::StartAudio => {
                    let _ = self.audio.start();
                }
                Action::StopAudio => self.audio.stop(),
                Action::ModeChanged(mode) => {
                    self.region.set_translating(mode == Mode::Text);
                    self.sink.emit(Event::ModeChanged { mode });
                }
            }
        }
    }
}

impl FrameHandler for FallbackHandler {
    fn init(&mut self) {
        self.sink.emit(Event::ModeChanged { mode: Mode::Text });
    }

    fn handle(&mut self, frame: Frame) {
        let has_text = self.region.process(&frame);
        let now = self.clock.now();
        self.apply(Input::Observation { has_text, now });
    }

    fn command(&mut self, command: Command) {
        self.apply(match command {
            Command::Pause => Input::Pause,
            Command::Resume => Input::Resume,
        });
    }

    /// En modo audio se sigue vigilando la región, pero a baja frecuencia.
    fn low_rate(&self) -> bool {
        self.state.mode == Mode::Audio
    }

    fn shutdown(&mut self) {
        self.audio.stop();
    }
}

/// Componentes que arman un [`TextOrAudioPipeline`].
pub struct FallbackSetup {
    pub screen: Box<dyn ScreenCapture>,
    pub processor: RegionProcessor,
    pub audio: AudioRunner,
    pub config: FallbackConfig,
    pub timing: LoopTiming,
}

/// Pipeline que empieza en modo texto y pasa a audio cuando no hay texto en la región.
pub struct TextOrAudioPipeline {
    inner: CaptureLoop,
}

impl TextOrAudioPipeline {
    pub fn start(
        region: Region,
        setup: FallbackSetup,
        clock: Arc<dyn Clock>,
        sink: Arc<dyn EventSink>,
    ) -> Self {
        let handler = Box::new(FallbackHandler {
            config: setup.config,
            state: State::new(),
            region: setup.processor,
            audio: setup.audio,
            sink: sink.clone(),
            clock: clock.clone(),
        });
        Self {
            inner: CaptureLoop::start(region, setup.screen, handler, sink, setup.timing),
        }
    }

    pub fn pause(&self) {
        self.inner.pause();
    }

    pub fn resume(&self) {
        self.inner.resume();
    }

    /// Detiene todo (pantalla y audio); al volver no se emiten más eventos. Idempotente.
    pub fn stop(&mut self) {
        self.inner.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn secs(s: f64) -> Duration {
        Duration::from_secs_f64(s)
    }

    fn obs(has_text: bool, at: f64) -> Input {
        Input::Observation {
            has_text,
            now: secs(at),
        }
    }

    /// Aplica una secuencia de entradas y devuelve el estado final y todas las acciones.
    fn run(inputs: &[Input]) -> (State, Vec<Action>) {
        let config = FallbackConfig::default();
        let mut state = State::new();
        let mut all = Vec::new();
        for input in inputs {
            let (next, actions) = step(state, *input, &config);
            state = next;
            all.extend(actions);
        }
        (state, all)
    }

    #[test]
    fn starts_in_text_mode() {
        assert_eq!(State::new().mode, Mode::Text);
    }

    #[test]
    fn stays_in_text_while_text_is_present() {
        let inputs: Vec<_> = (0..100).map(|i| obs(true, f64::from(i))).collect();
        let (state, actions) = run(&inputs);
        assert_eq!(state.mode, Mode::Text);
        assert!(actions.is_empty());
    }

    #[test]
    fn switches_to_audio_after_three_seconds_without_text() {
        let (state, actions) = run(&[obs(false, 0.0), obs(false, 1.0), obs(false, 2.9)]);
        assert_eq!((state.mode, actions.len()), (Mode::Text, 0));
        let (state, actions) = run(&[obs(false, 0.0), obs(false, 3.0)]);
        assert_eq!(state.mode, Mode::Audio);
        assert_eq!(
            actions,
            [Action::StartAudio, Action::ModeChanged(Mode::Audio)]
        );
    }

    #[test]
    fn short_absences_of_text_do_not_switch_mode() {
        // 2 s sin texto, vuelve el texto, otros 2 s sin texto: nunca llega a 3 s seguidos.
        let (state, actions) = run(&[
            obs(false, 0.0),
            obs(false, 2.0),
            obs(true, 2.5),
            obs(false, 3.0),
            obs(false, 4.9),
        ]);
        assert_eq!(state.mode, Mode::Text);
        assert!(actions.is_empty());
    }

    #[test]
    fn returns_to_text_after_one_second_with_text() {
        let (state, actions) = run(&[
            obs(false, 0.0),
            obs(false, 3.0), // -> Audio
            obs(true, 10.0),
            obs(true, 10.5),
        ]);
        assert_eq!(state.mode, Mode::Audio);
        assert_eq!(actions.len(), 2);
        let (state, actions) = run(&[
            obs(false, 0.0),
            obs(false, 3.0),
            obs(true, 10.0),
            obs(true, 11.0),
        ]);
        assert_eq!(state.mode, Mode::Text);
        assert_eq!(
            actions[2..],
            [Action::StopAudio, Action::ModeChanged(Mode::Text)]
        );
    }

    #[test]
    fn flickering_text_in_audio_mode_does_not_switch_back() {
        let (state, _) = run(&[
            obs(false, 0.0),
            obs(false, 3.0), // -> Audio
            obs(true, 10.0),
            obs(true, 10.8),
            obs(false, 10.9), // se pierde antes de cumplir 1 s
            obs(true, 11.0),
            obs(true, 11.5),
        ]);
        assert_eq!(state.mode, Mode::Audio);
    }

    #[test]
    fn pause_from_text_and_resume_back_to_text() {
        let (state, actions) = run(&[Input::Pause]);
        assert_eq!(state.mode, Mode::Paused);
        assert_eq!(actions, [Action::ModeChanged(Mode::Paused)]);
        let (state, actions) = run(&[Input::Pause, Input::Resume]);
        assert_eq!(state.mode, Mode::Text);
        assert_eq!(actions[1..], [Action::ModeChanged(Mode::Text)]);
    }

    #[test]
    fn pause_from_audio_stops_capture_and_resume_restarts_it() {
        let (state, actions) = run(&[
            obs(false, 0.0),
            obs(false, 3.0),
            Input::Pause,
            Input::Resume,
        ]);
        assert_eq!(state.mode, Mode::Audio);
        assert_eq!(
            actions[2..],
            [
                Action::StopAudio,
                Action::ModeChanged(Mode::Paused),
                Action::StartAudio,
                Action::ModeChanged(Mode::Audio),
            ]
        );
    }

    #[test]
    fn observations_are_ignored_while_paused() {
        let (state, actions) = run(&[Input::Pause, obs(false, 0.0), obs(false, 60.0)]);
        assert_eq!(state.mode, Mode::Paused);
        assert_eq!(actions.len(), 1);
    }

    #[test]
    fn repeated_pause_and_resume_are_no_ops() {
        let (_, actions) = run(&[
            Input::Resume,
            Input::Pause,
            Input::Pause,
            Input::Resume,
            Input::Resume,
        ]);
        assert_eq!(actions.len(), 2);
    }

    #[test]
    fn timers_restart_after_resume() {
        // 2 s sin texto, pausa, reanuda: la ausencia previa no cuenta.
        let (state, _) = run(&[
            obs(false, 0.0),
            obs(false, 2.0),
            Input::Pause,
            Input::Resume,
            obs(false, 10.0),
            obs(false, 11.0),
        ]);
        assert_eq!(state.mode, Mode::Text);
    }
}
