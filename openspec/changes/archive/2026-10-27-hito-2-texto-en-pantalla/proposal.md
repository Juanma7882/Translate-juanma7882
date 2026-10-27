# Proposal

## Why

El Hito 1 dejó el esqueleto probado solo con motores de demostración. Para que la app sirva de verdad hay que reemplazarlos por motores reales (captura de pantalla, OCR y traducción), gestionar los modelos que esos motores necesitan y darle al usuario la interfaz del producto: elegir una región, ver original y traducción encima del juego o la serie, y ajustar el comportamiento. Es el hito que convierte el esqueleto en un traductor utilizable para texto en pantalla.

## What Changes

- **Adaptadores reales** en un nuevo crate `tr-adapters`, cada uno tras su feature flag y sin tocar `tr-core`:
  - `ScreenCapture` con `xcap` (captura de región; X11/Windows/macOS).
  - `OcrEngine` con PaddleOCR sobre ONNX Runtime (`ort`) mediante `oar-ocr`, con soporte de alfabeto latino y de japonés/chino/coreano según el conjunto de modelos.
  - `Translator` con Opus-MT en ONNX (`ort` con tokenizador SentencePiece propio), por par de idiomas.
- **Gestión de modelos** en un nuevo crate `tr-models`: manifiesto de modelos, descarga en el primer uso con progreso y verificación SHA-256, y estado de cada modelo. Es el único crate autorizado a escribir a disco (modelos), y emite `onModelProgress`.
- **Composición** en `tr-engine`: nuevo conjunto de motores `Real`, elegido por configuración, junto al de demostración.
- **API de JS**: `configure` acepta conjunto de motores y carpeta de modelos; nuevos comandos para pausar/reanudar y para consultar/descargar modelos.
- **Interfaz de producto** (electron-vite, según ADR 0001): selector de región a pantalla completa que recuerda la última región, overlay transparente siempre encima y click-through con original y traducción configurables, ventana de Ajustes con Preact, icono de bandeja y atajos globales, y persistencia de ajustes.
- **BREAKING** (interno): el requisito "Sin ventanas de producto" del shell mínimo deja de aplicar.
- Fuera de alcance: audio real (Hito 3), conexión del fallback a motores reales y expuesto de atajo "cambiar modo" funcional (Hito 4), medición de rendimiento (Hito 5), empaquetado y firma (Hito 6), GPU, y validación en Windows/macOS (se entrega una lista de verificación para Windows; ver design.md).

## Capabilities

### New Capabilities
- `model-management`: manifiesto, descarga con progreso, verificación de integridad y estado de los modelos locales.
- `screen-capture`: captura de una región de pantalla en memoria con un motor real.
- `ocr-recognition`: reconocimiento de texto de un frame con un motor real y selección de modelos por idioma.
- `text-translation`: traducción de texto entre un par de idiomas con un motor local real.
- `engine-composition`: selección de motores reales o de demostración por configuración y preparación de los modelos necesarios.
- `region-selector`: ventana para elegir la región de pantalla, con recuerdo de la última.
- `translation-overlay`: ventana transparente que muestra original y traducción sin estorbar la interacción.
- `settings-window`: ventana de ajustes de idiomas, motores, overlay y modelos.
- `app-integration`: bandeja, atajos globales, persistencia de ajustes y flujo de primer uso.

### Modified Capabilities
- `js-bridge`: la configuración del motor incorpora conjunto de motores y carpeta de modelos; se agregan pausa/reanudación y comandos de modelos.
- `desktop-shell`: se retira la restricción de "sin ventanas de producto" y se exige verificar el flujo con motores reales.

## Impact

- Código nuevo: `crates/tr-adapters`, `crates/tr-models`, cambios en `tr-engine` y `tr-bindings`; en `app/`: renderers (selector, overlay, ajustes), preload, gestor de ventanas, bandeja, atajos y almacén de ajustes.
- Dependencias (versiones y mantenimiento verificados el 2026-10-27, ver design.md): `xcap` 0.9.8, `ort` 2.0.0-rc.13 (fijada por `oar-ocr`), `oar-ocr` 0.10.2, `sentencepiece-model` y `spm_precompiled` (tokenizador Marian), `ureq` 3.5.0, `sha2` 0.11.1, `serde`/`serde_json`, `image`; en JS, Preact y su preset de Vite.
- Entorno: `rust-version` sube (oar-ocr exige 1.95). En Linux `xcap` exige paquetes de desarrollo del sistema (requiere `sudo`, ver tareas). Los modelos (~100–300 MB) se descargan en el primer uso y no se versionan.
- Regla transversal intacta: ninguna captura, texto ni traducción se escribe a disco ni a logs; solo modelos y ajustes del usuario.
