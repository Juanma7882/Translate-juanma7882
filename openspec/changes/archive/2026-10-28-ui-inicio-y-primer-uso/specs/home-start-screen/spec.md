# Spec Delta

## Purpose

Hacer de la pestaña Inicio el punto de partida de la aplicación: que muestre de un vistazo qué región y qué idiomas se van a traducir, en qué modo, y permita cambiarlos sin recorrer los ajustes.

## ADDED Requirements

### Requirement: Región elegida
La pestaña Inicio SHALL mostrar la región de pantalla que se va a traducir (tamaño y posición en píxeles) o, si no hay ninguna, indicar que falta, y SHALL ofrecer el botón «Cambiar región» que abre el selector de región. En modo solo audio SHALL explicar que no se necesita región en lugar de mostrarla como faltante.

#### Scenario: Sin región guardada
- **WHEN** el modo necesita región y no hay ninguna guardada
- **THEN** Inicio indica que falta elegir una región y el botón dice «Elegir región»

#### Scenario: Cambiar región
- **WHEN** el usuario pulsa «Cambiar región» con una región guardada
- **THEN** se abre el selector, y al confirmar la nueva región Inicio la muestra y la traducción continúa con ella

#### Scenario: Selector cancelado
- **WHEN** el usuario abre el selector desde Inicio y lo cancela
- **THEN** la región anterior se conserva y Inicio no muestra ningún error

#### Scenario: Modo solo audio
- **WHEN** el modo es «Solo audio»
- **THEN** Inicio indica que ese modo no necesita región y no ofrece «Cambiar región»

### Requirement: Idiomas en Inicio
La pestaña Inicio SHALL mostrar el par de idiomas activo y un menú rápido para cambiarlo entre los pares cuyos modelos ya están instalados. El menú SHALL estar deshabilitado mientras hay una sesión en marcha, con la razón visible, y SHALL enlazar a la pestaña Idiomas para descargar otros pares.

#### Scenario: Cambiar a un par instalado
- **WHEN** el usuario elige en el menú otro par con modelos instalados
- **THEN** el par se guarda y Inicio lo muestra como activo

#### Scenario: Par no instalado
- **WHEN** el par activo no tiene sus modelos instalados
- **THEN** Inicio lo indica y ofrece ir a la pestaña Idiomas para descargarlo

#### Scenario: Sesión en marcha
- **WHEN** hay una sesión en marcha o en pausa
- **THEN** el menú está deshabilitado y explica que hay que detener la sesión para cambiar de idioma

### Requirement: Modo en una frase
La pestaña Inicio SHALL describir el modo activo en una frase corta que diga qué se va a traducir (texto de la región, audio del sistema o ambos con paso automático) y SHALL permitir cambiarlo sin salir de Inicio.

#### Scenario: Modo automático
- **WHEN** el modo es automático
- **THEN** Inicio dice que se traduce el texto de la región y, si no hay texto, el audio del sistema

#### Scenario: Cambiar el modo desde Inicio
- **WHEN** el usuario elige otro modo en Inicio
- **THEN** el ajuste se guarda igual que desde General y la frase se actualiza

### Requirement: Estado y acción principal visibles
La pestaña Inicio SHALL ser la primera y la que se ve al abrir la ventana, con el estado de la sesión como elemento más destacado y una única acción principal (Iniciar o, con sesión en marcha, Detener) más prominente que el resto de controles.

#### Scenario: Apertura de la ventana
- **WHEN** se abre la ventana de Ajustes
- **THEN** se muestra la pestaña Inicio con el estado actual y la acción principal

#### Scenario: Accesibilidad
- **WHEN** el estado de la sesión cambia
- **THEN** el cambio se anuncia a lectores de pantalla y el contraste cumple 4,5:1 en tema claro y oscuro
