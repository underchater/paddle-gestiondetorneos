const express = require('express'),
  bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken'), crypto = require('node:crypto'),
  { OAuth2Client } = require('google-auth-library'), nodemailer = require('nodemailer');
const { db, initializeDatabase, isPostgres } = require('./database');
const SECRET = process.env.JWT_SECRET || 'cambia-este-secreto';
const ADMIN_CODE = process.env.ADMIN_CODE || 'PADDLE2025';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ||
  (process.env.RENDER_EXTERNAL_URL
    ? new URL('/auth/google/callback', process.env.RENDER_EXTERNAL_URL).toString()
    : undefined);
const persistentDatabaseRequired = process.env.NODE_ENV === 'production' && !isPostgres;
const googleConfigMissing = [
  !GOOGLE_CLIENT_ID && 'GOOGLE_CLIENT_ID',
  !GOOGLE_CLIENT_SECRET && 'GOOGLE_CLIENT_SECRET',
  !GOOGLE_REDIRECT_URI && 'GOOGLE_REDIRECT_URI',
  persistentDatabaseRequired && 'DATABASE_URL'
].filter(Boolean);
const googleEnabled = !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI && !persistentDatabaseRequired);
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

const app = express();
app.use(express.json());
app.use(express.static('public'));

const err = m => { throw new Error(m); };
const conflict = m => { const error = new Error(m); error.status = 409; throw error; };
const wrap = f => (q, s) => Promise.resolve().then(() => f(q, s)).catch(e => {
  console.error('API request failed:', e instanceof Error ? e.message : 'Unknown error');
  if (s.headersSent) return;
  const duplicateInscription = e?.code === '23505' && e?.constraint?.includes('torneo_inscripciones')
    || e?.code === 'SQLITE_CONSTRAINT_UNIQUE' && e?.message?.includes('torneo_inscripciones');
  const message = e?.code === '23505'
    ? duplicateInscription ? 'Ya estás inscrito en este torneo.' : 'Ese usuario o correo ya está registrado.'
    : duplicateInscription ? 'Ya estás inscrito en este torneo.'
    : e instanceof Error ? e.message : 'Ocurrió un error inesperado.';
  s.status(e?.status || (e?.code === '23505' || duplicateInscription ? 409 : 400)).json({ error: message });
});
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
  database: isPostgres ? 'postgres' : 'sqlite',
  persistentStorage: isPostgres,
  registrationEnabled: !persistentDatabaseRequired,
  timeZone: TIME_ZONE
}));

app.get('/auth/google', wrap(async (q, s) => {
  if (persistentDatabaseRequired) return s.redirect(googleRedirect('database-not-configured'));
  if (!googleClient) return s.redirect(googleRedirect('not-configured'));
  const state = crypto.randomBytes(32).toString('hex');
  await db.prepare('DELETE FROM oauth_states WHERE expires_at <= ?').run(Math.floor(Date.now() / 1000));
  await db.prepare('INSERT INTO oauth_states(state,expires_at) VALUES(?,?)').run(state, Math.floor(Date.now() / 1000) + 600);
  s.redirect(googleClient.generateAuthUrl({
    access_type: 'online',
    include_granted_scopes: true,
    prompt: 'select_account',
    scope: ['openid', 'email', 'profile'],
    state
  }));
}));

