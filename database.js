const Database = require('better-sqlite3');

const isPostgres = Boolean(process.env.DATABASE_URL);

const pool = isPostgres
  ? new (require('pg').Pool)({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000
  })
  : null;
const sqlite = pool ? null : new Database(process.env.DB_PATH || 'paddle.db');
let sqliteLock = Promise.resolve();

const pgSql = sql => {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
};

function createAdapter(query, exec, transact) {
  return {
    prepare(sql) {
      return {
        async all(...params) {
          return (await query(sql, params)).rows;
        },
        async get(...params) {
          return (await query(sql, params)).rows[0];
        },
        async run(...params) {
          const result = await query(sql, params);
          return {
            changes: result.rowCount,
            lastInsertRowid: result.rows[0]?.id ?? result.lastInsertRowid
          };
        }
      };
    },
    exec,
    transaction: callback => () => transact(callback)
  };
}

async function sqliteQuery(sql, params) {
  const statement = sqlite.prepare(sql);
  if (/^\s*(SELECT|PRAGMA|INSERT[\s\S]*\bRETURNING\b|UPDATE[\s\S]*\bRETURNING\b|DELETE[\s\S]*\bRETURNING\b)/i.test(sql)) {
    const rows = statement.all(...params);
    return { rows, rowCount: rows.length };
  }
  const result = statement.run(...params);
  return { rows: [], rowCount: result.changes, lastInsertRowid: result.lastInsertRowid };
}

async function acquireSqliteLock() {
  const previous = sqliteLock;
  let release;
  sqliteLock = new Promise(resolve => { release = resolve; });
  await previous;
  return release;
}

async function sqliteTransaction(callback) {
  const release = await acquireSqliteLock();
  sqlite.exec('BEGIN IMMEDIATE');
  const tx = createAdapter(sqliteQuery, sql => sqlite.exec(sql), sqliteTransaction);
  try {
    const result = await callback(tx);
    sqlite.exec('COMMIT');
    return result;
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  } finally {
    release();
  }
}

