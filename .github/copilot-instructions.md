# Instrucciones para GitHub Copilot

Antes de proponer o realizar cambios, lee [`AGENTS.md`](../AGENTS.md): es la guía de contexto del proyecto y contiene arquitectura, flujos de negocio, restricciones y comandos de validación.

Trabaja solo con el contexto necesario para la tarea: inspecciona los archivos involucrados y sus dependencias directas; no cargues `node_modules/` ni asumas comportamientos que no estén en el código. Respeta las reglas de autorización, persistencia SQLite/PostgreSQL, escape HTML, validación en servidor y transacciones descritas en `AGENTS.md`.

La pestaña “Análisis” prepara y copia una consulta contextualizada; no está conectada a un proveedor de IA ni genera respuestas. Mantén esa limitación explícita en la documentación si la modificas.

Implementa cambios quirúrgicos, mantén el estilo y los textos existentes en español, y ejecuta las validaciones pertinentes. No afirmes que hay pruebas automatizadas: actualmente `package.json` no define scripts de test, lint ni build.
