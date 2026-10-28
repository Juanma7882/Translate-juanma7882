//! Captura real con `xcap`.

use std::time::{Duration, Instant};

use tr_core::{CoreError, Frame, Region, Result, ScreenCapture};
use xcap::Monitor;

use super::geometry::{self, MonitorGeometry};

/// Cada cuánto se vuelve a consultar la lista de monitores (por si cambia la configuración).
const REFRESH: Duration = Duration::from_secs(5);

fn capture_error(message: impl Into<String>) -> CoreError {
    CoreError::Capture(message.into())
}

/// ¿El proceso corre bajo una sesión Wayland? `xcap` elige entonces la captura de Wayland, que
/// muchos compositores (incluido el de WSLg) no ofrecen.
fn wayland_session() -> bool {
    let session = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();
    session.eq_ignore_ascii_case("wayland") || std::env::var_os("WAYLAND_DISPLAY").is_some()
}

/// Mensaje accionable para un fallo de captura. Solo describe el fallo del sistema, nunca
/// contenido de la pantalla.
fn describe_failure(cause: &str, wayland: bool) -> CoreError {
    let hint = if wayland {
        " A Wayland session was detected and its compositor may not allow capturing the screen; \
         use an X11 session."
    } else {
        ""
    };
    capture_error(format!("could not capture the screen: {cause}.{hint}"))
}

/// Reintentos tras el primer fallo transitorio y espera entre ellos. `xcap` abre una conexión X
/// nueva en cada captura; si el servidor la rechaza justo en ese instante (p. ej. Xvfb
/// regenerándose al cerrarse el último cliente, o un servidor saturado) el siguiente intento
/// funciona. Un fallo que persiste tras estos reintentos se informa tal cual.
const TRANSIENT_RETRIES: u32 = 3;
const TRANSIENT_WAIT: Duration = Duration::from_millis(40);

/// ¿Es un fallo pasajero de conexión (y no, p. ej., una región inválida o un servidor ausente)?
/// Solo mira el texto del error del sistema, nunca contenido.
fn is_transient(cause: &str) -> bool {
    let cause = cause.to_ascii_lowercase();
    cause.contains("connection error")
        || cause.contains("i/o error")
        || cause.contains("connection reset")
        || cause.contains("broken pipe")
}

/// Ejecuta `op`, repitiéndola hasta `retries` veces con `wait` entre intentos mientras el error
/// sea transitorio. Devuelve el último error si no se recupera.
fn retry_transient<T, E: std::fmt::Display>(
    retries: u32,
    wait: Duration,
    mut op: impl FnMut() -> std::result::Result<T, E>,
) -> std::result::Result<T, E> {
    let mut attempt = 0;
    loop {
        match op() {
            Err(error) if attempt < retries && is_transient(&error.to_string()) => {
                attempt += 1;
                std::thread::sleep(wait);
            }
            other => return other,
        }
    }
}

fn explain(error: &xcap::XCapError) -> CoreError {
    describe_failure(&error.to_string(), wayland_session())
}

struct Snapshot {
    /// Identificadores de monitor, en el orden de `geometry::order`. No se guarda el `Monitor`
    /// mismo: en Windows envuelve un `HMONITOR` (`*mut c_void`) y no es `Send`, que `ScreenCapture`
    /// exige; se vuelve a resolver por id en cada captura.
    monitors: Vec<u32>,
    geometry: Vec<MonitorGeometry>,
    taken: Instant,
}

/// `ScreenCapture` sobre `xcap`. No hace E/S hasta la primera captura.
#[derive(Default)]
pub struct XcapScreen {
    snapshot: Option<Snapshot>,
}

impl XcapScreen {
    pub fn new() -> Self {
        Self::default()
    }