async function postgresTransaction(callback) {
  const client = await pool.connect();
  const tx = createAdapter(
    async (sql, params) => {
      const result = await client.query(pgSql(sql), params);
      return { rows: result.rows, rowCount: result.rowCount };
    },
    sql => client.query(sql),
    postgresTransaction
  );
  try {
    await client.query('BEGIN');
    const result = await callback(tx);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const db = createAdapter(
  async (sql, params) => {
    if (pool) {
      const result = await pool.query(pgSql(sql), params);
      return { rows: result.rows, rowCount: result.rowCount };
    }
    const release = await acquireSqliteLock();
    try {
      return await sqliteQuery(sql, params);
    } finally {
      release();
    }
  },
  async sql => {
    if (pool) return pool.query(sql);
    const release = await acquireSqliteLock();
    try {
      return sqlite.exec(sql);
    } finally {
      release();
    }
  },
  callback => pool ? postgresTransaction(callback) : sqliteTransaction(callback)
);

async function initializeDatabase() {
  if (pool) {
    const statements = [
      'CREATE TABLE IF NOT EXISTS usuarios(id SERIAL PRIMARY KEY, nombre TEXT NOT NULL, usuario TEXT UNIQUE NOT NULL, clave TEXT NOT NULL, rol TEXT NOT NULL, email TEXT, google_sub TEXT)',
      'CREATE TABLE IF NOT EXISTS jugadores(id SERIAL PRIMARY KEY, nombre TEXT NOT NULL, categoria TEXT NOT NULL, usuario_id INTEGER)',
      'CREATE TABLE IF NOT EXISTS equipos(id SERIAL PRIMARY KEY, nombre TEXT NOT NULL, jugador1 INTEGER NOT NULL, jugador2 INTEGER NOT NULL)',
      'CREATE TABLE IF NOT EXISTS torneos(id SERIAL PRIMARY KEY, nombre TEXT NOT NULL, fecha_inicio TEXT NOT NULL, reglas TEXT)',
      'CREATE TABLE IF NOT EXISTS torneo_inscripciones(id SERIAL PRIMARY KEY, torneo_id INTEGER NOT NULL, jugador_id INTEGER NOT NULL, creada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(torneo_id,jugador_id))',
      "CREATE TABLE IF NOT EXISTS partidos(id SERIAL PRIMARY KEY, torneo_id INTEGER NOT NULL, fecha TEXT NOT NULL, equipo1 INTEGER NOT NULL, equipo2 INTEGER NOT NULL, resultado TEXT, ganador INTEGER, hora TEXT NOT NULL DEFAULT '18:00', lugar TEXT NOT NULL DEFAULT '')",
      'CREATE TABLE IF NOT EXISTS notificaciones(id SERIAL PRIMARY KEY, usuario_id INTEGER NOT NULL, partido_id INTEGER NOT NULL, titulo TEXT NOT NULL, mensaje TEXT NOT NULL, leida INTEGER NOT NULL DEFAULT 0, creada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS oauth_states(state TEXT PRIMARY KEY, expires_at BIGINT NOT NULL)',
      'ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email TEXT',
      'ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS google_sub TEXT',
      "ALTER TABLE partidos ADD COLUMN IF NOT EXISTS hora TEXT NOT NULL DEFAULT '18:00'",
      "ALTER TABLE partidos ADD COLUMN IF NOT EXISTS lugar TEXT NOT NULL DEFAULT ''",
      "CREATE UNIQUE INDEX IF NOT EXISTS usuarios_email_unique ON usuarios(LOWER(email)) WHERE email IS NOT NULL AND email <> ''",
      'CREATE UNIQUE INDEX IF NOT EXISTS usuarios_google_sub_unique ON usuarios(google_sub) WHERE google_sub IS NOT NULL'
    ];
    for (const statement of statements) await pool.query(statement);
    return;
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios(id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, usuario TEXT UNIQUE NOT NULL, clave TEXT NOT NULL, rol TEXT NOT NULL, email TEXT, google_sub TEXT);
    CREATE TABLE IF NOT EXISTS jugadores(id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, categoria TEXT NOT NULL, usuario_id INTEGER);
    CREATE TABLE IF NOT EXISTS equipos(id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, jugador1 INTEGER NOT NULL, jugador2 INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS torneos(id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, fecha_inicio TEXT NOT NULL, reglas TEXT);
    CREATE TABLE IF NOT EXISTS torneo_inscripciones(id INTEGER PRIMARY KEY, torneo_id INTEGER NOT NULL, jugador_id INTEGER NOT NULL, creada_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(torneo_id,jugador_id));
    CREATE TABLE IF NOT EXISTS partidos(id INTEGER PRIMARY KEY, torneo_id INTEGER NOT NULL, fecha TEXT NOT NULL, equipo1 INTEGER NOT NULL, equipo2 INTEGER NOT NULL, resultado TEXT, ganador INTEGER, hora TEXT NOT NULL DEFAULT '18:00', lugar TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS notificaciones(id INTEGER PRIMARY KEY, usuario_id INTEGER NOT NULL, partido_id INTEGER NOT NULL, titulo TEXT NOT NULL, mensaje TEXT NOT NULL, leida INTEGER NOT NULL DEFAULT 0, creada_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS oauth_states(state TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
  `);
  const userColumns = new Set((await db.prepare('PRAGMA table_info(usuarios)').all()).map(column => column.name));
  if (!userColumns.has('email')) await db.exec('ALTER TABLE usuarios ADD COLUMN email TEXT');
  if (!userColumns.has('google_sub')) await db.exec('ALTER TABLE usuarios ADD COLUMN google_sub TEXT');
  const matchColumns = new Set((await db.prepare('PRAGMA table_info(partidos)').all()).map(column => column.name));
  if (!matchColumns.has('hora')) await db.exec("ALTER TABLE partidos ADD COLUMN hora TEXT NOT NULL DEFAULT '18:00'");
  if (!matchColumns.has('lugar')) await db.exec("ALTER TABLE partidos ADD COLUMN lugar TEXT NOT NULL DEFAULT ''");
  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS usuarios_email_unique ON usuarios(email COLLATE NOCASE) WHERE email IS NOT NULL AND email <> '';
    CREATE UNIQUE INDEX IF NOT EXISTS usuarios_google_sub_unique ON usuarios(google_sub) WHERE google_sub IS NOT NULL;
  `);
}

module.exports = { db, initializeDatabase, isPostgres };
