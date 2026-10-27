//! Geometría de monitores y de regiones, sin depender de ningún motor de captura.
//!
//! Convenciones: las regiones están en **píxeles físicos y relativas al monitor** indicado
//! (`Region::monitor`); el monitor 0 es el principal y el resto va ordenado por posición.

use tr_core::{CoreError, Region, Result};

/// Posición y tamaño de un monitor en el escritorio virtual (píxeles físicos).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MonitorGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
}

/// Rectángulo a capturar, relativo al monitor `monitor` (índice en el orden de [`order`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CapturePlan {
    pub monitor: usize,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// Orden estable de monitores: primero el principal, después el resto por `(x, y)`.
/// Devuelve los índices de `monitors` en ese orden.
pub fn order(monitors: &[MonitorGeometry]) -> Vec<usize> {
    let mut indices: Vec<usize> = (0..monitors.len()).collect();
    indices.sort_by_key(|&i| {
        let m = monitors[i];
        (!m.is_primary, m.x, m.y, i)
    });
    indices
}

fn capture_error(message: impl Into<String>) -> CoreError {
    CoreError::Capture(message.into())
}

/// Resuelve qué rectángulo capturar. `monitors` ya debe venir en el orden de [`order`].
///
/// Una región parcialmente fuera del monitor se **recorta** a sus límites; una región
/// completamente fuera es un error, igual que un monitor inexistente.
pub fn plan(region: &Region, monitors: &[MonitorGeometry]) -> Result<CapturePlan> {
    let index = region.monitor as usize;
    let monitor = monitors.get(index).ok_or_else(|| {
        capture_error(format!(
            "monitor {} does not exist ({} available)",
            region.monitor,
            monitors.len()
        ))
    })?;

    let left = i64::from(region.x).max(0);
    let top = i64::from(region.y).max(0);
    let right = (i64::from(region.x) + i64::from(region.width)).min(i64::from(monitor.width));
    let bottom = (i64::from(region.y) + i64::from(region.height)).min(i64::from(monitor.height));
    if right <= left || bottom <= top {
        return Err(capture_error(format!(
            "the region is outside monitor {} ({}x{})",
            region.monitor, monitor.width, monitor.height
        )));
    }
    Ok(CapturePlan {
        monitor: index,
        x: left as u32,
        y: top as u32,
        width: (right - left) as u32,
        height: (bottom - top) as u32,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mon(x: i32, y: i32, width: u32, height: u32, is_primary: bool) -> MonitorGeometry {
        MonitorGeometry {
            x,
            y,
            width,
            height,
            is_primary,
        }
    }

    fn region(x: i32, y: i32, w: u32, h: u32, monitor: u32) -> Region {
        Region::new(x, y, w, h, monitor).unwrap()
    }

    fn layout() -> Vec<MonitorGeometry> {
        // Tal como los entregaría el sistema: desordenados, con uno a la izquierda del principal.
        let raw = [
            mon(1920, 0, 2560, 1440, false),
            mon(-1280, 100, 1280, 1024, false),
            mon(0, 0, 1920, 1080, true),
        ];
        order(&raw).into_iter().map(|i| raw[i]).collect()
    }

    #[test]
    fn the_primary_monitor_is_first_and_the_rest_follow_by_position() {
        let ordered = layout();
        assert!(ordered[0].is_primary);
        assert_eq!(
            (ordered[1].x, ordered[2].x),
            (-1280, 1920),
            "izquierda antes que derecha"
        );
    }

    #[test]
    fn ordering_is_stable_for_identical_positions() {
        let raw = [mon(0, 0, 100, 100, false), mon(0, 0, 200, 200, false)];
        assert_eq!(order(&raw), [0, 1]);
        assert!(order(&[]).is_empty());
    }

    #[test]
    fn a_region_on_the_primary_monitor_is_used_as_is() {
        let p = plan(&region(100, 200, 300, 50, 0), &layout()).unwrap();
        assert_eq!(
            p,
            CapturePlan {
                monitor: 0,
                x: 100,
                y: 200,
                width: 300,
                height: 50
            }
        );
    }

    #[test]
    fn a_region_is_relative_to_the_monitor_it_names() {
        // Monitor 1 (el de origen negativo) y monitor 2 (a la derecha): la región no se desplaza.
        let left = plan(&region(10, 20, 100, 100, 1), &layout()).unwrap();
        assert_eq!((left.monitor, left.x, left.y), (1, 10, 20));
        let right = plan(&region(10, 20, 100, 100, 2), &layout()).unwrap();
        assert_eq!((right.monitor, right.x, right.y), (2, 10, 20));
    }

    #[test]
    fn a_region_partly_outside_is_clipped() {
        // Sobresale por la derecha y por abajo del monitor principal (1920x1080).
        let p = plan(&region(1800, 1000, 300, 200, 0), &layout()).unwrap();
        assert_eq!(
            p,
            CapturePlan {
                monitor: 0,
                x: 1800,
                y: 1000,
                width: 120,
                height: 80
            }
        );
        // Sobresale por la izquierda y por arriba.
        let p = plan(&region(-50, -30, 200, 100, 0), &layout()).unwrap();
        assert_eq!(
            p,
            CapturePlan {
                monitor: 0,
                x: 0,
                y: 0,
                width: 150,
                height: 70
            }
        );
    }

    #[test]
    fn a_region_entirely_outside_is_an_error() {
        for r in [
            region(1920, 0, 10, 10, 0),
            region(0, 1080, 10, 10, 0),
            region(-100, 0, 100, 10, 0),
            region(0, -50, 10, 50, 0),
        ] {
            let e = plan(&r, &layout()).unwrap_err();
            assert!(
                matches!(&e, CoreError::Capture(m) if m.contains("outside")),
                "{e}"
            );
        }
    }

    #[test]
    fn a_missing_monitor_is_reported_with_how_many_exist() {
        let e = plan(&region(0, 0, 10, 10, 3), &layout()).unwrap_err();
        assert!(
            matches!(&e, CoreError::Capture(m) if m.contains("monitor 3") && m.contains("3 available")),
            "{e}"
        );
        assert!(
            plan(&region(0, 0, 10, 10, 0), &[]).is_err(),
            "sin monitores"
        );
    }

    #[test]
    fn extreme_coordinates_do_not_overflow() {
        assert!(
            plan(
                &region(i32::MAX, i32::MAX, u32::MAX, u32::MAX, 0),
                &layout()
            )
            .is_err()
        );
        let p = plan(
            &region(i32::MIN, i32::MIN, u32::MAX, u32::MAX, 0),
            &layout(),
        )
        .unwrap();
        assert_eq!((p.x, p.y), (0, 0));
    }
}
