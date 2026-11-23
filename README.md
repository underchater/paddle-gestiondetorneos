# Paddle Torneos

## Entregables

- Aplicación desplegada: https://paddle-gestiondetorneos.onrender.com

Aplicación web para administrar torneos de pádel del Club El Club Espinal. Permite gestionar cuentas, jugadores, equipos, torneos, partidos, resultados, clasificación y avisos.

## Funciones

- Registro e inicio de sesión por usuario y contraseña, con Google OAuth opcional.
- Roles de administrador y jugador, protegidos con JWT.
- CRUD administrativo de jugadores, equipos y torneos.
- Inscripción de jugadores a torneos.
- Programación de partidos con fecha, hora y lugar.
- Registro de resultados y clasificación automática con 3 puntos por victoria.
- Avisos internos y notificaciones por correo mediante SMTP opcional.

## Tecnologías

- Node.js 20 y Express.
- SQLite para desarrollo local.
- PostgreSQL para producción persistente.
- HTML, CSS y JavaScript sin framework de compilación.
- JWT y bcrypt para autenticación.
- Google OAuth 2.0 y Nodemailer opcionales.

## Requisitos

- Node.js 20 o superior.
- npm.
- PostgreSQL solamente para despliegues persistentes.
- Opcional: cuenta SMTP y credenciales de Google OAuth.

## Instalación local

1. Clona el proyecto:

```bash
git clone https://github.com/underchater/paddle-gestiondetorneos.git
cd paddle-gestiondetorneos
npm ci
```

2. Crea el archivo de entorno:

```bash
copy .env.example .env
```

En macOS o Linux usa `cp .env.example .env`.

3. Configura las variables necesarias. Para SQLite local puede dejar `DATABASE_URL` vacío.

4. Inicia la aplicación:

```bash
npm start
```

5. Abre `http://localhost:3000`.

El proyecto usa SQLite y crea `paddle.db` automáticamente si no existe `DATABASE_URL`.

## Variables de entorno

| Variable | Obligatoria | Uso |
|---|---:|---|
| `PORT` | No | Puerto HTTP; por defecto `3000`. |
| `JWT_SECRET` | Sí en producción | Firma las sesiones JWT. |
| `ADMIN_CODE` | Sí en producción | Código usado al crear cuentas administradoras. |
| `DATABASE_URL` | Sí en producción | URL de PostgreSQL persistente. |
| `DB_PATH` | No | Ruta del archivo SQLite local. |
| `PGSSLMODE` | No | Usa `disable` para PostgreSQL local sin SSL. |
| `APP_TIMEZONE` | No | Zona horaria; por defecto `America/Bogota`. |
| `GOOGLE_CLIENT_ID` | Para Google OAuth | ID de cliente OAuth. |
| `GOOGLE_CLIENT_SECRET` | Para Google OAuth | Secreto de cliente OAuth. |
| `GOOGLE_REDIRECT_URI` | Para Google OAuth | URL del callback `/auth/google/callback`. |
| `SMTP_HOST` | Para correo | Servidor SMTP. |
| `SMTP_PORT` | Para correo | Puerto SMTP. |
| `SMTP_USER` | Para correo | Usuario SMTP. |
| `SMTP_PASS` | Para correo | Contraseña SMTP. |
| `SMTP_SECURE` | No | `true` para puerto 465. |
| `SMTP_FROM` | No | Remitente; por defecto `SMTP_USER`. |

No subas `.env`, secretos, bases locales ni archivos `*.db`.

## Cuenta administradora

En el registro, completa el campo **Código de administrador** con el valor configurado en `ADMIN_CODE`. Sin ese código se crea una cuenta de jugador.

## Despliegue con Render

1. Crea una base PostgreSQL gestionada.
2. Crea un Web Service con este repositorio.
3. Usa `npm ci` como build command y `npm start` como start command.
4. Configura `NODE_ENV=production`, `JWT_SECRET`, `ADMIN_CODE` y `DATABASE_URL`.
5. Configura opcionalmente Google OAuth y SMTP.
6. La base PostgreSQL es obligatoria en producción; el SQLite local no ofrece almacenamiento persistente.

El archivo `render.yaml` contiene la definición base del servicio.

## Google OAuth

1. Crea una credencial OAuth web en Google Cloud.
2. Autoriza el origen del sitio.
3. Añade como URI de redirección la URL pública más `/auth/google/callback`.
4. Configura `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `GOOGLE_REDIRECT_URI`.

El ID y el secreto deben pertenecer al mismo cliente OAuth de Google. Después de cambiar el secreto, reinicia el Web Service y confirma en Google Cloud Console que esta URI autorizada aparece exactamente:

```text
https://paddle-gestiondetorneos.onrender.com/auth/google/callback
```

## SMTP

Cuando SMTP no está configurado, las inscripciones a torneos se guardan y la aplicación advierte que no pudo enviar la ficha por correo. Los avisos de partidos quedan disponibles dentro de la aplicación; el correo solo se habilita con la configuración SMTP completa.

## Pruebas

Ejecuta las pruebas automatizadas con:

```bash
npm test
```

Las pruebas usan una base SQLite temporal y verifican configuración, registro, inicio de sesión, creación de torneo, equipos, partidos, resultados y clasificación.

Comprobación manual adicional:

- Registro e inicio de sesión de jugador.
- Registro e inicio de sesión de administrador.
- Inscripción a torneo.
- Creación y edición de equipos.
- Programación de partido.
- Registro de resultado.
- Cálculo de clasificación.
- Avisos y cierre de sesión.
- Inicio de sesión con Google cuando esté configurado.

## Comandos

```bash
npm ci
npm start
npm test
node --check server.js
node --check database.js
```

## Documentación

- [Arquitectura](docs/ARCHITECTURA.md)
- [Wiki del proyecto](docs/WIKI.md)
