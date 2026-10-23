# Sistema de Gestión de Torneos de Paddle

Web (HTML/CSS/JS) + Node.js/Express + SQLite (SQL). Sin CMS. Autenticación propia (bcrypt + JWT).

## Ejecutar
    npm install
    npm start        # http://localhost:3000

Variables de entorno: `JWT_SECRET`, `ADMIN_CODE` (código para registrar administradores, por defecto `PADDLE2025`), `DB_PATH`.

## Git (todos deben hacer commits)
    git init && git add . && git commit -m "Proyecto inicial"
    git remote add origin <URL> && git push -u origin main

## Despliegue (Render)
Crear "Web Service" desde el repo: Build `npm install`, Start `npm start`, y definir `JWT_SECRET` y `ADMIN_CODE`.
Nota: en el plan gratuito el disco es temporal; para datos permanentes usar un disco persistente (`DB_PATH`) o migrar a PostgreSQL.
