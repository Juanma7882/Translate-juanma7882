# Design

## Context

- Los eventos finales ya llegan al proceso principal: `AppController.onEngineEvent` recibe `translation` (modo texto, siempre final) y `subtitle` (audio, con `isFinal`) con `original` y `translations[]` (`lang`, `text`). El controlador los reemite como `'text'` hacia el overlay.
- El motor (Rust) no escribe contenido a disco y tiene guardas (`no_content_leaks`, lints `print_*`, `disallowed-methods`). La única escritura desde JS es `SettingsStore` (JSON atómico de preferencias).
- `electron-shell.ts` ya abre diálogos de carpeta (`pickFolder`) y `settings-ipc.ts` valida `modelsDir` antes de aceptarlo; `AppShell` recibe bandeja, atajos y notificaciones por inyección.
- Regla nº 1 de `CLAUDE.md`: todo en RAM. Este cambio la enmienda (ver proposal.md).

## Goals / Non-Goals

**Goals:**
- Escribir la transcripción solo desde el proceso principal, sin tocar el núcleo Rust.
- Mantener intacta la garantía «nada a disco» cuando el interruptor está apagado, y que eso sea comprobable con tests.
- Escritura que no bloquee el bucle de eventos de main ni retrase el overlay.

**Non-Goals:**
- Visor/buscador de transcripciones dentro de la app, edición, o subida a la nube.
- Guardar el audio o las capturas (sigue prohibido).
- Recuperar líneas anteriores a la activación a mitad de sesión.
- Cifrado de los archivos (la carpeta y su protección son decisión del usuario).

## Decisions

### 1. El escritor vive en main, no en Rust
Nuevo módulo `app/src/main/transcript-writer.ts` (`TranscriptWriter`), suscrito a los eventos que ya maneja `AppController`. El texto ya cruza a main para el overlay; escribirlo desde ahí evita un nuevo puerto/adaptador, un nuevo comando napi y relajar `no_content_leaks` en el núcleo.
*Alternativa descartada:* adaptador `TranscriptSink` en Rust. Más coherente con el patrón adapter, pero obliga a pasar rutas al motor (los puertos «pasan buffers, no rutas») y a abrir excepciones en las guardas del núcleo por algo trivial de E/S.

### 2. Escritura asíncrona y en orden con un `WriteStream` por archivo
`fs.createWriteStream(path, { flags: 'wx' })` (`wx` falla si existe → no sobrescribe; se reintenta con sufijo `-2`, `-3`…). Los `write()` se encolan en orden sin bloquear; el evento `'error'` dispara el manejo de fallos. Al detener/desactivar: `end()` y se espera `'finish'` antes de dar la sesión por cerrada (para el escenario «archivos completos al detener»).
*Alternativa:* `appendFile` por línea: abre/cierra cada vez y pierde el orden ante escrituras concurrentes.

### 3. Formato puro y testeable aparte
`app/src/shared/transcript-format.ts` con funciones puras: `formatTxtEntry`, `formatSrtEntry`, `srtTime`, `sessionFileName`. El `.txt` usa bloques:
```
[00:01:23] [en] Good morning
           [es] Buenos días
```
El `.srt` necesita el fin de cada entrada = inicio de la siguiente (acotado a [1 s, 7 s]); por eso el escritor retiene **una** entrada pendiente y la emite al llegar la siguiente o al cerrar (fin = inicio + 7 s acotado). Retrasar el `.srt` una línea no afecta al `.txt`, que se escribe al instante.

### 4. Reloj de la sesión en main
La hora relativa se mide con `performance.now()` desde que `AppController` arranca la sesión (no `timestampMs` del motor: en modo texto y audio vienen de relojes distintos y en el fallback se mezclan). Pausas cuentan como tiempo transcurrido (la hora es de pared relativa al inicio).

### 5. Deduplicación en modo texto
Se omite una línea si su `original` normalizado (trim + espacios colapsados) es igual al de la última guardada. Aplica a ambos modos; en audio no se dan repeticiones exactas consecutivas legítimas en la práctica y evita ruido.

### 6. Ajustes
`Settings.transcript = { enabled: boolean; dir: string | null; srt: boolean }`, por defecto `{ false, null, true }`. Validación en `parseSettings`/`applyPatch`: `enabled: true` exige `dir` no nulo. `settings-ipc` valida la carpeta (absoluta, existe, escribible con una prueba de `access(W_OK)`) como hace con `modelsDir`, y `transcriptPickDir` reutiliza `pickFolder` con otro título. `reset()` conserva `transcript.dir` y pone `enabled: false`. Exportar omite `transcript`; importar ignora la clave si aparece.
Se mantiene `SETTINGS_VERSION = 1`: la clave es opcional al leer y toma el valor por defecto si falta.

### 7. Activación en vivo, errores e indicador
`TranscriptWriter` observa `settings.onChange` y el estado de sesión (que le pasa `bindTranscript` desde los eventos `state`/`text` de `AppController`, cableado en `AppShell`): abre archivos si `enabled && running`, cierra si deja de cumplirse; un cierre espera a la apertura en curso para no perder las líneas en cola. Ante un error de escritura: cierra, marca `failed` (no reabre hasta la siguiente sesión aunque siga `enabled`) y emite `failed`; `AppShell` lo convierte en aviso (`noticeForTranscriptFailure`, sin contenido ni ruta) por `AppController.notify`. El escritor expone `saving: boolean` (evento y getter), que `AppShell` envía al overlay (pequeño punto rojo + «Guardando transcripción», accesible con `aria-label`) y al menú de bandeja (casilla «Guardar transcripción», deshabilitada sin carpeta, con tooltip).

### 8. Guardas
- Test `transcript-no-write.test.ts`: con `enabled: false`, una sesión con eventos falsos no crea archivos en una carpeta temporal; con `true` crea exactamente el par esperado.
- `TranscriptWriter` es el único módulo de main que puede escribir contenido; un test busca `createWriteStream|appendFile|writeFile` en `app/src/main` y solo admite `settings-store.ts` y `transcript-writer.ts` (más smokes).
- Nunca se loguea el texto ni la ruta completa de la carpeta.

### 9. Enmienda documental
`docs/adr/0011-guardar-transcripcion.md` (contexto, decisión, consecuencias, alternativas 1 y «RAM + exportar»). Regla 1 de `CLAUDE.md` pasa a: «Todo en RAM: nunca escribir capturas, audio, texto ni traducciones a disco (solo modelos, config y, si el usuario lo activa, la transcripción en la carpeta que eligió; ver ADR 0011)».

## Risks / Trade-offs

- [El contenido queda en disco en claro mientras se guarda] → opt-in, desactivado por defecto, indicador permanente, excluido de export/import y reset lo apaga.
- [Cierre inesperado de la app] → el `.txt` tiene todo lo escrito hasta el último `write` vaciado; el `.srt` puede perder la última entrada pendiente. Aceptable: el `.txt` es la fuente fiable.
- [Disco lento bloqueando main] → escritura asíncrona con streams; si el buffer interno crece (`write()` devuelve `false`) se sigue encolando: el volumen es de texto y mínimo.
- [Ruido en modo texto con OCR inestable (pequeñas variaciones)] → solo se deduplica igualdad exacta normalizada; variaciones reales se guardan. Se puede refinar más adelante sin cambiar la spec.
- [Rompe la regla nº 1 tal como está escrita] → se reescribe la regla y se documenta en el ADR antes de implementar.

## Migration Plan

Sin migración: el ajuste nuevo toma su valor por defecto en archivos existentes. Revertir = quitar el módulo y la clave (los archivos que el usuario ya guardó son suyos y no se tocan).