app.get('/auth/google/callback', async (q, s) => {
  let stage = 'callback';
  try {
    if (q.query.error) {
      const code = q.query.error === 'access_denied' ? 'cancelled' : 'google-denied';
      console.warn('Google sign-in was not authorized:', code);
      return s.redirect(googleRedirect(code));
    }
    const state = typeof q.query.state === 'string' ? q.query.state : '';
    stage = 'state-validation';
    const storedState = await db.prepare('SELECT state FROM oauth_states WHERE state=? AND expires_at>?')
      .get(state, Math.floor(Date.now() / 1000));
    if (!storedState) {
      console.warn('Google sign-in rejected: state missing, expired, or already used.');
      return s.redirect(googleRedirect('invalid-state'));
    }
    await db.prepare('DELETE FROM oauth_states WHERE state=?').run(state);
    if (!googleClient || typeof q.query.code !== 'string')
      return s.redirect(googleRedirect('token-exchange'));

    stage = 'token-exchange';
    const { tokens } = await googleClient.getToken(q.query.code);
    stage = 'profile-verification';
    const ticket = await googleClient.verifyIdToken({ idToken: tokens.id_token, audience: GOOGLE_CLIENT_ID });
    const profile = ticket.getPayload();
    if (!profile?.sub || !profile.email || profile.email_verified !== true)
      return s.redirect(googleRedirect('unverified-email'));

    stage = 'account-setup';
    const u = await db.transaction(async tx => {
      let user = await tx.prepare('SELECT * FROM usuarios WHERE google_sub=?').get(profile.sub);
      if (user) return user;

      user = await tx.prepare('SELECT * FROM usuarios WHERE LOWER(email)=LOWER(?)').get(profile.email);
      if (user) {
        if (user.google_sub) throw new Error('account-conflict');
        await tx.prepare('UPDATE usuarios SET google_sub=? WHERE id=?').run(profile.sub, user.id);
        return tx.prepare('SELECT * FROM usuarios WHERE id=?').get(user.id);
      }

      const name = profile.name || profile.email.split('@')[0];
      const username = `google_${crypto.randomBytes(12).toString('hex')}`;
      const passwordHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);
      const created = await tx.prepare('INSERT INTO usuarios(nombre,usuario,clave,rol,email,google_sub) VALUES(?,?,? ,?,?,?) RETURNING id')
        .get(name, username, passwordHash, 'jugador', profile.email, profile.sub);
      await tx.prepare('INSERT INTO jugadores(nombre,categoria,usuario_id) VALUES(?,?,?)')
        .run(name, 'Principiante', created.id);
      return tx.prepare('SELECT * FROM usuarios WHERE id=?').get(created.id);
    })();

    stage = 'session-creation';
    const session = sessionFor(u);
    s.redirect(`/#token=${encodeURIComponent(session.token)}&rol=${encodeURIComponent(session.rol)}&nombre=${encodeURIComponent(session.nombre)}`);
  } catch (e) {
    if (e instanceof Error && e.message === 'account-conflict') return s.redirect(googleRedirect('account-conflict'));
    const errorResponse = e && typeof e === 'object' && 'response' in e ? e.response : null;
    const providerCode = errorResponse && typeof errorResponse === 'object' && 'data' in errorResponse &&
      errorResponse.data && typeof errorResponse.data === 'object' && 'error' in errorResponse.data
      ? errorResponse.data.error : null;
    const rawCode = typeof providerCode === 'string' ? providerCode
      : e && typeof e === 'object' && 'code' in e && typeof e.code === 'string' ? e.code : '';
    const code = /^[a-zA-Z0-9_-]{1,80}$/.test(rawCode) ? rawCode : 'unknown';
    const status = errorResponse && typeof errorResponse === 'object' && 'status' in errorResponse
      && Number.isInteger(errorResponse.status) ? errorResponse.status : null;
    console.error('Google sign-in failed:', JSON.stringify({ stage, code, status }));
    return s.redirect(`${googleRedirect('failed')}&stage=${encodeURIComponent(stage)}&reason=${encodeURIComponent(code)}`);
  }
});

// R1 y R6: registro de jugadores / administradores (con código de acceso)
app.post('/api/registro', wrap(async (q, s) => {
  if (persistentDatabaseRequired)
    return s.status(503).json({ error: 'No se guardó la cuenta: configura DATABASE_URL con una base PostgreSQL en Render.' });
  const { nombre, usuario, clave, categoria, codigo } = q.body;
  const email = String(q.body.email || '').trim().toLowerCase();
  if (!nombre || !usuario || !clave) err('Completa todos los campos');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) err('Ingresa un correo electrónico válido');
  if (clave.length < 6) err('La contraseña debe tener mínimo 6 caracteres');
  const esAdmin = !!codigo;
  if (esAdmin && codigo !== ADMIN_CODE) err('Código de acceso incorrecto');
  if (!esAdmin && !categoria) err('Selecciona una categoría');
  if (await db.prepare('SELECT 1 FROM usuarios WHERE usuario=?').get(usuario))
    err(esAdmin ? 'El administrador ya existe' : 'El jugador ya existe en el sistema');
  if (await db.prepare('SELECT 1 FROM usuarios WHERE LOWER(email)=LOWER(?)').get(email)) err('Ese correo ya está registrado');
  await db.transaction(async tx => {
    const user = await tx.prepare('INSERT INTO usuarios(nombre,usuario,clave,rol,email) VALUES(?,?,?,?,?) RETURNING id')
      .get(nombre, usuario, bcrypt.hashSync(clave, 10), esAdmin ? 'admin' : 'jugador', email);
    if (!esAdmin)
      await tx.prepare('INSERT INTO jugadores(nombre,categoria,usuario_id) VALUES(?,?,?)').run(nombre, categoria, user.id);
  })();
  s.json({ ok: 'Registro exitoso' });
}));

