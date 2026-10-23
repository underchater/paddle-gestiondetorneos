# Sistema de Gestión de Torneos de Paddle

Web (HTML/CSS/JS) + Node.js/Express + SQLite (SQL). Sin CMS. Autenticación propia (bcrypt + JWT).

## Ejecutar
    npm install
    npm start        # http://localhost:3000

Variables de entorno: `JWT_SECRET`, `ADMIN_CODE` (código para registrar administradores, por defecto `PADDLE2025`), `DB_PATH`.

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
Crear "Web Service" desde el repo: Build `npm install`, Start `npm start`, y definir `JWT_SECRET` y `ADMIN_CODE`.
Nota: en el plan gratuito el disco es temporal; para datos permanentes usar un disco persistente (`DB_PATH`) o migrar a PostgreSQL.
