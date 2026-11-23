---
marp: true
theme: default
paginate: true
---

# Paddle Torneos
## Gestión de torneos de pádel — El Club Espinal

---

# Problema y objetivo

- Gestión dispersa de jugadores y partidos.
- Inscripciones y resultados difíciles de consultar.
- Clasificaciones calculadas manualmente.

Objetivo: una plataforma web centralizada para jugadores y administradores.

---

# Demostración del producto

- Inicio de sesión por usuario y contraseña.
- Inicio de sesión con Google OAuth.
- Paneles por rol.
- Inscripción a torneos.
- Equipos y partidos.
- Resultados y clasificación.
- Avisos internos y correo opcional.

---

# Arquitectura final

- Navegador web.
- API REST en Node.js y Express.
- JWT y bcrypt.
- SQLite en desarrollo.
- PostgreSQL en producción.
- Google OAuth y SMTP opcionales.

Ver diagrama completo en `ARCHITECTURA.md`.

---

# Base de datos

- usuarios
- jugadores
- equipos
- torneos
- torneo_inscripciones
- partidos
- notificaciones
- oauth_states

PostgreSQL garantiza persistencia en Render.

---

# Pruebas

- Pruebas automatizadas de API con SQLite temporal.
- Registro e inicio de sesión.
- Torneos y equipos.
- Programación de partidos.
- Registro de resultados.
- Clasificación.
- Pruebas manuales de interfaz y roles.

Comando: `npm test`

---

# Retos y dificultades

- Mantener compatibilidad entre SQLite y PostgreSQL.
- Proteger operaciones administrativas en el servidor.
- Gestionar diferencias de SQL y transacciones.
- Configurar persistencia para despliegue.
- Integrar Google OAuth y SMTP sin romper entornos locales.
- Diseñar una interfaz clara y adaptable.

---

# Decisiones técnicas

- Un adaptador común para ambas bases de datos.
- JWT para sesiones.
- bcrypt para contraseñas.
- HTML y JavaScript integrados para una arquitectura simple.
- Servicios opcionales deshabilitados sin afectar la operación principal.

---

# Entregables

- Aplicación desplegada.
- Repositorio GitHub.
- README con instalación.
- Arquitectura final.
- Wiki y pruebas.
- Diapositivas de presentación.
