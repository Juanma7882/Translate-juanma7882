# Spec Delta

## Purpose

Elegir por configuración entre los motores reales y los de demostración y dejar listos los modelos necesarios antes de arrancar, sin que el núcleo conozca ningún motor concreto.

## ADDED Requirements

### Requirement: Conjuntos de motores
El sistema SHALL ofrecer al menos dos conjuntos de motores seleccionables por configuración: motores reales (captura de pantalla, OCR y traducción reales) y motores de demostración.

#### Scenario: Motores reales
- **WHEN** se configura el conjunto real y se inicia una traducción de región
- **THEN** la captura, el OCR y la traducción son los motores reales

#### Scenario: Motores de demostración
- **WHEN** se configura el conjunto de demostración
- **THEN** el motor funciona sin modelos ni acceso a la pantalla, como en el hito anterior

### Requirement: Preparación de modelos antes de arrancar
Con motores reales, el sistema SHALL comprobar que los modelos del par de idiomas están listos antes de arrancar y, si faltan, SHALL informar cuáles son sin iniciar el pipeline.

#### Scenario: Modelos faltantes
- **WHEN** se inicia una traducción real y faltan modelos
- **THEN** el comando falla con un error que lista los modelos ausentes y no se captura la pantalla

#### Scenario: Modelos listos
- **WHEN** todos los modelos están listos
- **THEN** el pipeline arranca sin descargas

### Requirement: Núcleo independiente de los motores
Agregar o reemplazar un motor MUST NOT requerir cambios en el crate del núcleo.

#### Scenario: Nuevo motor de OCR
- **WHEN** se agrega un motor de OCR como adaptador nuevo
- **THEN** solo cambian los adaptadores y la composición, no el núcleo

### Requirement: Motores compilables por separado
Cada motor real SHALL poder activarse o excluirse en tiempo de compilación sin afectar a los demás.

#### Scenario: Compilar sin OCR
- **WHEN** se compila excluyendo el motor de OCR
- **THEN** el resto del sistema compila y el conjunto real informa que falta ese motor

### Requirement: Sin contenido en la composición
La composición MUST NOT registrar ni escribir a disco texto, capturas ni traducciones.

#### Scenario: Ejecución con motores reales
- **WHEN** corre un pipeline completo con motores reales
- **THEN** no se crean archivos con contenido procesado y no se imprime contenido en ningún registro