// CU-01: inicio de sesión (el rol define la vista)
app.post('/api/login', wrap(async (q, s) => {
  const u = await db.prepare('SELECT * FROM usuarios WHERE usuario=?').get(q.body.usuario);
  if (!u || !bcrypt.compareSync(q.body.clave || '', u.clave)) err('Credenciales incorrectas');
  s.json(sessionFor(u));
}));

app.get('/api/cuenta', auth, wrap(async (q, s) => {
  const u = await db.prepare('SELECT nombre,email,rol FROM usuarios WHERE id=?').get(q.u.id);
  s.json(u);
}));
app.put('/api/cuenta/email', auth, wrap(async (q, s) => {
  const email = String(q.body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) err('Ingresa un correo electrónico válido');
  if (await db.prepare('SELECT 1 FROM usuarios WHERE LOWER(email)=LOWER(?) AND id<>?').get(email, q.u.id))
    err('Ese correo ya está registrado en otra cuenta');
  await db.prepare('UPDATE usuarios SET email=? WHERE id=?').run(email, q.u.id);
  s.json({ ok: 'Correo actualizado. Recibirás allí los avisos de tus partidos.' });
}));

app.get('/api/jugadores', auth, wrap(async (q, s) => s.json(await db.prepare('SELECT id,nombre,categoria FROM jugadores').all())));
app.put('/api/jugadores/:id', auth, admin, wrap(async (q, s) => {
  const id = q.params.id;
  const nombre = String(q.body.nombre || '').trim();
  const categoria = String(q.body.categoria || '').trim();
  if (!nombre || nombre.length > 120) err('Indica un nombre válido (máximo 120 caracteres).');
  if (!categoria || categoria.length > 60) err('Indica una categoría válida.');
  const jugador = await db.prepare('SELECT id,usuario_id FROM jugadores WHERE id=?').get(id);
  if (!jugador) err('Jugador no encontrado.');
  await db.transaction(async tx => {
    await tx.prepare('UPDATE jugadores SET nombre=?,categoria=? WHERE id=?').run(nombre, categoria, id);
    if (jugador.usuario_id)
      await tx.prepare('UPDATE usuarios SET nombre=? WHERE id=?').run(nombre, jugador.usuario_id);
  })();
  s.json({ ok: 'Jugador actualizado.' });
}));
app.delete('/api/jugadores/:id', auth, admin, wrap(async (q, s) => {
  const id = q.params.id;
  const jugador = await db.prepare('SELECT id FROM jugadores WHERE id=?').get(id);
  if (!jugador) err('Jugador no encontrado.');
  const partido = await db.prepare(`SELECT p.id FROM partidos p
    JOIN equipos e ON (e.id=p.equipo1 OR e.id=p.equipo2)
    WHERE e.jugador1=? OR e.jugador2=? LIMIT 1`).get(id, id);
  if (partido) err('No se puede eliminar: el jugador forma parte de un equipo con partidos registrados.');
  await db.transaction(async tx => {
    await tx.prepare('DELETE FROM torneo_inscripciones WHERE jugador_id=?').run(id);
    await tx.prepare('DELETE FROM equipos WHERE jugador1=? OR jugador2=?').run(id, id);
    await tx.prepare('DELETE FROM jugadores WHERE id=?').run(id);
  })();
  s.json({ ok: 'Jugador eliminado junto con sus equipos sin partidos. Su cuenta de acceso se conservó.' });
}));
app.get('/api/inscripciones/mias', auth, wrap(async (q, s) => {
  s.json(await db.prepare(`SELECT i.torneo_id FROM torneo_inscripciones i
    JOIN jugadores j ON j.id=i.jugador_id WHERE j.usuario_id=?`).all(q.u.id));
}));
app.get('/api/notificaciones', auth, wrap(async (q, s) => s.json(await db.prepare(
  'SELECT id,partido_id,titulo,mensaje,leida,creada_en FROM notificaciones WHERE usuario_id=? ORDER BY creada_en DESC,id DESC LIMIT 100'
).all(q.u.id))));
app.put('/api/notificaciones/:id/leida', auth, wrap(async (q, s) => {
  const result = await db.prepare('UPDATE notificaciones SET leida=1 WHERE id=? AND usuario_id=?').run(q.params.id, q.u.id);
  if (!result.changes) err('Aviso no encontrado');
  s.json({ ok: 'Aviso marcado como leído' });
}));

