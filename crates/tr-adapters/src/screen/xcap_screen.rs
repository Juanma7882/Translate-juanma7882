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

fn explain(error: &xcap::XCapError) -> CoreError {
    describe_failure(&error.to_string(), wayland_session())
}

struct Snapshot {
    /// En el orden de `geometry::order`.
    monitors: Vec<Monitor>,
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
        let found = Monitor::all().map_err(|e| explain(&e))?;
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
        let mut slots: Vec<Option<Monitor>> = found.into_iter().map(Some).collect();
        let monitors = order.iter().filter_map(|&i| slots[i].take()).collect();
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
        let image = snapshot.monitors[plan.monitor]
            .capture_region(plan.x, plan.y, plan.width, plan.height)
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

    #[test]
    fn creating_the_screen_does_not_touch_the_display() {
        // Sin pantalla (CI sin X) construir no debe fallar: la E/S es perezosa.
        let _screen = XcapScreen::new();
    }
}
