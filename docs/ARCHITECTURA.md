# Arquitectura del software

## Vista general

```mermaid
flowchart LR
    U1[Jugador] --> B[Navegador]
    U2[Administrador] --> B
    B -->|HTTP/JSON| E[Express API]
    E -->|JWT y bcrypt| A[Autenticación y autorización]
    E -->|SQL parametrizado| D{Adaptador de datos}
    D -->|Desarrollo| S[(SQLite)]
    D -->|Producción| P[(PostgreSQL)]
    E -->|OAuth opcional| G[Google Identity]
    E -->|SMTP opcional| M[Servidor de correo]
```

## Componentes

- **`public/index.html`**: interfaz de usuario, navegación por roles y llamadas HTTP.
- **`server.js`**: rutas HTTP, validaciones, autenticación, autorización y reglas de negocio.
- **`database.js`**: esquema, migraciones básicas y adaptador compatible con SQLite/PostgreSQL.
- **Base de datos**: información persistente de usuarios, jugadores, equipos, torneos, partidos e inscripciones.
- **Google OAuth**: autenticación opcional mediante el proveedor.
- **SMTP**: entrega opcional de inscripciones y avisos por correo.

## Flujo de inicio de sesión

```mermaid
sequenceDiagram
    participant Usuario
    participant Navegador
    participant API
    participant BD

    Usuario->>Navegador: Ingresa usuario y contraseña
    Navegador->>API: POST /api/login
    API->>BD: Busca cuenta y hash
    BD-->>API: Datos del usuario
    API->>API: Verifica bcrypt y genera JWT
    API-->>Navegador: Token y rol
    Navegador->>Navegador: Guarda sesión local
```

## Flujo de un partido

```mermaid
sequenceDiagram
    participant Admin
    participant API
    participant BD
    participant Jugadores

    Admin->>API: Crea torneo y equipos
    Admin->>API: Programa partido
    API->>BD: Guarda partido y crea avisos
    API-->>Jugadores: Avisos internos
    Admin->>API: Registra resultado y ganador
    API->>BD: Actualiza partido
    API-->>Admin: Clasificación recalculada
```

## Modelo de datos

```mermaid
erDiagram
    usuarios ||--o| jugadores : "tiene perfil"
    usuarios ||--o{ notificaciones : recibe
    jugadores }o--o{ equipos : "forma pareja"
    equipos }o--o{ partidos : "participa"
    torneos ||--o{ partidos : incluye
    torneos ||--o{ torneo_inscripciones : tiene
    jugadores ||--o{ torneo_inscripciones : realiza

    usuarios {
        integer id PK
        text nombre
        text usuario UK
        text clave
        text rol
        text email
        text google_sub
    }
    jugadores {
        integer id PK
        text nombre
        text categoria
        integer usuario_id FK
    }
    equipos {
        integer id PK
        text nombre
        integer jugador1 FK
        integer jugador2 FK
    }
    torneos {
        integer id PK
        text nombre
        text fecha_inicio
        text reglas
    }
    partidos {
        integer id PK
        integer torneo_id FK
        integer equipo1 FK
        integer equipo2 FK
        text fecha
        text hora
        text lugar
        text resultado
        integer ganador
    }
```
