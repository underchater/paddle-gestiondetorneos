Sistema de Gestión de Torneos de Paddle

Las instrucciones de contexto para asistentes de código están en [AGENTS.md](./AGENTS.md). GitHub Copilot las incorpora mediante [.github/copilot-instructions.md](./.github/copilot-instructions.md).

## Prototipo de Context Engineering

Después de iniciar sesión, abre **Análisis**, selecciona un torneo y el enfoque, edita la pregunta y pulsa **Preparar consulta**. La aplicación recupera las reglas, hasta 20 partidos y la clasificación, y prepara una consulta que puedes copiar para analizarla.

Esta demostración no llama a un modelo ni transmite datos a un proveedor externo: solo construye el prompt en el navegador. No requiere instalar dependencias ni configurar claves de API.
