# Rendimiento con uno y dos destinos

Mediciones del cambio OpenSpec `idiomas-y-subtitulos-multiples`. Decisiones en `docs/adr/0009-subtitulos-multiples.md`. La herramienta solo imprime números (ni textos ni traducciones salen a consola o a disco).

## Qué se midió

Cuánto tarda en estar lista la traducción de una frase según los destinos:

- `one`: un destino (`en -> es`).
- `serial`: dos destinos (`en -> es` y `en -> fr`) uno tras otro.
- `parallel`: los mismos dos destinos a la vez (`tr_core::translate::translate_all`, lo que usa el motor).

## Cómo reproducirlo

```bash
cargo run --release -p tr-models --example fetch -- <carpeta> en fr        # una vez: el par en->fr (en->es ya suele estar)
TR_MODELS_DIR=<carpeta> cargo run --release -p tr-adapters --example perf_targets -- <one|serial|parallel>
```

Variables opcionales: `TR_THREADS` (hilos de ONNX por sesión; 0 = automático, que para la traducción son 2), `TR_BEAMS`, `TR_REPS` (7 por defecto). Cada escenario corre en su propio proceso; la memoria es el pico del conjunto de trabajo del proceso.

Entorno: Windows 10, AMD Ryzen 5 4500 (6 núcleos, 12 hilos), build `release`, haz 1, modelos cuantizados `opus-mt` (`en-es`, `en-fr`), 4 frases fijas de 21, 70, 118 y 205 caracteres, mediana de 7 repeticiones.

## Resultados (hilos automáticos)

| Escenario | 21 car. | 70 car. | 118 car. | 205 car. | Media de medianas | Pico de memoria |
|---|---|---|---|---|---|---|
| un destino | 186 ms | 395 ms | 577 ms | 892 ms | **513 ms** | 503 MiB |
| dos destinos en serie | 313 ms | 744 ms | 1430 ms | 1984 ms | **1118 ms** | 833 MiB |
| dos destinos en paralelo | 338 ms | 739 ms | 1458 ms | 1815 ms | **1087 ms** | 948 MiB |

Con `TR_THREADS=1`: un destino 549 ms, serie 1129 ms, paralelo 1021 ms. Con `TR_THREADS=2`: 536, 1081 y 1068 ms.

## Hallazgo: el paralelo no gana aquí, y no es culpa del paralelismo

En esta máquina las dos traducciones a la vez tardan lo mismo que en serie (1087 ms frente a 1118 ms). Controles:

- Dos **procesos** independientes de `one` a la vez tardan **1142 ms cada uno** frente a 549 ms solos: el doble. Sin compartir nada, dos inferencias simultáneas se frenan entre sí.
- Un bucle de CPU puro escala bien (1 proceso 688 ms; 2 a la vez 683 y 688 ms; 4 a la vez ~720 ms): no faltan núcleos.
- Pasar de 1 a 2 hilos por sesión no cambia nada (549 frente a 536 ms): el decodificador va limitado por el acceso a memoria (cada paso lee los pesos del modelo, y 2 x 110 MB no caben en la caché), no por cálculo.

Conclusión: el cuello de botella es el **ancho de banda de memoria**. El paralelo no empeora (mismo tiempo, algo más de RAM pico) y ganaría en equipos con más ancho de banda, así que se mantiene como pidió el usuario; pero en un equipo como este dos destinos cuestan lo que dos traducciones seguidas.

## Frente a los presupuestos de `hito-5.md`

El presupuesto de latencia de texto (frame con texto -> traducción) es de 600 ms con un destino. Con las frases de esta medición (más largas que un subtítulo típico) un destino ya queda en 186-892 ms solo en traducir; con dos destinos, 313-1984 ms. Para frases de subtítulo de unas 20-70 letras, dos destinos cuestan entre ~340 y ~750 ms de traducción más el OCR y los dos frames estables.

## Qué haría falta si no basta

- **Mostrar por etapas**: emitir el original en cuanto el OCR lo lee y cada traducción cuando termina (hoy se emite un solo evento por frase, con todas). En una máquina limitada por memoria, el original aparecería en cuanto el texto se estabiliza y la primera traducción tras el tiempo de una sola (~0,5 s en estas medidas) en vez de esperar a las dos (~1,1 s). Está fuera de esta change (ver `design.md`, Non-Goals).
- Un decodificador con menos lectura de memoria por paso (pesos más pequeños) o un único modelo multilingüe.
- Ejecución en GPU (anotada como mejora futura en `design.md`), que tiene su propio ancho de banda.
