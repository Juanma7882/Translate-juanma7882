//! Captura real con `xcap` sobre un servidor X (Xvfb).
//!
//! Bajo WSLg (Wayland) `xcap` no puede capturar; sobre Xvfb sí. Se ejecuta con:
//! `scripts/with-xvfb.sh cargo test -p tr-adapters --test xcap_real -- --ignored`
//!
//! El propio test dibuja una ventana de color conocido (sin gestor de ventanas, `override_redirect`)
//! y comprueba que la captura de una región devuelve exactamente esos píxeles en esas posiciones.

#![cfg(all(target_os = "linux", feature = "screen-xcap"))]

use std::time::Duration;

use tr_adapters::screen::XcapScreen;
use tr_core::{CoreError, Region, ScreenCapture};
use xcb::x;

/// Ventana de color sólido con esquina superior izquierda en (`WIN_X`, `WIN_Y`).
const WIN_X: i16 = 100;
const WIN_Y: i16 = 60;
const WIN_W: u16 = 200;
const WIN_H: u16 = 100;
const RED: u32 = 0x00ff_0000;

struct Display {
    conn: xcb::Connection,
    screen_width: u32,
    screen_height: u32,
}

fn open_display() -> Display {
    let (conn, screen_num) = xcb::Connection::connect(None)
        .expect("conectar con el servidor X (¿DISPLAY? usa scripts/with-xvfb.sh)");
    let (root, root_visual, width, height) = {
        let screen = conn
            .get_setup()
            .roots()
            .nth(screen_num as usize)
            .expect("pantalla");
        (
            screen.root(),
            screen.root_visual(),
            screen.width_in_pixels(),
            screen.height_in_pixels(),
        )
    };
    let window: x::Window = conn.generate_id();
    conn.send_request(&x::CreateWindow {
        depth: x::COPY_FROM_PARENT as u8,
        wid: window,
        parent: root,
        x: WIN_X,
        y: WIN_Y,
        width: WIN_W,
        height: WIN_H,
        border_width: 0,
        class: x::WindowClass::InputOutput,
        visual: root_visual,
        value_list: &[x::Cw::BackPixel(RED), x::Cw::OverrideRedirect(true)],
    });
    conn.send_request(&x::MapWindow { window });
    conn.flush().expect("enviar peticiones al servidor X");
    std::thread::sleep(Duration::from_millis(300)); // deja que el servidor pinte la ventana
    Display {
        conn,
        screen_width: u32::from(width),
        screen_height: u32::from(height),
    }
}

fn region(x: i32, y: i32, w: u32, h: u32) -> Region {
    Region::new(x, y, w, h, 0).unwrap()
}

fn pixel(frame: &tr_core::Frame, x: u32, y: u32) -> [u8; 3] {
    let i = ((y * frame.width + x) * 4) as usize;
    [frame.rgba[i], frame.rgba[i + 1], frame.rgba[i + 2]]
}

const RED_RGB: [u8; 3] = [255, 0, 0];
const BLACK: [u8; 3] = [0, 0, 0];

#[test]
#[ignore = "necesita un servidor X: scripts/with-xvfb.sh"]
fn a_region_inside_the_window_is_captured_exactly() {
    let _display = open_display();
    let frame = XcapScreen::new()
        .grab(&region(
            i32::from(WIN_X),
            i32::from(WIN_Y),
            u32::from(WIN_W),
            u32::from(WIN_H),
        ))
        .unwrap();
    assert_eq!(
        (frame.width, frame.height),
        (u32::from(WIN_W), u32::from(WIN_H))
    );
    assert!(
        frame
            .rgba
            .as_chunks::<4>()
            .0
            .iter()
            .all(|p| p[..3] == RED_RGB && p[3] == 255),
        "todo rojo y opaco"
    );
}

