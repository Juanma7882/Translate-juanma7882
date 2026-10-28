# ADR 0010 — Mantener la traducción mientras el texto no cambie

- Estado: aceptado
- Cambio OpenSpec: `mantener-traduccion-estable`

## Contexto

En modo texto la traducción se ocultaba a los `hideAfterMs` aunque el texto de la región siguiera igual (el `Stabilizer` solo emite al cambiar el texto), y en el modo automático pausar y reanudar reseteaba el `Stabilizer`, de modo que el mismo texto se volvía a emitir y el overlay parpadeaba.

## Decisiones

1. **Un ajuste, `overlay.keepWhileUnchanged` (por defecto desactivado)**, leído por dos mitades: el overlay (no oculta por tiempo) y el motor (`EngineOptions.keepTranslation`, no resetea al reanudar).
2. **`Event::TextCleared` sin campos**, emitido una vez al pasar de texto traducido a región vacía, solo mientras se traduce (en audio no borra los subtítulos). No lleva contenido.
3. **Overlay**: con el ajuste y en modo texto, `OverlayController` envía `hideAfterMs = 0` al renderer (que ya trata 0 como «no ocultar») y retira el texto con `clear` al llegar `textCleared`. En audio y fuera de sesión vale el tiempo configurado.
4. **Reanudar**: `RegionProcessor::resume_after_pause` conserva lo emitido solo de pausa a texto. El paso de audio a texto sigue reseteando, porque el overlay se borra al cambiar de modo.
5. **El ajuste del overlay se aplica en vivo; el del motor, en la próxima sesión** (las opciones del motor se aplican al arrancar).

## Consecuencias

- API de los bindings: `onTextCleared` y `EngineOptions.keepTranslation` (aditivos).
- Si el OCR no detecta que el texto desapareció (ruido), la traducción se queda hasta que cambie; basta desactivar el ajuste.
