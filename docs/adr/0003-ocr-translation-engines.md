# ADR 0003 — Motores de OCR y traducción

- Estado: aceptado
- Fecha: 2026-10-27
- Contexto: Hito 2 (`openspec/changes/hito-2-texto-en-pantalla`). Medido en WSL (Ubuntu 24.04), CPU, 4 hilos de ONNX Runtime, binarios `--release`.

## Decisión

| Pieza | Elección |
|---|---|
| Runtime ML | `ort` **=2.0.0-rc.13** (lo fija `oar-ocr`), ONNX Runtime descargado en el build |
| OCR | PaddleOCR **PP-OCRv6 small** (`oar-ocr` 0.10.2), modelos cargados desde memoria |
| Traducción | Opus-MT (Marian) ONNX **int8** de `Xenova/opus-mt-<par>`, decoder sin caché, decodificación voraz acotada |
| Tokenización | SentencePiece propio: `sentencepiece-model` + `spm_precompiled` + Viterbi Unigram; ids de `vocab.json` |
| Captura | `xcap` 0.9.8 (`capture_region`) |

Se descartaron: Tesseract (crate poco mantenido, librerías del sistema), `ocrs` (solo alfabeto latino; queda como respaldo), `ct2rs` (compila C++ y exige `cmake`), `tokenizers` (ver "Hallazgos").

## Features de Cargo (importante)

`oar-ocr` con sus defaults activa `ort/tls-native`, que arrastra `openssl-sys` y exige `libssl-dev` solo para compilar en Linux. Se evita así:

```toml
oar-ocr = { version = "=0.10.2", default-features = false, features = ["simd"] }
ort = { version = "=2.0.0-rc.13", default-features = false,
        features = ["std", "ndarray", "copy-dylibs", "download-binaries", "tls-rustls"] }
```

Compila sin paquetes del sistema adicionales. La descarga de modelos (`tr-models`) usa `ureq` con rustls, sin OpenSSL.

## Evidencia

### OCR — PP-OCRv6 small (det 9,4 MiB + rec 20,2 MiB + diccionario)

Carga de modelos: 144 ms. Mediana de 5 ejecuciones por imagen (generadas con Arial y Yu Gothic):

| Imagen | Resultado | Confianza | Latencia |
|---|---|---|---|
| "Hello world, this is a test." | exacto | 0,994 | 50 ms |
| "Where is the train station?" | exacto | 0,997 | 47 ms |
| "I will not let you down." (claro sobre oscuro) | exacto | 0,9997 | 49 ms |
| "こんにちは、世界" | exacto | 0,9999 | 44 ms |
| "駅はどこですか？" | exacto | 0,9999 | 44 ms |
| imagen sin texto | `[]` | — | 13 ms |

Un único modelo multilingüe cubre inglés y japonés (el diccionario v6 tiene 18 708 caracteres). Pendiente de medir: chino/coreano y texto con ruido real de juegos.

### Traducción — Opus-MT int8, decodificación voraz

Carga: ~0,3 s por par. Mediana de 3 ejecuciones.

| Origen | Resultado | Latencia |
|---|---|---|
| Hello, how are you? | Hola, ¿cómo estás? | 208 ms |
| Where is the train station? | ¿Dónde está la estación de tren? | 265 ms |
| I will not let you down. | No te decepcionaré. | 174 ms |
| Thank you very much for your help. | Muchas gracias por su ayuda. | 204 ms |
| The meeting has been moved to tomorrow morning. | La reunión se ha trasladado a mañana por la mañana. | 370 ms |
| ¿Dónde está la estación de tren? | Where's the train station? | 240 ms |
| Muchas gracias por tu ayuda. | Thank you so much for your help. | 260 ms |
| No te voy a decepcionar. | I'm not gonna let you down. | 296 ms |
| La reunión se ha cambiado para mañana por la mañana. | The meeting has been changed by tomorrow morning. | 296 ms |
| Me gustaría reservar una mesa para dos. | I'd like to set up a table for two. | 395 ms |

Latencia total esperada OCR + traducción para un subtítulo: ~0,3–0,5 s.

## Hallazgos que cambian el diseño

