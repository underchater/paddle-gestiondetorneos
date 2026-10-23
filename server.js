const express = require('express'), Database = require('better-sqlite3'),
  bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken');
const db = new Database(process.env.DB_PATH || 'paddle.db');
const SECRET = process.env.JWT_SECRET || 'cambia-este-secreto';
const ADMIN_CODE = process.env.ADMIN_CODE || 'PADDLE2025';

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios(id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, usuario TEXT UNIQUE NOT NULL, clave TEXT NOT NULL, rol TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jugadores(id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, categoria TEXT NOT NULL, usuario_id INTEGER);
CREATE TABLE IF NOT EXISTS equipos(id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, jugador1 INTEGER NOT NULL, jugador2 INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS torneos(id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, fecha_inicio TEXT NOT NULL, reglas TEXT);
CREATE TABLE IF NOT EXISTS partidos(id INTEGER PRIMARY KEY, torneo_id INTEGER NOT NULL, fecha TEXT NOT NULL, equipo1 INTEGER NOT NULL, equipo2 INTEGER NOT NULL, resultado TEXT, ganador INTEGER);
`);

const app = express();
app.use(express.json());
app.use(express.static('public'));

const err = m => { throw new Error(m); };
const wrap = f => (q, s) => { try { f(q, s); } catch (e) { s.status(400).json({ error: e.message }); } };
const auth = (q, s, n) => {
  try { q.u = jwt.verify((q.headers.authorization || '').slice(7), SECRET); n(); }
  catch { s.status(401).json({ error: 'No autenticado' }); }
};
const admin = (q, s, n) => q.u.rol === 'admin' ? n() : s.status(403).json({ error: 'Solo administradores' });

// R1 y R6: registro de jugadores / administradores (con código de acceso)
app.post('/api/registro', wrap((q, s) => {
  const { nombre, usuario, clave, categoria, codigo } = q.body;
  if (!nombre || !usuario || !clave) err('Completa todos los campos');
  if (clave.length < 6) err('La contraseña debe tener mínimo 6 caracteres');
  const esAdmin = !!codigo;
  if (esAdmin && codigo !== ADMIN_CODE) err('Código de acceso incorrecto');
  if (!esAdmin && !categoria) err('Selecciona una categoría');
  if (db.prepare('SELECT 1 FROM usuarios WHERE usuario=?').get(usuario))
    err(esAdmin ? 'El administrador ya existe' : 'El jugador ya existe en el sistema');
  const r = db.prepare('INSERT INTO usuarios(nombre,usuario,clave,rol) VALUES(?,?,?,?)')
    .run(nombre, usuario, bcrypt.hashSync(clave, 10), esAdmin ? 'admin' : 'jugador');
  if (!esAdmin) db.prepare('INSERT INTO jugadores(nombre,categoria,usuario_id) VALUES(?,?,?)').run(nombre, categoria, r.lastInsertRowid);
  s.json({ ok: 'Registro exitoso' });
}));

// CU-01: inicio de sesión (el rol define la vista)
app.post('/api/login', wrap((q, s) => {
  const u = db.prepare('SELECT * FROM usuarios WHERE usuario=?').get(q.body.usuario);
  if (!u || !bcrypt.compareSync(q.body.clave || '', u.clave)) err('Credenciales incorrectas');
  s.json({ token: jwt.sign({ id: u.id, rol: u.rol, nombre: u.nombre }, SECRET, { expiresIn: '8h' }), rol: u.rol, nombre: u.nombre });
}));

app.get('/api/jugadores', auth, (q, s) => s.json(db.prepare('SELECT id,nombre,categoria FROM jugadores').all()));

// R2: equipos
app.get('/api/equipos', auth, (q, s) => s.json(db.prepare(
  'SELECT e.*, a.nombre n1, b.nombre n2 FROM equipos e JOIN jugadores a ON a.id=e.jugador1 JOIN jugadores b ON b.id=e.jugador2').all()));
app.post('/api/equipos', auth, admin, wrap((q, s) => {
  const { nombre } = q.body, j1 = +q.body.jugador1, j2 = +q.body.jugador2;
  if (!nombre || !j1 || !j2 || j1 === j2) err('Indica un nombre y dos jugadores distintos');
  if (db.prepare('SELECT 1 FROM equipos WHERE jugador1 IN(?,?) OR jugador2 IN(?,?)').get(j1, j2, j1, j2))
    err('Los jugadores seleccionados ya pertenecen a otro equipo');
  db.prepare('INSERT INTO equipos(nombre,jugador1,jugador2) VALUES(?,?,?)').run(nombre, j1, j2);
  s.json({ ok: 'Equipo creado' });
}));

// R8: torneos
app.get('/api/torneos', auth, (q, s) => s.json(db.prepare('SELECT * FROM torneos ORDER BY fecha_inicio DESC').all()));
app.post('/api/torneos', auth, admin, wrap((q, s) => {
  const { nombre, fecha_inicio, reglas } = q.body;
  if (!nombre || !fecha_inicio) err('Nombre y fecha de inicio son obligatorios');
  db.prepare('INSERT INTO torneos(nombre,fecha_inicio,reglas) VALUES(?,?,?)').run(nombre, fecha_inicio, reglas || '');
  s.json({ ok: 'Torneo creado' });
}));

// R3 y R4: programar y visualizar partidos
app.get('/api/partidos/:t', auth, wrap((q, s) => {
  const r = db.prepare(`SELECT p.*, a.nombre e1, b.nombre e2 FROM partidos p
    JOIN equipos a ON a.id=p.equipo1 JOIN equipos b ON b.id=p.equipo2 WHERE torneo_id=? ORDER BY fecha`).all(q.params.t);
  if (!r.length) err('Torneo sin partidos programados');
  s.json(r);
}));
app.post('/api/partidos', auth, admin, wrap((q, s) => {
  const { torneo_id, fecha } = q.body, e1 = +q.body.equipo1, e2 = +q.body.equipo2;
  const ex = i => db.prepare('SELECT 1 FROM equipos WHERE id=?').get(i);
  if (!fecha || e1 === e2 || !ex(e1) || !ex(e2)) err('Equipos no válidos');
  if (!db.prepare('SELECT 1 FROM torneos WHERE id=?').get(torneo_id)) err('Torneo no encontrado');
  db.prepare('INSERT INTO partidos(torneo_id,fecha,equipo1,equipo2) VALUES(?,?,?,?)').run(torneo_id, fecha, e1, e2);
  s.json({ ok: 'Partido programado' });
}));

// R5: resultados
app.put('/api/partidos/:id/resultado', auth, admin, wrap((q, s) => {
  const p = db.prepare('SELECT * FROM partidos WHERE id=?').get(q.params.id);
  if (!p) err('Partido no encontrado');
  const { resultado } = q.body, g = +q.body.ganador;
  if (!resultado || ![p.equipo1, p.equipo2].includes(g)) err('Resultado o ganador inválido');
  db.prepare('UPDATE partidos SET resultado=?, ganador=? WHERE id=?').run(resultado, g, p.id);
  s.json({ ok: 'Resultado registrado' });
}));

// R7: clasificación automática (3 puntos por victoria)
app.get('/api/clasificacion/:t', auth, (q, s) => {
  const n = Object.fromEntries(db.prepare('SELECT id,nombre FROM equipos').all().map(e => [e.id, e.nombre]));
  const t = {};
  for (const p of db.prepare('SELECT * FROM partidos WHERE torneo_id=?').all(q.params.t)) {
    for (const e of [p.equipo1, p.equipo2]) t[e] ??= { equipo: n[e], pj: 0, pg: 0, pp: 0, pts: 0 };
    if (p.ganador) {
      const l = p.ganador === p.equipo1 ? p.equipo2 : p.equipo1;
      t[p.ganador].pj++; t[p.ganador].pg++; t[p.ganador].pts += 3;
      t[l].pj++; t[l].pp++;
    }
  }
  s.json(Object.values(t).sort((a, b) => b.pts - a.pts || b.pg - a.pg));
});

app.listen(process.env.PORT || 3000, () => console.log('Servidor en puerto ' + (process.env.PORT || 3000)));
