//! El hook de pánico no debe revelar el mensaje original.
//!
//! Va en su propio binario de test: el hook de pánico es global al proceso.

use std::panic;
use std::sync::{Arc, Mutex};

use tr_core::panic_hook;

const SECRET: &str = "SECRET-PANIC-PAYLOAD-5c1d";

#[test]
fn panics_are_reported_without_their_message() {
    let buffer = Arc::new(Mutex::new(Vec::<u8>::new()));
    panic_hook::install(buffer.clone());

    // Pánico con mensaje formateado y con literal, en el hilo actual y en otro.
    let _ = panic::catch_unwind(|| panic!("{SECRET}"));
    let _ = panic::catch_unwind(|| panic!("fixed message {}", SECRET.len()));
    let _ = std::thread::Builder::new()
        .name("worker-x".into())
        .spawn(|| panic!("{SECRET}"))
        .unwrap()
        .join();

    let output = String::from_utf8(buffer.lock().unwrap().clone()).unwrap();
    assert_eq!(output.matches("panic at ").count(), 3, "{output}");
    assert!(
        output.contains("panic_hook.rs"),
        "debe indicar dónde ocurrió"
    );
    assert!(output.contains("worker-x"), "debe indicar el hilo");
    assert!(!output.contains(SECRET), "el mensaje no debe aparecer");
    assert!(
        !output.contains("fixed message"),
        "ningún mensaje debe aparecer"
    );
}