// R2: equipos
app.get('/api/equipos', auth, wrap(async (q, s) => s.json(await db.prepare(
  'SELECT e.*, a.nombre n1, b.nombre n2 FROM equipos e JOIN jugadores a ON a.id=e.jugador1 JOIN jugadores b ON b.id=e.jugador2').all())));
app.post('/api/equipos', auth, admin, wrap(async (q, s) => {
  const { nombre } = q.body, j1 = +q.body.jugador1, j2 = +q.body.jugador2;
  if (!nombre || !j1 || !j2 || j1 === j2) err('Indica un nombre y dos jugadores distintos');
  if (await db.prepare('SELECT 1 FROM equipos WHERE jugador1 IN(?,?) OR jugador2 IN(?,?)').get(j1, j2, j1, j2))
    err('Los jugadores seleccionados ya pertenecen a otro equipo');
  await db.prepare('INSERT INTO equipos(nombre,jugador1,jugador2) VALUES(?,?,?)').run(nombre, j1, j2);
  s.json({ ok: 'Equipo creado' });
}));
app.put('/api/equipos/:id', auth, admin, wrap(async (q, s) => {
  const id = q.params.id, nombre = String(q.body.nombre || '').trim();
  const jugador1 = String(q.body.jugador1 || ''), jugador2 = String(q.body.jugador2 || '');
  if (!nombre || nombre.length > 120) err('Indica un nombre de equipo válido.');
  if (!jugador1 || !jugador2 || jugador1 === jugador2) err('Selecciona dos jugadores distintos.');
  const equipo = await db.prepare('SELECT * FROM equipos WHERE id=?').get(id);
  if (!equipo) err('Equipo no encontrado.');
  const membershipChanged = String(equipo.jugador1) !== jugador1 || String(equipo.jugador2) !== jugador2;
  if (membershipChanged) {
    const partido = await db.prepare('SELECT id FROM partidos WHERE equipo1=? OR equipo2=? LIMIT 1').get(id, id);
    if (partido) err('No se pueden cambiar los jugadores de un equipo con partidos registrados.');
  }
  const jugadores = await db.prepare('SELECT id FROM jugadores WHERE id IN (?,?)').all(jugador1, jugador2);
  if (jugadores.length !== 2) err('Uno de los jugadores seleccionados ya no existe.');
  if (await db.prepare(`SELECT id FROM equipos WHERE id<>? AND
    (jugador1 IN (?,?) OR jugador2 IN (?,?)) LIMIT 1`).get(id, jugador1, jugador2, jugador1, jugador2))
    err('Uno de los jugadores seleccionados ya pertenece a otro equipo.');
  await db.prepare('UPDATE equipos SET nombre=?,jugador1=?,jugador2=? WHERE id=?')
    .run(nombre, jugador1, jugador2, id);
  s.json({ ok: 'Equipo actualizado.' });
}));
app.delete('/api/equipos/:id', auth, admin, wrap(async (q, s) => {
  const id = q.params.id;
  if (!await db.prepare('SELECT id FROM equipos WHERE id=?').get(id)) err('Equipo no encontrado.');
  if (await db.prepare('SELECT id FROM partidos WHERE equipo1=? OR equipo2=? LIMIT 1').get(id, id))
    err('No se puede eliminar: el equipo tiene partidos registrados.');
  await db.prepare('DELETE FROM equipos WHERE id=?').run(id);
  s.json({ ok: 'Equipo eliminado.' });
}));