    fn load() -> Result<Snapshot> {
        let found = retry_transient(TRANSIENT_RETRIES, TRANSIENT_WAIT, Monitor::all)
            .map_err(|e| explain(&e))?;
        let raw = found
            .iter()
            .map(
                |m| -> std::result::Result<MonitorGeometry, xcap::XCapError> {
                    Ok(MonitorGeometry {
                        x: m.x()?,
                        y: m.y()?,
                        width: m.width()?,
                        height: m.height()?,
                        is_primary: m.is_primary()?,
                    })
                },
            )
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| explain(&e))?;
        let order = geometry::order(&raw);
        let geometry = order.iter().map(|&i| raw[i]).collect();
        let ids = found
            .iter()
            .map(Monitor::id)
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| explain(&e))?;
        let monitors = order.iter().map(|&i| ids[i]).collect();
        Ok(Snapshot {
            monitors,
            geometry,
            taken: Instant::now(),
        })
    }

    fn snapshot(&mut self) -> Result<&Snapshot> {
        if self
            .snapshot
            .as_ref()
            .is_none_or(|s| s.taken.elapsed() >= REFRESH)
        {
            self.snapshot = Some(Self::load()?);
        }
        self.snapshot
            .as_ref()
            .ok_or_else(|| capture_error("no monitor information"))
    }
}

impl ScreenCapture for XcapScreen {
    fn grab(&mut self, region: &Region) -> Result<Frame> {
        let snapshot = self.snapshot()?;
        let plan = geometry::plan(region, &snapshot.geometry)?;
        let id = snapshot.monitors[plan.monitor];
        let image = retry_transient(TRANSIENT_RETRIES, TRANSIENT_WAIT, || {
            Monitor::all()?
                .into_iter()
                .find(|m| m.id().is_ok_and(|found| found == id))
                .ok_or_else(|| xcap::XCapError::new("monitor no longer available"))?
                .capture_region(plan.x, plan.y, plan.width, plan.height)
        })
        .map_err(|e| {
            // La configuración de monitores pudo cambiar: se vuelve a leer en la próxima captura.
            self.snapshot = None;
            explain(&e)
        })?;
        let (width, height) = (image.width(), image.height());
        // Un frame negro (p. ej. contenido protegido) es un frame normal, sin texto: no es un error.
        Frame::new(width, height, image.into_raw())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failures_are_capture_errors_that_say_what_happened() {
        let error = describe_failure("device busy", false);
        assert!(
            matches!(&error, CoreError::Capture(m) if m == "could not capture the screen: device busy."),
            "{error}"
        );
    }

    #[test]
    fn wayland_failures_explain_what_to_do() {
        let error = describe_failure("no compositor", true);
        let CoreError::Capture(message) = error else {
            panic!("debe ser un error de captura")
        };
        assert!(
            message.contains("Wayland") && message.contains("X11 session"),
            "{message}"
        );
        assert!(
            message.contains("no compositor"),
            "conserva la causa original"
        );
    }

    const NO_WAIT: Duration = Duration::from_millis(0);

    #[test]
    fn a_transient_connection_error_is_retried_until_it_recovers() {
        let mut calls = 0;
        let result = retry_transient(3, NO_WAIT, || {
            calls += 1;
            if calls < 3 {
                Err("Connection error, possible I/O error".to_owned())
            } else {
                Ok(calls)
            }
        });
        assert_eq!(result, Ok(3));
    }

    #[test]
    fn a_persistent_transient_error_is_reported_after_the_bounded_retries() {
        let mut calls = 0;
        let result: std::result::Result<(), String> = retry_transient(3, NO_WAIT, || {
            calls += 1;
            Err("Connection error, possible I/O error".to_owned())
        });
        assert_eq!(calls, 4, "un intento y tres reintentos");
        assert!(result.is_err());
    }

    #[test]
    fn permanent_errors_are_not_retried() {
        let mut calls = 0;
        let result: std::result::Result<(), String> = retry_transient(3, NO_WAIT, || {
            calls += 1;
            Err("Invalid capture region: out of bounds".to_owned())
        });
        assert_eq!(calls, 1);
        assert!(result.is_err());
    }

    #[test]
    fn only_connection_failures_count_as_transient() {
        assert!(is_transient("Connection error, possible I/O error"));
        assert!(is_transient("Broken pipe"));
        assert!(!is_transient("Not supported"));
        assert!(!is_transient("Invalid capture region: x"));
    }

    #[test]
    fn creating_the_screen_does_not_touch_the_display() {
        // Sin pantalla (CI sin X) construir no debe fallar: la E/S es perezosa.
        let _screen = XcapScreen::new();
    }
}
