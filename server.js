const express = require('express'), Database = require('better-sqlite3'),
  bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken'), crypto = require('node:crypto'),
  { OAuth2Client } = require('google-auth-library'), nodemailer = require('nodemailer');
const db = new Database(process.env.DB_PATH || 'paddle.db');
const SECRET = process.env.JWT_SECRET || 'cambia-este-secreto';
const ADMIN_CODE = process.env.ADMIN_CODE || 'PADDLE2025';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ||
  (process.env.RENDER_EXTERNAL_URL
    ? new URL('/auth/google/callback', process.env.RENDER_EXTERNAL_URL).toString()
    : undefined);
const googleConfigMissing = [
  !GOOGLE_CLIENT_ID && 'GOOGLE_CLIENT_ID',
  !GOOGLE_CLIENT_SECRET && 'GOOGLE_CLIENT_SECRET',
  !GOOGLE_REDIRECT_URI && 'GOOGLE_REDIRECT_URI'
].filter(Boolean);
const googleEnabled = !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI);
const googleClient = googleEnabled
  ? new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI) : null;
const TIME_ZONE = process.env.APP_TIMEZONE || 'America/Bogota';
const smtpEnabled = !!(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS);
const mailer = smtpEnabled ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : Number(process.env.SMTP_PORT) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000
}) : null;

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios(id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, usuario TEXT UNIQUE NOT NULL, clave TEXT NOT NULL, rol TEXT NOT NULL, email TEXT, google_sub TEXT);
CREATE TABLE IF NOT EXISTS jugadores(id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, categoria TEXT NOT NULL, usuario_id INTEGER);
CREATE TABLE IF NOT EXISTS equipos(id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, jugador1 INTEGER NOT NULL, jugador2 INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS torneos(id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, fecha_inicio TEXT NOT NULL, reglas TEXT);
CREATE TABLE IF NOT EXISTS partidos(id INTEGER PRIMARY KEY, torneo_id INTEGER NOT NULL, fecha TEXT NOT NULL, equipo1 INTEGER NOT NULL, equipo2 INTEGER NOT NULL, resultado TEXT, ganador INTEGER, hora TEXT NOT NULL DEFAULT '18:00', lugar TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS notificaciones(id INTEGER PRIMARY KEY, usuario_id INTEGER NOT NULL, partido_id INTEGER NOT NULL, titulo TEXT NOT NULL, mensaje TEXT NOT NULL, leida INTEGER NOT NULL DEFAULT 0, creada_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS oauth_states(state TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
`);

const userColumns = new Set(db.prepare('PRAGMA table_info(usuarios)').all().map(c => c.name));
if (!userColumns.has('email')) db.exec('ALTER TABLE usuarios ADD COLUMN email TEXT');
if (!userColumns.has('google_sub')) db.exec('ALTER TABLE usuarios ADD COLUMN google_sub TEXT');
const matchColumns = new Set(db.prepare('PRAGMA table_info(partidos)').all().map(c => c.name));
if (!matchColumns.has('hora')) db.exec("ALTER TABLE partidos ADD COLUMN hora TEXT NOT NULL DEFAULT '18:00'");
if (!matchColumns.has('lugar')) db.exec("ALTER TABLE partidos ADD COLUMN lugar TEXT NOT NULL DEFAULT ''");
db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_email_unique ON usuarios(email COLLATE NOCASE) WHERE email IS NOT NULL AND email <> '';
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_google_sub_unique ON usuarios(google_sub) WHERE google_sub IS NOT NULL;
`);

const app = express();
app.use(express.json());
app.use(express.static('public'));

const err = m => { throw new Error(m); };
const wrap = f => (q, s) => { try { f(q, s); } catch (e) { s.status(400).json({ error: e.message }); } };
const sessionFor = u => ({
  token: jwt.sign({ id: u.id, rol: u.rol, nombre: u.nombre }, SECRET, { expiresIn: '8h' }),
  rol: u.rol,
  nombre: u.nombre,
  email: u.email
});
const googleRedirect = code => `/?google=${encodeURIComponent(code)}`;
const auth = (q, s, n) => {
  try { q.u = jwt.verify((q.headers.authorization || '').slice(7), SECRET); n(); }
  catch { s.status(401).json({ error: 'No autenticado' }); }
};
const admin = (q, s, n) => q.u.rol === 'admin' ? n() : s.status(403).json({ error: 'Solo administradores' });

app.get('/api/config', (q, s) => s.json({
  googleEnabled,
  googleRedirectUri: GOOGLE_REDIRECT_URI || null,
  googleConfigMissing,
  timeZone: TIME_ZONE
}));

app.get('/auth/google', (q, s) => {
  if (!googleClient) return s.redirect(googleRedirect('not-configured'));
  const state = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM oauth_states WHERE expires_at <= ?').run(Math.floor(Date.now() / 1000));
  db.prepare('INSERT INTO oauth_states(state,expires_at) VALUES(?,?)').run(state, Math.floor(Date.now() / 1000) + 600);
  s.redirect(googleClient.generateAuthUrl({
    access_type: 'online',
    include_granted_scopes: true,
    prompt: 'select_account',
    scope: ['openid', 'email', 'profile'],
    state
  }));
});

app.get('/auth/google/callback', async (q, s) => {
  try {
    if (q.query.error) return s.redirect(googleRedirect('cancelled'));
    const state = typeof q.query.state === 'string' ? q.query.state : '';
    const storedState = db.prepare('SELECT state FROM oauth_states WHERE state=? AND expires_at>?')
      .get(state, Math.floor(Date.now() / 1000));
    if (!storedState) return s.redirect(googleRedirect('invalid-state'));
    db.prepare('DELETE FROM oauth_states WHERE state=?').run(state);
    if (!googleClient || typeof q.query.code !== 'string') return s.redirect(googleRedirect('failed'));

    const { tokens } = await googleClient.getToken(q.query.code);
    const ticket = await googleClient.verifyIdToken({ idToken: tokens.id_token, audience: GOOGLE_CLIENT_ID });
    const profile = ticket.getPayload();
    if (!profile?.sub || !profile.email || profile.email_verified !== true)
      return s.redirect(googleRedirect('unverified-email'));

    const u = db.transaction(() => {
      let user = db.prepare('SELECT * FROM usuarios WHERE google_sub=?').get(profile.sub);
      if (user) return user;

      user = db.prepare('SELECT * FROM usuarios WHERE email=? COLLATE NOCASE').get(profile.email);
      if (user) {
        if (user.google_sub) throw new Error('account-conflict');
        db.prepare('UPDATE usuarios SET google_sub=? WHERE id=?').run(profile.sub, user.id);
        return db.prepare('SELECT * FROM usuarios WHERE id=?').get(user.id);
      }

      const name = profile.name || profile.email.split('@')[0];
      const username = `google_${crypto.randomBytes(12).toString('hex')}`;
      const passwordHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);
      const created = db.prepare('INSERT INTO usuarios(nombre,usuario,clave,rol,email,google_sub) VALUES(?,?,? ,?,?,?)')
        .run(name, username, passwordHash, 'jugador', profile.email, profile.sub);
      db.prepare('INSERT INTO jugadores(nombre,categoria,usuario_id) VALUES(?,?,?)')
        .run(name, 'Principiante', created.lastInsertRowid);
      return db.prepare('SELECT * FROM usuarios WHERE id=?').get(created.lastInsertRowid);
    })();

    const session = sessionFor(u);
    s.redirect(`/#token=${encodeURIComponent(session.token)}&rol=${encodeURIComponent(session.rol)}&nombre=${encodeURIComponent(session.nombre)}`);
  } catch (e) {
    if (e instanceof Error && e.message === 'account-conflict') return s.redirect(googleRedirect('account-conflict'));
    console.error('Google sign-in failed:', e instanceof Error ? e.message : 'Unknown error');
    return s.redirect(googleRedirect('failed'));
  }
});

// R1 y R6: registro de jugadores / administradores (con código de acceso)
app.post('/api/registro', wrap((q, s) => {
  const { nombre, usuario, clave, categoria, codigo } = q.body;
  const email = String(q.body.email || '').trim().toLowerCase();
  if (!nombre || !usuario || !clave) err('Completa todos los campos');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) err('Ingresa un correo electrónico válido');
  if (clave.length < 6) err('La contraseña debe tener mínimo 6 caracteres');
  const esAdmin = !!codigo;
  if (esAdmin && codigo !== ADMIN_CODE) err('Código de acceso incorrecto');
  if (!esAdmin && !categoria) err('Selecciona una categoría');
  if (db.prepare('SELECT 1 FROM usuarios WHERE usuario=?').get(usuario))
    err(esAdmin ? 'El administrador ya existe' : 'El jugador ya existe en el sistema');
  if (db.prepare('SELECT 1 FROM usuarios WHERE email=? COLLATE NOCASE').get(email)) err('Ese correo ya está registrado');
  const r = db.prepare('INSERT INTO usuarios(nombre,usuario,clave,rol,email) VALUES(?,?,?,?,?)')
    .run(nombre, usuario, bcrypt.hashSync(clave, 10), esAdmin ? 'admin' : 'jugador', email);
  if (!esAdmin) db.prepare('INSERT INTO jugadores(nombre,categoria,usuario_id) VALUES(?,?,?)').run(nombre, categoria, r.lastInsertRowid);
  s.json({ ok: 'Registro exitoso' });
}));

// CU-01: inicio de sesión (el rol define la vista)
app.post('/api/login', wrap((q, s) => {
  const u = db.prepare('SELECT * FROM usuarios WHERE usuario=?').get(q.body.usuario);
  if (!u || !bcrypt.compareSync(q.body.clave || '', u.clave)) err('Credenciales incorrectas');
  s.json(sessionFor(u));
}));

app.get('/api/cuenta', auth, (q, s) => {
  const u = db.prepare('SELECT nombre,email,rol FROM usuarios WHERE id=?').get(q.u.id);
  s.json(u);
});
app.put('/api/cuenta/email', auth, wrap((q, s) => {
  const email = String(q.body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) err('Ingresa un correo electrónico válido');
  if (db.prepare('SELECT 1 FROM usuarios WHERE email=? COLLATE NOCASE AND id<>?').get(email, q.u.id))
    err('Ese correo ya está registrado en otra cuenta');
  db.prepare('UPDATE usuarios SET email=? WHERE id=?').run(email, q.u.id);
  s.json({ ok: 'Correo actualizado. Recibirás allí los avisos de tus partidos.' });
}));

app.get('/api/jugadores', auth, (q, s) => s.json(db.prepare('SELECT id,nombre,categoria FROM jugadores').all()));
app.get('/api/notificaciones', auth, (q, s) => s.json(db.prepare(
  'SELECT id,partido_id,titulo,mensaje,leida,creada_en FROM notificaciones WHERE usuario_id=? ORDER BY creada_en DESC,id DESC LIMIT 100'
).all(q.u.id)));
app.put('/api/notificaciones/:id/leida', auth, wrap((q, s) => {
  const result = db.prepare('UPDATE notificaciones SET leida=1 WHERE id=? AND usuario_id=?').run(q.params.id, q.u.id);
  if (!result.changes) err('Aviso no encontrado');
  s.json({ ok: 'Aviso marcado como leído' });
}));

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
  s.json(r);
}));
app.post('/api/partidos', auth, admin, wrap((q, s) => {
  const { torneo_id, fecha } = q.body, hora = q.body.hora, lugar = String(q.body.lugar || '').trim();
  const e1 = +q.body.equipo1, e2 = +q.body.equipo2;
  const ex = i => db.prepare('SELECT 1 FROM equipos WHERE id=?').get(i);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) err('Indica una fecha válida');
  const [year, month, day] = fecha.split('-').map(Number);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (parsedDate.getUTCFullYear() !== year || parsedDate.getUTCMonth() !== month - 1 || parsedDate.getUTCDate() !== day)
    err('Indica una fecha válida');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora || '')) err('Indica una hora válida');
  if (lugar.length > 200) err('El lugar no puede superar 200 caracteres');
  if (e1 === e2 || !ex(e1) || !ex(e2)) err('Selecciona dos equipos válidos y distintos');
  const torneo = db.prepare('SELECT * FROM torneos WHERE id=?').get(torneo_id);
  if (!torneo) err('Torneo no encontrado');
  const equipos = db.prepare('SELECT id,nombre FROM equipos WHERE id IN (?,?)').all(e1, e2);
  const equipo1 = equipos.find(e => e.id === e1), equipo2 = equipos.find(e => e.id === e2);
  const titulo = `Partido programado: ${equipo1.nombre} vs ${equipo2.nombre}`;
  const mensaje = `${torneo.nombre} · ${equipo1.nombre} vs ${equipo2.nombre} · ${fecha} ${hora} (${TIME_ZONE}) · Lugar: ${lugar || 'Por confirmar'}`;
  const participantes = db.prepare(`
    SELECT j.id AS jugador_id,u.id,u.nombre,u.email
    FROM equipos e
    JOIN jugadores j ON j.id=e.jugador1 OR j.id=e.jugador2
    LEFT JOIN usuarios u ON u.id=j.usuario_id
    WHERE e.id IN (?,?)
  `).all(e1, e2);
  const destinatarios = [...new Map(participantes.filter(p => p.id).map(p => [p.id, p])).values()];
  const jugadoresSinCuenta = participantes.filter(p => !p.id).length;
  const jugadoresNoEncontrados = Math.max(0, 4 - participantes.length);
  const partidoId = db.transaction(() => {
    const result = db.prepare('INSERT INTO partidos(torneo_id,fecha,hora,lugar,equipo1,equipo2) VALUES(?,?,?,?,?,?)')
      .run(torneo_id, fecha, hora, lugar, e1, e2);
    const notification = db.prepare('INSERT INTO notificaciones(usuario_id,partido_id,titulo,mensaje) VALUES(?,?,?,?)');
    destinatarios.forEach(d => notification.run(d.id, result.lastInsertRowid, titulo, mensaje));
    return result.lastInsertRowid;
  })();

  const enviar = async () => {
    const warnings = [];
    if (jugadoresSinCuenta)
      warnings.push(`${jugadoresSinCuenta} jugador(es) no tienen una cuenta de usuario y no pueden recibir avisos dentro de la app.`);
    if (jugadoresNoEncontrados)
      warnings.push(`No se encontraron ${jugadoresNoEncontrados} jugador(es) en los equipos seleccionados.`);
    const conCorreo = destinatarios.filter(d => d.email);
    if (!smtpEnabled) warnings.push('Correo no configurado; los avisos están disponibles dentro de la app.');
    else {
      if (conCorreo.length < destinatarios.length)
        warnings.push(`${destinatarios.length - conCorreo.length} jugador(es) no tienen correo registrado.`);
      const asunto = `Partido programado: ${equipo1.nombre} vs ${equipo2.nombre}`;
      const texto = [
        '',
        'Se programó un partido de paddle:',
        `Torneo: ${torneo.nombre}`,
        `Equipos: ${equipo1.nombre} vs ${equipo2.nombre}`,
        `Fecha: ${fecha}`,
        `Hora: ${hora} (${TIME_ZONE})`,
        `Lugar: ${lugar || 'Por confirmar'}`
      ].join('\n');
      const results = await Promise.allSettled(conCorreo.map(d => mailer.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: d.email,
        subject: asunto,
        text: `Hola, ${d.nombre}.${texto}`
      })));
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed) {
        console.error(`Match notification email delivery failed for ${failed} recipient(s).`);
        warnings.push(`No se pudo enviar el correo a ${failed} jugador(es); sus avisos internos sí están guardados.`);
      }
    }
    s.status(201).json({
      ok: 'Partido programado. Se generaron avisos para los jugadores de ambos equipos.',
      warning: warnings.join(' ')
    });
  };
  enviar().catch(e => {
    console.error('Match notification email delivery failed:', e.message);
    s.status(201).json({
      ok: 'Partido programado. Los avisos internos están guardados.',
      warning: 'No se pudieron enviar los correos. Revisa la configuración SMTP.'
    });
  });
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