// R8: torneos
app.get('/api/torneos', auth, wrap(async (q, s) => s.json(await db.prepare('SELECT * FROM torneos ORDER BY fecha_inicio DESC').all())));
app.post('/api/torneos', auth, admin, wrap(async (q, s) => {
  const { nombre, fecha_inicio, reglas } = q.body;
  if (!nombre || !fecha_inicio) err('Nombre y fecha de inicio son obligatorios');
  await db.prepare('INSERT INTO torneos(nombre,fecha_inicio,reglas) VALUES(?,?,?)').run(nombre, fecha_inicio, reglas || '');
  s.json({ ok: 'Torneo creado' });
}));
app.post('/api/torneos/:id/inscripciones', auth, wrap(async (q, s) => {
  if (q.u.rol !== 'jugador') err('Solo las cuentas de jugador pueden inscribirse.');
  if (!mailer) return s.status(503).json({ error: 'La inscripción requiere que el administrador configure el envío de correo (SMTP).' });
  const torneo = await db.prepare('SELECT nombre,fecha_inicio,reglas FROM torneos WHERE id=?').get(q.params.id);
  if (!torneo) err('Torneo no encontrado.');
  const jugador = await db.prepare(`SELECT j.id,j.nombre,u.email FROM jugadores j
    JOIN usuarios u ON u.id=j.usuario_id WHERE j.usuario_id=?`).get(q.u.id);
  if (!jugador) err('No se encontró un perfil de jugador asociado a tu cuenta.');
  if (!jugador.email) err('Agrega tu correo en Mi cuenta antes de inscribirte.');
  const registration = await db.transaction(async tx => {
    const exists = await tx.prepare('SELECT id FROM torneo_inscripciones WHERE torneo_id=? AND jugador_id=?')
      .get(q.params.id, jugador.id);
    if (exists) conflict('Ya estás inscrito en este torneo.');
    return tx.prepare('INSERT INTO torneo_inscripciones(torneo_id,jugador_id) VALUES(?,?) RETURNING id')
      .get(q.params.id, jugador.id);
  })();
  try {
    await mailer.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: jugador.email,
      subject: `Inscripción confirmada: ${torneo.nombre}`,
      text: [
        `Hola, ${jugador.nombre}.`,
        '',
        'Tu inscripción al torneo fue registrada.',
        '',
        `Torneo: ${torneo.nombre}`,
        `Fecha de inicio: ${torneo.fecha_inicio}`,
        `Reglas: ${torneo.reglas || 'No se especificaron reglas.'}`,
        '',
        'El Club Espinal'
      ].join('\n')
    });
  } catch (error) {
    console.error('Tournament registration email failed:', error instanceof Error ? error.message : 'Unknown error');
    return s.status(201).json({
      ok: 'Inscripción guardada.',
      warning: 'No se pudo enviar la ficha por correo. Revisa que el correo de Mi cuenta sea correcto y contacta al administrador.'
    });
  }
  s.status(201).json({ ok: 'Inscripción confirmada. Te enviamos la ficha del torneo por correo.', id: registration.id });
}));
app.get('/api/inscripciones', auth, admin, wrap(async (q, s) => {
  s.json(await db.prepare(`SELECT i.torneo_id,i.jugador_id,j.nombre,j.categoria
    FROM torneo_inscripciones i JOIN jugadores j ON j.id=i.jugador_id
    ORDER BY i.torneo_id,j.nombre`).all());
}));

