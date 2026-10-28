# ADR 0007 — Gestión de modelos y ajustes de producto

- Estado: aceptado
- Fecha: 2026-10-27
- Contexto: Hito 5B (`openspec/changes/hito-5-modelos-ajustes`). Hasta el Hito 4 solo se podían descargar modelos; faltaba ver el espacio, borrar, cancelar y reanudar descargas, cambiar la carpeta, más idiomas, una ventana de Ajustes ordenada y accesible y un overlay personalizable. El Hito 5A (rendimiento) trabaja en paralelo sobre `tr-core` y `tr-adapters`.

## Decisión

| Tema | Elección |
|---|---|
| Quién toca el disco | Sigue siendo solo `tr-models`. Borrar, medir uso y validar carpetas viven ahí; JS y la interfaz solo envían identificadores del manifiesto, nunca rutas |
| Reanudar | `<archivo>.part` se conserva al cancelar o cortarse la red; se descarta si la huella o el tamaño no coinciden o si el servidor responde 416. Al reanudar se hashea lo descargado y se pide `Range: bytes=N-`; solo se añade si la respuesta es `206` con `Content-Range` que empieza en `N` (con `200` se reinicia). La huella SHA-256 final lo verifica todo; la URL fijada por commit evita `If-Range` |
| Borrado | `ModelManager::delete`: id de un solo componente de ruta, carpeta del modelo que no sea enlace simbólico y esté dentro de la carpeta de modelos (canonicalizada), solo los archivos del manifiesto y sus `.part`, y la carpeta del modelo solo si queda vacía. Se rechaza si el modelo se está descargando |
| Nunca durante una sesión | `tr-bindings::deleteModel` rechaza si el motor tiene una sesión en marcha; la app lo bloquea antes (botones desactivados, `ModelsService` y el IPC de carpeta) |
| Carpeta de modelos | `validate_dir`: absoluta, sin `..`/`.`, no la raíz, existente o creable bajo una carpeta, con prueba de escritura (archivo vacío creado y borrado). Antes de guardar `modelsDir` el proceso principal valida con el motor; el motivo vuelve como código (`not-writable`...) y la interfaz lo traduce. Los modelos de la carpeta anterior no se mueven ni se borran |
| Inventario | `Models::inventory()`: por modelo, roles (OCR/voz/traducción + idiomas o par), estado, tamaño esperado y bytes en disco/parciales (solo metadatos) |
| Manifiesto | +8 modelos Opus-MT cuantizados de Xenova (en<->fr, en<->de, en<->it, es<->fr), con URL fijada por commit, tamaño y SHA-256 medidos descargando cada archivo. `en-pt`, `es-pt` y `en-ja` no existen en Xenova y no se añaden. Todos traducen una frase real (`tr-engine/tests/real_pairs.rs`) |
| Rendimiento (puente con 5A) | `EngineOptions.performance { intraThreads, beamWidth, cacheCapacity }` validado en bindings (1-64, 1-8, 1-1 000 000). `cacheCapacity` ya alimenta `EngineConfig.cache_capacity`; `intraThreads` y `beamWidth` quedan en `EngineConfig.performance` (`PerformanceConfig`, `None` = defecto) para que los adaptadores los consuman. En los ajustes `0` = automático y no se envía |
| Ajustes | Se añaden `overlay.textColor/backgroundColor/maxLines` y `performance` con valores por defecto si faltan (sin subir `SETTINGS_VERSION`). Contraste mínimo 4,5:1 (WCAG AA) validado en `parseSettings`: una combinación peor se rechaza |
| Importar/exportar | JSON `{format, version, settings}` sin `lastRegion`, `modelsDir` ni `version` interna. La importación es todo o nada (`parseSettings` sin avisos, sin campos desconocidos ni locales, ≤ 64 KB). Restablecer conserva región y carpeta |
| Interfaz | Pestañas WAI-ARIA (General, Modelos, Apariencia, Atajos, Avanzado), paneles siempre en el documento pero ocultos, errores junto al campo (`aria-invalid`, `aria-describedby`), regiones `aria-live`, tema por `prefers-color-scheme` con tokens verificados por un test de contraste |
| Mover el overlay | Modo temporal: `setIgnoreMouseEvents(false)`, asa y botón «Listo»; el renderer envía solo el desplazamiento de pantalla (`screenX/Y`) y main lo ajusta a una caja que mantiene 48 px visibles; al terminar guarda `placement: manual` y vuelve a ser atravesable. Si el overlay se abrió solo para moverlo se cierra al terminar |

## Por qué

- **Ids y no rutas**: el único dato que cruza hacia el borrado es un identificador que debe existir en el manifiesto; así una interfaz comprometida no puede pedir borrar fuera de la carpeta de modelos.
- **Conservar el parcial**: una descarga de 60 MB interrumpida no debe empezar de cero; es seguro porque nada de un `.part` se considera válido y el SHA-256 final cubre cualquier corrupción.
- **Contraste sobre el color opaco**: el fondo del overlay es translúcido y el escritorio es desconocido; se valida el caso razonable y se avisa en la interfaz del límite.
- **`0` = automático** evita un tipo opcional en la interfaz y deja que 5A decida los valores por defecto sin tocar los ajustes de los usuarios.

## Alternativas descartadas

- `-webkit-app-region: drag` para mover el overlay: no se comporta igual en ventanas excluidas de la captura ni en Linux, y no se puede probar sin ratón real.
- Mover automáticamente los modelos al cambiar de carpeta: operación larga y destructiva si falla; se prefiere avisar y dejar el control al usuario.
- Borrar el parcial siempre que falle algo: obliga a empezar de cero tras cada corte de red.
- Usar `window.confirm` para confirmar borrados: bloquea el renderer y no se puede automatizar; se usa una confirmación en línea.

## Consecuencias

- Un parcial abandonado ocupa espacio: aparece en "Modelos instalados" y se borra con el modelo.
- La reanudación solo ahorra transferencia si el servidor admite `Range` (Hugging Face y GitHub lo hacen); si no, se reinicia y sigue siendo correcto.
- `PerformanceConfig` y `performance` en bindings son un punto de enganche: hasta que 5A consuma `intraThreads` y `beamWidth` esos dos valores no tienen efecto.
