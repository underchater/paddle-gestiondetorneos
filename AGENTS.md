# Contexto del proyecto

## Propósito y alcance

Aplicación web para gestionar torneos de pádel de El Club Espinal: cuentas de jugadores y administradores, jugadores, equipos, torneos, inscripciones, partidos, resultados, clasificación y notificaciones.

Antes de cambiar código, inspecciona el flujo completo afectado. Usa esta guía como mapa, no como sustituto del código fuente; si algo no coincide, el código actual es la referencia.

## Arquitectura

- `server.js`: servidor Express, autenticación, autorización por rol, endpoints `/api`, correo y arranque de la aplicación.
- `database.js`: esquema e inicialización de la base de datos, adaptador común y transacciones para SQLite y PostgreSQL.
- `public/index.html`: interfaz completa en un único archivo, con CSS y JavaScript del navegador inline. La función `api()` centraliza las llamadas autenticadas; `TABS` y `V` organizan las secciones.
- La pestaña `Análisis` en `public/index.html` es un prototipo de Context Engineering: recupera torneo, partidos y clasificación mediante los endpoints existentes, acota los partidos incluidos y prepara una consulta en el navegador. No integra un proveedor ni llama a un modelo de IA.
- `package.json`: dependencias y comandos. Es una aplicación CommonJS para Node.js 20 o superior; no hay compilación de frontend ni scripts de pruebas configurados.
- `render.yaml`: configuración de despliegue en Render.

El servidor sirve `public/` y escucha en `PORT` (por defecto, `3000`). Espera a `initializeDatabase()` antes de aceptar peticiones.

## Flujos importantes

- Las cuentas se registran e inician sesión mediante `/api/registro` y `/api/login`; las contraseñas se guardan con bcrypt y la sesión usa JWT.
- `auth` valida el JWT y `admin` restringe las operaciones administrativas. Los roles actuales son `admin` y `jugador`; aplica la autorización en el servidor, no solo en la interfaz.
- El registro de jugadores también crea su perfil en `jugadores`. Las cuentas de administrador no crean perfil de jugador.
- Los equipos vinculan dos jugadores. No permitas asignar un jugador a más de un equipo ni alterar o borrar equipos que ya tengan partidos.
- La inscripción liga un jugador a un torneo y tiene unicidad por `(torneo_id, jugador_id)`. La inscripción envía la ficha por correo; las notificaciones de partidos también se guardan en la aplicación.
- La clasificación se calcula con los partidos registrados: tres puntos por victoria.
- Las fechas y horas de partidos usan `APP_TIMEZONE` (por defecto `America/Bogota`).
- OAuth de Google depende de configuración explícita. No des por hecho que esté habilitado en todos los entornos.

## Reglas al modificar código

- Conserva CommonJS, JavaScript y los patrones existentes; evita añadir frameworks, dependencias o procesos de compilación sin necesidad.
- Las consultas usan `?` como marcador. El adaptador las traduce a `$1`, `$2`, etc. en PostgreSQL. Mantén sincronizados el esquema y las migraciones de SQLite y PostgreSQL al cambiar datos.
- Usa parámetros SQL para valores; no interpolar entrada del usuario en consultas.
- Mantén validaciones y permisos en el servidor, además de cualquier validación de interfaz. Conserva transacciones cuando una operación modifica registros relacionados.
- En HTML dinámico, escapa los valores externos usando el helper existente `e()`. No insertes texto del usuario como HTML sin escapar.
- Conserva los mensajes de error y advertencia útiles para el usuario; no ocultes fallos de base de datos, correo o autenticación con respuestas que aparenten éxito.
- `public/index.html` combina estructura, estilos y lógica: localiza las secciones existentes antes de editar y evita reescribir el archivo completo por cambios puntuales.
- Mantén las respuestas y textos de interfaz en español, salvo que la tarea solicite otra cosa.
- No leas ni modifiques `node_modules/` para cambios de la aplicación.
- El prototipo de Context Engineering debe indicar claramente qué datos usa, mantener el contexto limitado y no afirmar que generó una respuesta de IA: no hay integración con un modelo.

## Desarrollo y validación

- Instalar dependencias cuando sea necesario: `npm ci`.
- Ejecutar localmente: `npm start`.
- Comprobar sintaxis del servidor y el adaptador: `node --check server.js` y `node --check database.js`.
- No hay comandos de pruebas, lint o build definidos actualmente en `package.json`. Si el cambio afecta una interacción, valida también el flujo en la aplicación con el rol y la base de datos correspondientes.
- Para producción se requiere PostgreSQL (`DATABASE_URL`); el almacenamiento SQLite local no es persistente en Render.

## Configuración

Variables que el código consulta: `PORT`, `NODE_ENV`, `JWT_SECRET`, `ADMIN_CODE`, `DATABASE_URL`, `DB_PATH`, `PGSSLMODE`, `APP_TIMEZONE`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `RENDER_EXTERNAL_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` y `SMTP_FROM`.

No escribas secretos ni valores reales de producción en documentación o código. `.env` y las bases de datos locales están excluidos por `.gitignore`.