// R3 y R4: programar y visualizar partidos
app.get('/api/partidos/:t', auth, wrap(async (q, s) => {
  const r = await db.prepare(`SELECT p.*, a.nombre e1, b.nombre e2 FROM partidos p
    JOIN equipos a ON a.id=p.equipo1 JOIN equipos b ON b.id=p.equipo2 WHERE torneo_id=? ORDER BY fecha`).all(q.params.t);
  s.json(r);
}));
app.post('/api/partidos', auth, admin, wrap(async (q, s) => {
  const { torneo_id, fecha } = q.body, hora = q.body.hora, lugar = String(q.body.lugar || '').trim();
  const e1 = +q.body.equipo1, e2 = +q.body.equipo2;
  const ex = async i => db.prepare('SELECT 1 FROM equipos WHERE id=?').get(i);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) err('Indica una fecha válida');
  const [year, month, day] = fecha.split('-').map(Number);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (parsedDate.getUTCFullYear() !== year || parsedDate.getUTCMonth() !== month - 1 || parsedDate.getUTCDate() !== day)
    err('Indica una fecha válida');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora || '')) err('Indica una hora válida');
  if (lugar.length > 200) err('El lugar no puede superar 200 caracteres');
  if (e1 === e2 || !(await ex(e1)) || !(await ex(e2))) err('Selecciona dos equipos válidos y distintos');
  const torneo = await db.prepare('SELECT * FROM torneos WHERE id=?').get(torneo_id);
  if (!torneo) err('Torneo no encontrado');
  const equipos = await db.prepare('SELECT id,nombre FROM equipos WHERE id IN (?,?)').all(e1, e2);
  const equipo1 = equipos.find(e => e.id === e1), equipo2 = equipos.find(e => e.id === e2);
  const titulo = `Partido programado: ${equipo1.nombre} vs ${equipo2.nombre}`;
  const mensaje = `${torneo.nombre} · ${equipo1.nombre} vs ${equipo2.nombre} · ${fecha} ${hora} (${TIME_ZONE}) · Lugar: ${lugar || 'Por confirmar'}`;
  const participantes = await db.prepare(`
    SELECT j.id AS jugador_id,u.id,u.nombre,u.email
    FROM equipos e
    JOIN jugadores j ON j.id=e.jugador1 OR j.id=e.jugador2
    LEFT JOIN usuarios u ON u.id=j.usuario_id
    WHERE e.id IN (?,?)
  `).all(e1, e2);
  const destinatarios = [...new Map(participantes.filter(p => p.id).map(p => [p.id, p])).values()];
  const jugadoresSinCuenta = participantes.filter(p => !p.id).length;
  const jugadoresNoEncontrados = Math.max(0, 4 - participantes.length);
  await db.transaction(async tx => {
    const result = await tx.prepare('INSERT INTO partidos(torneo_id,fecha,hora,lugar,equipo1,equipo2) VALUES(?,?,?,?,?,?) RETURNING id')
      .get(torneo_id, fecha, hora, lugar, e1, e2);
    for (const destinatario of destinatarios)
      await tx.prepare('INSERT INTO notificaciones(usuario_id,partido_id,titulo,mensaje) VALUES(?,?,?,?)')
        .run(destinatario.id, result.id, titulo, mensaje);
    return result.id;
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
app.put('/api/partidos/:id/resultado', auth, admin, wrap(async (q, s) => {
  const p = await db.prepare('SELECT * FROM partidos WHERE id=?').get(q.params.id);
  if (!p) err('Partido no encontrado');
  const { resultado } = q.body, g = +q.body.ganador;
  if (!resultado || ![p.equipo1, p.equipo2].includes(g)) err('Resultado o ganador inválido');
  await db.prepare('UPDATE partidos SET resultado=?, ganador=? WHERE id=?').run(resultado, g, p.id);
  s.json({ ok: 'Resultado registrado' });
}));

// R7: clasificación automática (3 puntos por victoria)
app.get('/api/clasificacion/:t', auth, wrap(async (q, s) => {
  const n = Object.fromEntries((await db.prepare('SELECT id,nombre FROM equipos').all()).map(e => [e.id, e.nombre]));
  const t = {};
  for (const p of await db.prepare('SELECT * FROM partidos WHERE torneo_id=?').all(q.params.t)) {
    for (const e of [p.equipo1, p.equipo2]) t[e] ??= { equipo: n[e], pj: 0, pg: 0, pp: 0, pts: 0 };
    if (p.ganador) {
      const l = p.ganador === p.equipo1 ? p.equipo2 : p.equipo1;
      t[p.ganador].pj++; t[p.ganador].pg++; t[p.ganador].pts += 3;
      t[l].pj++; t[l].pp++;
    }
  }
  s.json(Object.values(t).sort((a, b) => b.pts - a.pts || b.pg - a.pg));
}));

initializeDatabase().then(() => {
  app.listen(process.env.PORT || 3000, () => console.log(`Servidor en puerto ${process.env.PORT || 3000} (${isPostgres ? 'PostgreSQL' : 'SQLite local'})`));
}).catch(error => {
  console.error('Database startup failed:', error instanceof Error ? error.message : 'Unknown error');
  process.exit(1);
});
