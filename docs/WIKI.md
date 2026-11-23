# Wiki final — Paddle Torneos

## Resumen del proyecto

Paddle Torneos es un sistema web para organizar torneos de pádel de El Club Espinal. Centraliza cuentas, perfiles deportivos, parejas, competencias, partidos y posiciones.

## Objetivo

Reducir la gestión manual de inscripciones, horarios y resultados, ofreciendo a jugadores y administradores una vista actualizada del torneo.

## Requisitos funcionales

- Registro e inicio de sesión.
- Roles de jugador y administrador.
- Administración de jugadores, equipos y torneos.
- Inscripción a competencias.
- Programación y consulta de partidos.
- Registro de resultados.
- Clasificación automática.
- Avisos internos.

## Roles

### Jugador

- Consulta torneos, equipos, partidos y clasificación.
- Se inscribe en torneos.
- Consulta avisos.
- Actualiza su correo.

### Administrador

- Crea torneos.
- Crea y modifica jugadores y equipos.
- Programa partidos.
- Registra resultados.

## Reglas de negocio

- Un jugador no puede pertenecer simultáneamente a dos equipos.
- Un equipo no puede tener jugadores repetidos ni partidos consigo mismo.
- La inscripción es única por jugador y torneo.
- El ganador válido debe ser uno de los equipos del partido.
- Una victoria otorga tres puntos.
- No se pueden cambiar o borrar equipos con partidos registrados.

## Seguridad

- Contraseñas cifradas con bcrypt.
- Sesiones mediante JWT.
- Validación de autorización en el servidor.
- Consultas SQL parametrizadas.
- Escape de datos externos en la interfaz.
- Variables sensibles fuera del código fuente.

## Pruebas

Las pruebas automatizadas cubren los principales flujos de API con una base SQLite temporal. También se incluye una lista de pruebas manuales en el README.

## Documentación relacionada

- [Guía de instalación](../README.md)
- [Arquitectura](ARCHITECTURA.md)
