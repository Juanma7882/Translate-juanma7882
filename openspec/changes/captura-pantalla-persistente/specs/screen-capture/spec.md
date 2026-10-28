## ADDED Requirements

### Requirement: Conexión reutilizada entre capturas en X11
En una sesión X11, el sistema SHALL reutilizar la conexión con el servidor gráfico y la información de monitores entre capturas sucesivas, sin abrir una conexión nueva ni reenumerar los monitores en cada captura. La información de monitores SHALL refrescarse periódicamente y tras un fallo de captura, para reflejar cambios de configuración.

#### Scenario: Capturas consecutivas
- **WHEN** se piden varias capturas seguidas de la misma región en una sesión X11
- **THEN** solo la primera establece la conexión y las siguientes la reutilizan, con el mismo contenido que daría una captura con conexión nueva

#### Scenario: Cambio de configuración de monitores
- **WHEN** cambia la disposición de los monitores mientras el sistema captura
- **THEN** las capturas posteriores usan la disposición nueva sin reiniciar la aplicación

### Requirement: Recuperación de la conexión
Si la conexión reutilizada se pierde (por ejemplo, el servidor gráfico se reinicia), el sistema SHALL restablecerla en la captura siguiente sin intervención del usuario y sin cerrarse.

#### Scenario: Servidor gráfico reiniciado
- **WHEN** el servidor gráfico se reinicia entre dos capturas
- **THEN** la captura siguiente se completa tras reconectar, o informa un error de captura si el servidor no vuelve, y el sistema no se cierra

### Requirement: Respaldo y paridad entre plataformas
Fuera de X11 (Wayland, Windows, macOS) el sistema SHALL seguir capturando con el mismo comportamiento observable que antes. Si no puede establecerse la conexión persistente en X11, SHALL usar el mecanismo de captura general en lugar de fallar.

#### Scenario: Sesión Wayland o sistema no X11
- **WHEN** el entorno no es una sesión X11
- **THEN** la captura se comporta como antes de este cambio

#### Scenario: Conexión persistente no disponible
- **WHEN** no puede establecerse la conexión persistente en una sesión X11
- **THEN** el sistema captura con el mecanismo general y la región devuelta es equivalente

## MODIFIED Requirements

### Requirement: Errores de captura descriptivos
El sistema SHALL informar como error de captura, con un mensaje accionable, los casos en que no se puede capturar: monitor inexistente, falta de permisos y entornos no soportados (por ejemplo Wayland sin portal).  Un fallo pasajero de conexión con el servidor gráfico SHALL reintentarse un número acotado de veces con una espera corta, restableciendo la conexión si hace falta; si persiste, SHALL informarse como error de captura sin contenido.

#### Scenario: Monitor inexistente
- **WHEN** se pide una región de un monitor que no existe
- **THEN** se informa un error de captura que lo indica

#### Scenario: Entorno no soportado
- **WHEN** el entorno gráfico no permite capturar
- **THEN** el error de captura explica la causa y qué hacer, y el sistema no se cierra

#### Scenario: Fallo de conexión pasajero
- **WHEN** el servidor gráfico rechaza una conexión de captura un instante y la acepta enseguida
- **THEN** la captura se completa sin informar error

#### Scenario: Fallo de conexión persistente
- **WHEN** la conexión falla en todos los reintentos acotados
- **THEN** se informa un error de captura con la causa del sistema
