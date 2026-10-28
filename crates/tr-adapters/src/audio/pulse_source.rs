//! Lógica pura de las fuentes por aplicación de PulseAudio/PipeWire: agrupación de *sink-inputs*
//! por programa y selección por identificador. No toca el servidor ni cuelga de ninguna
//! plataforma, así que se prueba en cualquier sistema. Solo maneja metadatos, nunca audio.

use tr_core::{AppAudio, CoreError, Result};

/// Metadatos de un *sink-input* (un flujo de reproducción de una aplicación).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SinkInputMeta {
    /// Índice del sink-input en el servidor.
    pub index: u32,
    /// `application.process.binary`.
    pub binary: Option<String>,
    /// `application.name`.
    pub app_name: Option<String>,
    /// Nombre del flujo (p. ej. "Playback Stream").
    pub stream_name: String,
    /// Pausado (sin sonar ahora mismo).
    pub corked: bool,
}

/// Convierte el valor de una propiedad del servidor (bytes, con o sin NUL final) en texto no vacío.
/// Solo la usa la captura de Linux; en las demás plataformas queda para los tests.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn prop_string(raw: Option<&[u8]>) -> Option<String> {
    let bytes = raw?;
    let end = bytes.iter().position(|b| *b == 0).unwrap_or(bytes.len());
    let text = String::from_utf8_lossy(&bytes[..end]).trim().to_string();
    (!text.is_empty()).then_some(text)
}

/// Nombre de programa: el binario si existe, si no el nombre de la aplicación, si no el del flujo.
pub fn program_name(input: &SinkInputMeta) -> String {
    input
        .binary
        .clone()
        .or_else(|| input.app_name.clone())
        .or_else(|| (!input.stream_name.trim().is_empty()).then(|| input.stream_name.clone()))
        .unwrap_or_else(|| "unknown".into())
}

/// Un elemento por programa (un navegador con varias pestañas suena por varios flujos). Su `id` es
/// el flujo más bajo que esté sonando (o el más bajo si todos están en pausa). Orden alfabético.
pub fn group_by_program(inputs: &[SinkInputMeta]) -> Vec<AppAudio> {
    let mut groups: Vec<(String, u32, bool)> = Vec::new(); // (nombre, índice, pausado)
    for input in inputs {
        let name = program_name(input);
        match groups.iter_mut().find(|(n, _, _)| *n == name) {
            Some((_, index, corked)) => {
                // Preferir sonando sobre pausado; a igualdad, el índice menor.
                let better =
                    (*corked && !input.corked) || (*corked == input.corked && input.index < *index);
                if better {
                    *index = input.index;
                    *corked = input.corked;
                }
            }
            None => groups.push((name, input.index, input.corked)),
        }
    }
    let mut apps: Vec<AppAudio> = groups
        .into_iter()
        .map(|(name, id, _)| AppAudio { id, name })
        .collect();
    apps.sort_by_key(|a| (a.name.to_lowercase(), a.id));
    apps
}

/// Elige el sink-input a capturar: el de ese índice; si ya no existe pero el programa sigue
/// sonando con otro flujo, ese; si no, error descriptivo.
pub fn resolve_input(inputs: &[SinkInputMeta], id: u32, name: &str) -> Result<u32> {
    if inputs.iter().any(|i| i.index == id) {
        return Ok(id);
    }
    inputs
        .iter()
        .filter(|i| program_name(i) == name)
        .min_by_key(|i| (i.corked, i.index))
        .map(|i| i.index)
        .ok_or_else(|| {
            CoreError::Capture(format!(
                "the application \"{name}\" is not playing audio (stream {id} not found)"
            ))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(index: u32, binary: Option<&str>, app: Option<&str>, corked: bool) -> SinkInputMeta {
        SinkInputMeta {
            index,
            binary: binary.map(Into::into),
            app_name: app.map(Into::into),
            stream_name: "Playback Stream".into(),
            corked,
        }
    }

    #[test]
    fn prop_string_trims_nul_and_rejects_empty() {
        assert_eq!(prop_string(Some(b"firefox\0")), Some("firefox".into()));
        assert_eq!(prop_string(Some(b"firefox")), Some("firefox".into()));
        assert_eq!(prop_string(Some(b"\0")), None);
        assert_eq!(prop_string(Some(b"  \0")), None);
        assert_eq!(prop_string(None), None);
    }

    #[test]
    fn program_name_prefers_binary_then_app_name_then_stream() {
        assert_eq!(
            program_name(&input(1, Some("firefox"), Some("Firefox"), false)),
            "firefox"
        );
        assert_eq!(
            program_name(&input(1, None, Some("Firefox"), false)),
            "Firefox"
        );
        assert_eq!(
            program_name(&input(1, None, None, false)),
            "Playback Stream"
        );
    }

    #[test]
    fn streams_of_one_program_are_grouped_and_sorted() {
        let inputs = [
            input(9, Some("vlc"), None, false),
            input(7, Some("firefox"), None, true),
            input(5, Some("firefox"), None, false),
            input(3, Some("firefox"), None, false),
        ];
        let apps = group_by_program(&inputs);
        assert_eq!(
            apps,
            vec![
                AppAudio {
                    id: 3,
                    name: "firefox".into()
                },
                AppAudio {
                    id: 9,
                    name: "vlc".into()
                },
            ]
        );
    }

    #[test]
    fn a_playing_stream_wins_over_a_corked_one() {
        let inputs = [
            input(1, Some("mpv"), None, true),
            input(4, Some("mpv"), None, false),
        ];
        assert_eq!(group_by_program(&inputs)[0].id, 4);
        assert!(group_by_program(&[]).is_empty());
    }

    #[test]
    fn resolve_picks_the_exact_id() {
        let inputs = [
            input(2, Some("a"), None, false),
            input(6, Some("b"), None, false),
        ];
        assert_eq!(resolve_input(&inputs, 6, "b").unwrap(), 6);
    }

    #[test]
    fn resolve_falls_back_to_the_same_program() {
        let inputs = [
            input(8, Some("b"), None, true),
            input(10, Some("b"), None, false),
        ];
        assert_eq!(resolve_input(&inputs, 6, "b").unwrap(), 10);
    }

    #[test]
    fn resolve_reports_a_missing_application() {
        let inputs = [input(2, Some("a"), None, false)];
        let err = resolve_input(&inputs, 6, "b").unwrap_err().to_string();
        assert!(err.contains("\"b\""), "{err}");
    }
}
