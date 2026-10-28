# Spec Delta

## Purpose

Mostrar al usuario, en tiempo real, el nivel del audio que se está capturando y si es suficiente para ser reconocido como voz, para diagnosticar capturas en silencio o con volumen bajo.

## ADDED Requirements

### Requirement: Nivel del audio capturado
Mientras haya captura de audio, el motor SHALL emitir el nivel (RMS normalizado de 0 a 1 y pico) de cada ventana de unos 100 ms como un número, sin incluir audio ni texto.

#### Scenario: Audio sonando
- **WHEN** la captura está activa y suena audio
- **THEN** el motor emite niveles con valores mayores que cero a un ritmo de al menos 5 por segundo

#### Scenario: Captura detenida
- **WHEN** se detiene o se pausa la sesión
- **THEN** la sesión deja de emitir niveles y la interfaz muestra el medidor en cero hasta que la escucha previa, si procede, vuelva a medir la fuente

### Requirement: Barra de nivel en la interfaz
La ventana principal SHALL mostrar una barra con el nivel actual, que sube de inmediato y baja de forma suave, con una marca en el umbral de voz. La barra MUST tener una alternativa de texto accesible con el nivel en porcentaje.

#### Scenario: Nivel por encima del umbral
- **WHEN** el nivel supera el umbral de voz
- **THEN** la barra pasa la marca y se muestra como voz detectable

#### Scenario: Nivel bajo el umbral
- **WHEN** hay señal pero se mantiene por debajo del umbral de voz durante varios segundos
- **THEN** la interfaz avisa de que el audio llega demasiado bajo y sugiere subir el volumen

#### Scenario: Sin señal
- **WHEN** la captura (de una sesión o de la escucha previa) está activa y el nivel es cero durante varios segundos
- **THEN** la interfaz indica que no llega audio de la fuente elegida

### Requirement: Escucha previa del nivel
Mientras la pestaña Inicio esté a la vista y no haya ninguna sesión, el motor SHALL abrir la fuente de audio elegida solo para medir su nivel y emitirlo igual que en una sesión, sin necesitar modelos, sin reconocer voz ni traducir y sin conservar el audio. La escucha MUST ceder en cuanto empiece una sesión, MUST NOT activarse en el modo «Solo texto» y MUST detenerse cuando Inicio deja de estar a la vista, la ventana se oculta o se cierra.

#### Scenario: Sin pulsar Iniciar
- **WHEN** el usuario abre Inicio con «Todo el sistema» elegido y suena audio
- **THEN** la barra se mueve con ese audio sin haber pulsado Iniciar

#### Scenario: Cambiar de fuente
- **WHEN** el usuario elige otra fuente en el selector
- **THEN** la escucha pasa a medir la fuente nueva en unos instantes y la barra deja de reflejar la anterior

#### Scenario: Empieza una sesión
- **WHEN** el usuario pulsa Iniciar con la escucha activa
- **THEN** la escucha se detiene antes de que la sesión abra su captura y la barra pasa a mostrar el nivel de la sesión

#### Scenario: Fin de la sesión
- **WHEN** la sesión se detiene y Inicio sigue a la vista
- **THEN** la escucha vuelve a medir la fuente elegida

#### Scenario: Solo texto
- **WHEN** el modo es «Solo texto»
- **THEN** no se abre ninguna captura de audio e Inicio explica que ese modo no usa el audio

#### Scenario: Fuera de vista
- **WHEN** el usuario cambia a otra pestaña, minimiza la ventana o la cierra
- **THEN** la escucha se detiene y no queda ninguna captura de audio abierta por la escucha

#### Scenario: Aplicación que no suena
- **WHEN** la fuente elegida es una aplicación que no está sonando
- **THEN** Inicio indica que espera a esa aplicación y la escucha empieza sola cuando suene

#### Scenario: Sin modelos
- **WHEN** no hay ningún modelo descargado
- **THEN** la escucha funciona igual que con los modelos instalados

#### Scenario: La fuente no se puede abrir
- **WHEN** la captura de la fuente falla, por ejemplo porque no hay dispositivo de salida
- **THEN** Inicio explica el motivo junto a la barra, sin mostrarlo como error de una sesión ni cambiar el estado de la sesión

#### Scenario: Solo números
- **WHEN** la escucha está activa
- **THEN** de la captura solo salen niveles numéricos: no se guarda audio, no se escribe a disco ni a registros y no llega al proceso de la interfaz

### Requirement: Medidor ligero
El envío del nivel a la interfaz SHALL agruparse a no más de 15 actualizaciones por segundo y MUST NOT bloquear la interfaz ni el motor.

#### Scenario: Interfaz lenta
- **WHEN** la ventana no consume los niveles a tiempo
- **THEN** se descartan los antiguos y solo se muestra el más reciente
