# Design

## Contexto

`tr-models` descarga a `<dir>/<id>/<archivo>.part` y renombra tras verificar SHA-256; cualquier fallo borraba el parcial. `Models` (tr-engine) es independiente del `Engine` y lo expone `tr-bindings` como promesas en el pool de libuv. La app guarda ajustes con `SettingsStore` (versión 1, campos con valor por defecto si faltan).

## Decisiones

1. **Reanudar descargas.** El `.part` se conserva cuando la descarga se cancela o la red falla; se descarta si el SHA-256 no coincide, si excede el tamaño o si el servidor responde 416. Al reanudar se hashea lo ya descargado, se pide `Range: bytes=N-` y solo se añade al parcial si la respuesta es `206` con `Content-Range` que empieza en `N`; con `200` se reinicia desde cero. La URL está fijada por commit, por eso no hace falta `If-Range`; la huella final lo comprueba todo. El progreso incluye los bytes ya descargados.
2. **Borrado seguro.** `ModelManager::delete(spec)` solo actúa sobre `<dir>/<spec.id>`: el id debe ser un único componente de ruta, el directorio no puede ser un enlace simbólico, se borran únicamente los archivos del manifiesto (y sus `.part`) y la carpeta del modelo solo si queda vacía. Se rechaza con el modelo descargándose. Los ids vienen del manifiesto, nunca de una ruta del renderer. `tr-bindings` rechaza el borrado si el motor tiene una sesión en marcha, y la app lo bloquea antes (defensa en profundidad).
3. **Carpeta de modelos.** `validate_dir` exige ruta absoluta sin `..`, que no sea la raíz, que exista como carpeta o cuyo ancestro existente sea carpeta, y que se pueda escribir (archivo de prueba creado y borrado dentro de ella). La app valida antes de guardar `modelsDir`. Los modelos del directorio anterior no se mueven ni se borran: se informa al usuario.
4. **Inventario.** `Models::inventory()` devuelve por modelo: rol (`ocr`, `stt`, `translate`), claves (idiomas o par), estado, tamaño esperado y bytes en disco/parciales (solo metadatos; el estado usa la caché de huellas). El total es la suma en disco.
5. **Manifiesto.** Solo pares cuyo repositorio Xenova existe y cuyas cinco piezas se descargaron para medir SHA-256 y tamaño; `en-pt`/`es-pt` no existen en Xenova y se omiten (no se inventan). El adaptador no cambia: los modelos comparten `vocab.json`.
6. **Rendimiento (puente con 5A).** `EngineOptions.performance { intraThreads?, beamWidth?, cacheCapacity? }` se valida en bindings (rangos); `cacheCapacity` ya alimenta `EngineConfig.cache_capacity` e `intraThreads`/`beamWidth` quedan en `EngineConfig.performance` (opcional). Si el motor no los consume se ignoran. En la app, `0` significa "automático/por defecto" y no se envía.
7. **Ajustes.** Se añaden `overlay.textColor`, `overlay.backgroundColor`, `overlay.maxLines` y la sección `performance`, todos con valor por defecto si faltan (sin subir `SETTINGS_VERSION`). El contraste texto/fondo mínimo es 4,5:1 (WCAG AA) calculado sobre el fondo opaco; una combinación peor se rechaza. Importar/exportar es un JSON con la forma del archivo de ajustes, **sin** `lastRegion` ni rutas (`modelsDir`), y se valida con `parseSettings` (todo o nada: con avisos no se importa). El archivo lo lee/escribe el proceso principal tras un diálogo nativo (en pruebas, por ruta inyectada).
8. **Pestañas accesibles.** Patrón WAI-ARIA tabs (`role=tablist/tab/tabpanel`, flechas, Inicio/Fin, `aria-selected`, `tabindex` rodante), `aria-live` para avisos, errores junto al campo con `aria-describedby`/`aria-invalid`, `prefers-color-scheme` con `color-scheme: light dark`.
9. **Overlay arrastrable.** El overlay es atravesable e infocable. "Mover overlay" (botón en Ajustes) lo hace interactivo temporalmente (`setIgnoreMouseEvents(false)`) con un asa de arrastre; al soltar se guarda `placement: manual` y la posición. Al terminar vuelve a ser atravesable. Alternativa descartada: `-webkit-app-region`, que no combina bien con ventanas excluidas de captura.
10. **Límite de líneas.** `maxLines` (1 a 6) limita la traducción con `-webkit-line-clamp` y fija la altura de la ventana.

## Riesgos

- La reanudación depende de que el servidor soporte `Range`; si no, se reinicia (correcto, más lento).
- Un parcial abandonado ocupa espacio: aparece en el inventario como "parcial" y se borra con el modelo.
- El contraste se calcula contra el color de fondo opaco; con opacidad baja sobre un escritorio claro puede ser peor. La interfaz lo avisa.
