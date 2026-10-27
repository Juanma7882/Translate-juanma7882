# Spec Delta

## ADDED Requirements

### Requirement: Modo desde la bandeja y atajo
La bandeja SHALL ofrecer un submenú "Modo" con las tres opciones (la activa marcada) y un atajo global configurable SHALL ciclar el modo. El tooltip SHALL indicar el modo activo mientras se traduce.

#### Scenario: Elegir modo en la bandeja
- **WHEN** el usuario elige "Solo audio" en el submenú
- **THEN** el ajuste `mode` pasa a `audio` y, si había una sesión, continúa en audio

#### Scenario: Atajo en conflicto
- **WHEN** el atajo de modo ya lo usa otra aplicación
- **THEN** se muestra un aviso con el atajo y se indica cambiarlo en Ajustes

### Requirement: Traducir sin región en modo audio
"Traducir la última región" SHALL estar disponible en modo audio aunque no haya región guardada.

#### Scenario: Primer arranque en modo audio
- **WHEN** el modo es audio y no hay región
- **THEN** la sesión arranca sin abrir el selector

## MODIFIED Requirements

### Requirement: Primer uso
En el primer uso, si faltan modelos, la aplicación SHALL guiar al usuario para descargarlos mostrando el progreso y SHALL avisar de que se descargará desde internet. Los modelos necesarios dependen del modo: texto (OCR y traducción), audio (voz y traducción) o ambos en automático. Al terminar la descarga SHALL retomar la acción pendiente solo cuando estén listos los modelos del ámbito del modo.

#### Scenario: Primer arranque sin modelos
- **WHEN** el usuario intenta traducir sin los modelos necesarios
- **THEN** la aplicación ofrece descargarlos, indica el tamaño total y muestra el progreso

#### Scenario: Modo automático sin modelos de audio
- **WHEN** hay modelos de texto pero faltan los de audio y el modo es automático
- **THEN** se avisa de los que faltan, se abre Ajustes y la sesión no se inicia hasta que estén todos

#### Scenario: Descarga parcial
- **WHEN** termina una descarga pero siguen faltando modelos del ámbito del modo
- **THEN** no se reintenta el arranque
