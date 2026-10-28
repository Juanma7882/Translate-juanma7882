# Tasks

## 1. tr-models

- [x] 1.1 Descargas reanudables con `Range` (conservar `.part` al cancelar/cortar red, 206/200/416, SHA-256 final) y servidor de pruebas con `Range`, con tests de fallos
- [x] 1.2 Uso de disco por modelo (bytes finales y parciales) y borrado seguro (solo dentro de la carpeta, enlaces simbólicos, ids inválidos, descarga en curso), con tests
- [x] 1.3 `validate_dir` (absoluta, sin `..`, carpeta o ancestro escribible) con tests
- [x] 1.4 Descripción de modelos en el manifiesto (rol y claves) y listado

## 2. Manifiesto

- [x] 2.1 Descargar y medir SHA-256/tamaño de los pares nuevos desde Hugging Face con URL fijada por commit
- [x] 2.2 Añadirlos a `models.json` y validar el manifiesto con tests
- [x] 2.3 Prueba real ignorada: una frase por par nuevo con el motor de traducción

## 3. tr-engine y bindings

- [x] 3.1 `Models`: inventario, borrado, cancelación y validación de carpeta; tests contra servidor local
- [x] 3.2 `EngineConfig.performance` y `EngineOptions.performance` validado en bindings
- [x] 3.3 napi: `modelInventory`, `deleteModel` (rechazado con sesión en marcha), `cancelModelDownload`, `validateModelsDir`; `api.js`, `index.d.ts`
- [x] 3.4 Tests de Node: inventario, borrado, cancelación, reanudación contra servidor local con Range y fallos, rendimiento inválido

## 4. App (main y compartido)

- [x] 4.1 Ajustes: `overlay.textColor/backgroundColor/maxLines` con contraste mínimo, `performance`, exportación/importación sin contenido; tests
- [x] 4.2 Protocolo, IPC, preload y `ModelsService`: inventario, borrar, cancelar, validar carpeta, elegir carpeta, importar/exportar, restablecer
- [x] 4.3 `engineOptionsFrom` con `performance`
- [x] 4.4 Overlay: colores, líneas, modo mover arrastrable; tests de lógica pura

## 5. Interfaz de Ajustes

- [x] 5.1 Pestañas accesibles, validación en línea, `aria-live`, tema claro/oscuro, mensajes en español
- [x] 5.2 Pestaña de modelos: espacio, borrar, cancelar, reanudar, carpeta
- [x] 5.3 Apariencia: colores/contraste, líneas, mover overlay; Avanzado: rendimiento, restablecer, importar/exportar
- [x] 5.4 Pruebas de lógica pura (`form.ts`)

## 6. Smokes y validación

- [x] 6.1 Ampliar smokes `settings`, `shell`, `overlay` y `windows`
- [x] 6.2 Smoke de descargas contra servidor HTTP local con Range y fallos (cancelar, reanudar, borrar)
- [x] 6.3 Escribir `docs/adr/0007-gestion-modelos.md` y `docs/validation/windows-hito-5.md`
- [x] 6.4 Verificar fmt, clippy, tests de Rust, tests de Node, typecheck, build y los smokes
- [x] 6.5 Guardar decisiones en Engram y editar `CLAUDE.md` mínimamente