#[test]
#[ignore = "necesita un servidor X: scripts/with-xvfb.sh"]
fn coordinates_map_to_the_exact_pixels_of_the_screen() {
    let _display = open_display();
    // La región empieza 50 px a la izquierda de la ventana y 10 px por encima de ella.
    let frame = XcapScreen::new()
        .grab(&region(
            i32::from(WIN_X) - 50,
            i32::from(WIN_Y) - 10,
            120,
            40,
        ))
        .unwrap();
    assert_eq!((frame.width, frame.height), (120, 40));
    for (x, y, expected) in [
        (49, 20, BLACK),   // justo a la izquierda del borde de la ventana
        (50, 20, RED_RGB), // primer píxel de la ventana
        (119, 20, RED_RGB),
        (60, 9, BLACK),    // justo encima de la ventana
        (60, 10, RED_RGB), // primera fila de la ventana
        (60, 39, RED_RGB),
    ] {
        assert_eq!(pixel(&frame, x, y), expected, "píxel ({x}, {y})");
    }
}

#[test]
#[ignore = "necesita un servidor X: scripts/with-xvfb.sh"]
fn untouched_screen_is_a_black_frame_not_an_error() {
    let _display = open_display();
    let frame = XcapScreen::new().grab(&region(0, 0, 64, 32)).unwrap();
    assert_eq!((frame.width, frame.height), (64, 32));
    assert!(
        frame
            .rgba
            .as_chunks::<4>()
            .0
            .iter()
            .all(|p| p[..3] == BLACK),
        "negro, igual que el contenido protegido"
    );
}

#[test]
#[ignore = "necesita un servidor X: scripts/with-xvfb.sh"]
fn a_region_sticking_out_of_the_screen_is_clipped() {
    let display = open_display();
    let (w, h) = (display.screen_width, display.screen_height);
    let frame = XcapScreen::new()
        .grab(&region((w - 80) as i32, (h - 20) as i32, 200, 100))
        .unwrap();
    assert_eq!(
        (frame.width, frame.height),
        (80, 20),
        "recortada a los límites del monitor"
    );
}

#[test]
#[ignore = "necesita un servidor X: scripts/with-xvfb.sh"]
fn a_region_completely_outside_or_on_a_missing_monitor_is_a_capture_error() {
    let display = open_display();
    let mut screen = XcapScreen::new();
    let outside = region(display.screen_width as i32 + 10, 0, 50, 50);
    let error = screen.grab(&outside).unwrap_err();
    assert!(
        matches!(&error, CoreError::Capture(m) if m.contains("outside")),
        "{error}"
    );

    let missing = Region::new(0, 0, 10, 10, 7).unwrap();
    let error = screen.grab(&missing).unwrap_err();
    assert!(
        matches!(&error, CoreError::Capture(m) if m.contains("monitor 7")),
        "{error}"
    );
}

#[test]
#[ignore = "necesita un servidor X: scripts/with-xvfb.sh"]
fn repeated_captures_see_changes_in_the_screen() {
    let display = open_display();
    let mut screen = XcapScreen::new();
    let probe = region(i32::from(WIN_X), i32::from(WIN_Y), 10, 10);
    assert_eq!(pixel(&screen.grab(&probe).unwrap(), 0, 0), RED_RGB);

    // Se cambia el color de fondo de la ventana y la siguiente captura lo refleja.
    let window = display
        .conn
        .wait_for_reply(display.conn.send_request(&x::QueryTree {
            window: display.conn.get_setup().roots().next().unwrap().root(),
        }))
        .unwrap()
        .children()
        .last()
        .copied()
        .expect("la ventana creada");
    display.conn.send_request(&x::ChangeWindowAttributes {
        window,
        value_list: &[x::Cw::BackPixel(0x0000_ff00)],
    });
    display.conn.send_request(&x::ClearArea {
        exposures: false,
        window,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
    });
    display.conn.flush().unwrap();
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(pixel(&screen.grab(&probe).unwrap(), 0, 0), [0, 255, 0]);
}
