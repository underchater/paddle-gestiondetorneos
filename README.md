# Sistema de Gestión de Torneos de Paddle

Web (HTML/CSS/JS) + Node.js/Express + SQLite (SQL). Sin CMS. Autenticación propia (bcrypt + JWT).

## Ejecutar
Requiere Node.js 20 o superior.

    npm install
    npm start        # http://localhost:3000

Variables de entorno: `JWT_SECRET`, `ADMIN_CODE` (código para registrar administradores, por defecto `PADDLE2025`), `DB_PATH` y `APP_TIMEZONE` (por defecto `America/Bogota`).

### Acceso con Google
1. En Google Cloud Console, crea un cliente OAuth de tipo aplicación web y configura la URI de redirección autorizada. En local: `http://localhost:3000/auth/google/callback`; en producción, usa el mismo dominio público de la app.
2. Configura `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `GOOGLE_REDIRECT_URI` en el entorno del servidor. La URI debe coincidir exactamente con la autorizada en Google.
3. Nunca publiques el secreto OAuth en el repositorio. Los usuarios nuevos que ingresan con Google quedan registrados como jugadores; una cuenta existente con el mismo correo verificado se vincula.

### Avisos de partidos
Al programar un partido se guarda un aviso dentro de la app para cada jugador de ambos equipos. También se envía un correo cuando SMTP está configurado. Incluye torneo, equipos, fecha, hora y cancha o lugar. Los jugadores existentes pueden agregar o corregir su correo desde **Mi cuenta**; las cuentas nuevas deben registrarlo.

Configura las variables SMTP en el servidor para activar el correo:

    SMTP_HOST
    SMTP_PORT
    SMTP_USER
    SMTP_PASS
    SMTP_FROM       # opcional; por defecto usa SMTP_USER
    SMTP_SECURE     # opcional: true o false; por defecto usa SSL si SMTP_PORT es 465

Si usas Gmail como servidor SMTP, genera una contraseña de aplicación y úsala en `SMTP_PASS`; no uses ni compartas tu contraseña personal de Google. Si SMTP aún no está configurado, los avisos internos seguirán disponibles y la app indicará que no se pudo enviar el correo.

## Git (todos deben hacer commits)
Cada integrante debe clonar el repositorio:

    git clone https://github.com/underchater/paddle-gestiondetorneos.git
    cd paddle-gestiondetorneos

Después de realizar sus cambios, cada integrante debe crear y subir sus propios commits:

    git add .
    git commit -m "Descripción del cambio"
    git push

El repositorio es público y cualquiera puede clonarlo; para subir commits directamente, cada integrante debe tener acceso de escritura como colaborador.

## Despliegue (Render)
Este repositorio incluye `render.yaml` para crear el servicio desde Render:

1. En Render, selecciona **New > Blueprint** y conecta este repositorio.
2. Confirma el servicio `paddle-gestiondetorneos` y define un `ADMIN_CODE` propio cuando Render lo solicite. Render genera `JWT_SECRET` automáticamente.
3. Una vez creado el servicio, abre la URL `https://<tu-servicio>.onrender.com` para verificar la app.
4. Para activar Google, configura `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `GOOGLE_REDIRECT_URI` en **Environment**. La URI autorizada en Google debe ser exactamente `https://<tu-servicio>.onrender.com/auth/google/callback`.
5. Para correo, configura las variables SMTP descritas arriba en **Environment**.

Render ejecuta `npm ci` y `npm start`; `/api/config` se usa como comprobación de salud. En el plan gratuito el servicio puede suspenderse por inactividad y el sistema de archivos es efímero: la base de datos SQLite puede perderse al desplegar de nuevo o reiniciar la instancia. Para conservar datos, usa un disco persistente con un plan que lo admita y cambia `DB_PATH` a una ruta dentro del punto de montaje, o migra la base de datos a PostgreSQL.

No agregues credenciales OAuth ni SMTP al repositorio; guárdalas como variables de entorno en Render.