1. **El `tokenizer.json` de Xenova para Marian no es utilizable** con la crate `tokenizers` (normalizador `Precompiled` con `null`; es idéntico en todos los pares porque la tokenización real la hace transformers.js con los `.spm`). Se implementa el tokenizador Marian: normalización SentencePiece (`spm_precompiled`), segmentación Unigram por Viterbi con los puntajes de `source.spm`, y ids por `vocab.json` (con `</s>` = 0 al final de la entrada). Decodificar es concatenar piezas, `▁` → espacio.
2. **Entrada vacía o solo espacios alucina** (`">"`, una letra de canción): el adaptador debe devolver vacío **sin ejecutar el modelo**.
3. **El coste crece con la longitud** (492 caracteres ≈ 5 s): se acota la entrada (p. ej. ≤ 128 tokens) y la salida (`min(2·n + 10, 160)`).
4. El decoder sin caché recalcula toda la secuencia en cada paso; es suficiente para subtítulos. Optimización (KV-cache con `decoder_with_past`/merged) y beam search (el modelo trae `num_beams = 4`) quedan para el Hito 5.
5. Constantes de Marian en `config.json`: `decoder_start_token_id = pad = 65000`, `eos = 0`, `vocab_size = 65001`, `bad_words_ids = [[65000]]` (el id de inicio nunca se genera).

## Datos para el manifiesto

Repositorio de modelos OCR: `https://github.com/GreatV/oar-ocr/releases/download/v0.7.0/<archivo>`

| Archivo | Bytes | SHA-256 |
|---|---|---|
| pp-ocrv6_small_det.onnx | 9 880 512 | d73e0058b7a8086bbd57f3d10b8bcd4ff95363f67e06e2762b5e814fe9c9410e |
| pp-ocrv6_small_rec.onnx | 21 159 378 | 5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634 |
| ppocrv6_dict.txt | 74 947 | b5f2bfe2bdd9448429e3e82b51c789775d9b42f2403d082b00662eb77e401c5d |
| pp-ocrv6_tiny_det.onnx | 1 780 590 | 193bab7a04fca699a6c82e6abb5b81bdb28177f0abd4062552b04908dafb19f8 |
| pp-ocrv6_tiny_rec.onnx | 4 462 639 | 9ef676d6ed3c88256a2d92c640c44f25b0c40947e111b14b8be8f594091563e6 |
| ppocrv6_tiny_dict.txt | 27 156 | c5cbe34ef40c29c4df07ed012bf96569cb69a2d2a01a07027e9f13cb832bd9cd |

Modelos de traducción: `https://huggingface.co/Xenova/opus-mt-<par>/resolve/<revisión>/<archivo>` (revisión = commit, URL inmutable).

- `en-es` revisión `4b002a4c7edd54a7ced58877258b87f7efd3f892`
- `es-en` revisión `eadfd7c658a9d8929ac3b8e996b68a68e2c7d480`

| Archivo | Bytes | en-es SHA-256 | es-en SHA-256 |
|---|---|---|---|
| onnx/encoder_model_quantized.onnx | 52 899 742 | 03434edd1147e6c49e22066e9dc5888235e99cc35a6711d1c4ea5b06455d5da9 | c01e70f8455efc350831aa2af7ed187b16829241f0018ba07d1ba643a391bc18 |
| onnx/decoder_model_quantized.onnx | 59 842 102 | 2b45074cc819f1d901e40510d7bc0781d99327d16c7eca04518c4ee0c3d6ba10 | d518f1f0041b2831f0aeb5a087cf899742cd9d4b574f6b98ad9f816b8c06925b |
| source.spm | — | 4dd547c24816a335e7b0b2e63376a8f1b3cbfc671eda5ab808dd44fdadaa8791 | e236ee6d866b635c0142114f8647f39831f9d92534aa2aad75c942f6a78ad0e3 |
| vocab.json | 1 720 044 | b074b4cca0036ade5a39ea97faabd534e1015482c480fc2cb02c6481983eb163 | b074b4cca0036ade5a39ea97faabd534e1015482c480fc2cb02c6481983eb163 |
| config.json | — | 499eae1f97eeba63172fc884f92fd727ae803b7ceb79c0f653aa4b011152af2f | fab3a7f93185bc5aa7b419f6a1e6e74d98c8f2a506c94493d3019bf46da3478d |

(`target.spm` no hace falta: la decodificación usa `vocab.json`.) Tamaño total por par ≈ 115 MB; OCR small ≈ 31 MB.

## Consecuencias y riesgos

- `ort` sigue en RC y fijado en rc.13 por `oar-ocr`; se revisa al subir `oar-ocr`.
- `sentencepiece-model` (0.1.4, 2024) y `spm_precompiled` (0.1.4, 2022) son estables pero poco activos; `spm_precompiled` lo usa `tokenizers` de Hugging Face (15 M de descargas).
- Cada par Opus-MT es un modelo aparte (~115 MB): el catálogo de pares crece añadiendo entradas al manifiesto.
- La calidad del OCR sobre texto de juegos/series reales (fuentes decorativas, fondos ruidosos) no está medida; se evalúa en la validación de Windows y puede motivar PP-OCRv6 medium.
