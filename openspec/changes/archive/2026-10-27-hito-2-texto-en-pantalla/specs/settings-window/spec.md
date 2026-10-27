# Spec Delta

## Purpose

Ofrecer una ventana donde el usuario configura idiomas, motores, apariencia del overlay y modelos, y ve el progreso de las descargas.

## ADDED Requirements

### Requirement: Idiomas
La ventana SHALL permitir elegir el idioma de origen y el de destino entre los que tienen modelos en el manifiesto y SHALL impedir elegir el mismo idioma en ambos.

#### Scenario: Mismo idioma
- **WHEN** el usuario elige el mismo idioma de origen y de destino
- **THEN** la ventana lo rechaza con un mensaje y conserva la selección anterior

### Requirement: Motores
La ventana SHALL permitir elegir el conjunto de motores (reales o de demostración) y mostrar cuál está activo.

#### Scenario: Cambiar de motores
- **WHEN** el usuario cambia el conjunto de motores
- **THEN** el cambio se aplica al siguiente arranque de la traducción

### Requirement: Gestión de modelos
La ventana SHALL mostrar el estado de los modelos de los idiomas elegidos (ausente, descargando, listo), permitir descargarlos y mostrar una barra de progreso durante la descarga.

#### Scenario: Descarga de modelos
- **WHEN** el usuario pide descargar los modelos de un par
- **THEN** se muestra una barra de progreso que avanza y, al terminar, el estado pasa a listo

#### Scenario: Error de descarga
- **WHEN** una descarga falla
- **THEN** la ventana muestra el motivo y permite reintentar

### Requirement: Apariencia del overlay
La ventana SHALL permitir configurar posición, tamaño, opacidad y fuente del overlay con una vista previa.

#### Scenario: Cambiar el tamaño de fuente
- **WHEN** el usuario cambia el tamaño de fuente
- **THEN** la vista previa y el overlay reflejan el cambio

### Requirement: Persistencia
Los ajustes SHALL guardarse y recuperarse entre sesiones, con valores por defecto válidos si faltan o están dañados.

#### Scenario: Archivo de ajustes dañado
- **WHEN** el archivo de ajustes no se puede leer
- **THEN** la aplicación arranca con los valores por defecto y lo informa

### Requirement: Accesibilidad básica
La ventana SHALL poder usarse solo con teclado y SHALL etiquetar sus controles para lectores de pantalla.

#### Scenario: Navegación con teclado
- **WHEN** el usuario navega con la tecla Tab
- **THEN** cada control recibe el foco en un orden lógico y se identifica por su etiqueta
