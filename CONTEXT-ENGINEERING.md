# Context engineering en este proyecto

El *context engineering* consiste en dar a un asistente la información pertinente para que entienda el proyecto y siga sus convenciones al trabajar. En este repositorio, los archivos Markdown versionados comparten ese contexto con el equipo; no cambian el comportamiento de la aplicación.

## Archivos de contexto

- [`AGENTS.md`](./AGENTS.md) es la guía principal. Resume el propósito y la arquitectura, los flujos de negocio, las reglas de implementación, la configuración y las comprobaciones disponibles.
- [`.github/copilot-instructions.md`](./.github/copilot-instructions.md) indica a GitHub Copilot que consulte `AGENTS.md` y aplica pautas de trabajo para este repositorio.
- [`README.md`](./README.md) es la presentación del proyecto; no sustituye las instrucciones de los otros archivos.

## Cómo mantener el contexto útil

- Actualiza la guía cuando cambien la arquitectura, las reglas de negocio, los comandos de desarrollo o la configuración.
- Mantén las instrucciones concretas, comprobables y consistentes con el código actual.
- Evita duplicar detalles que puedan quedar desactualizados; enlaza la guía principal cuando sea suficiente.
- Nunca incluyas contraseñas, tokens ni valores reales de configuración privada.
- Antes de modificar una función, verifica su comportamiento en el código fuente: la documentación orienta, pero el código es la referencia.
