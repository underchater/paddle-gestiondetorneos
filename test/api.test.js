const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const port = 34123;
const dbPath = path.join(os.tmpdir(), `paddle-test-${process.pid}.db`);
let server;
let adminToken;
let playerToken;

async function request(urlPath, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, options);
  const body = await response.json();
  return { response, body };
}

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const { response } = await request('/api/config');
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('El servidor de prueba no inició.');
}

test.before(async () => {
  fs.rmSync(dbPath, { force: true });
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      DB_PATH: dbPath,
      JWT_SECRET: 'clave-de-prueba',
      ADMIN_CODE: 'PADDLE2025',
      APP_TIMEZONE: 'America/Bogota'
    },
    stdio: 'ignore'
  });
  await waitForServer();
});

test.after(async () => {
  if (server && !server.killed) {
    await new Promise(resolve => {
      server.once('exit', resolve);
      server.kill();
    });
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      fs.rmSync(dbPath, { force: true });
      break;
    } catch (error) {
      if (error.code !== 'EPERM') throw error;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
});

test('configura SQLite local y permite comprobar el estado', async () => {
  const { response, body } = await request('/api/config');
  assert.equal(response.ok, true);
  assert.equal(body.database, 'sqlite');
  assert.equal(body.registrationEnabled, true);
});

test('registra cuentas y permite iniciar sesión', async () => {
  const adminResult = await request('/api/registro', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nombre: 'Admin Prueba',
      usuario: 'admin_test',
      clave: '123456',
      email: 'admin@test.local',
      codigo: 'PADDLE2025'
    })
  });
  assert.equal(adminResult.response.ok, true);

  for (const [usuario, email] of [['jugador1', 'jugador1@test.local'], ['jugador2', 'jugador2@test.local']]) {
    const result = await request('/api/registro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: usuario, usuario, clave: '123456', email, categoria: 'Intermedio' })
    });
    assert.equal(result.response.ok, true);
  }

  const adminLogin = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'admin_test', clave: '123456' })
  });
  assert.equal(adminLogin.response.ok, true);
  assert.equal(adminLogin.body.rol, 'admin');
  adminToken = adminLogin.body.token;

  const playerLogin = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'jugador1', clave: '123456' })
  });
  assert.equal(playerLogin.response.ok, true);
  assert.equal(playerLogin.body.rol, 'jugador');
  playerToken = playerLogin.body.token;
});

test('crea torneo, equipos y partido, registra resultado y calcula clasificación', async () => {
  const authAdmin = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };

  const tournament = await request('/api/torneos', {
    method: 'POST',
    headers: authAdmin,
    body: JSON.stringify({ nombre: 'Torneo API', fecha_inicio: '2026-12-01', reglas: 'Juego tradicional' })
  });
  assert.equal(tournament.response.ok, true);

  const tournaments = await request('/api/torneos', { headers: authAdmin });
  assert.equal(tournaments.response.ok, true);
  const tournamentId = tournaments.body.find(item => item.nombre === 'Torneo API').id;

  const players = await request('/api/jugadores', { headers: authAdmin });
  assert.equal(players.body.length >= 2, true);
  const playerIds = players.body.slice(0, 2).map(item => item.id);

  const team1 = await request('/api/equipos', {
    method: 'POST',
    headers: authAdmin,
    body: JSON.stringify({ nombre: 'Pareja Uno', jugador1: playerIds[0], jugador2: playerIds[1] })
  });
  assert.equal(team1.response.ok, true);

  const allTeams = await request('/api/equipos', { headers: authAdmin });
  assert.equal(allTeams.body.length, 1);
  const teamId = allTeams.body[0].id;

  const onlyTeamPart = await request('/api/partidos', {
    method: 'POST',
    headers: authAdmin,
    body: JSON.stringify({ torneo_id: tournamentId, fecha: '2026-12-02', hora: '18:00', lugar: 'Cancha 1', equipo1: teamId, equipo2: teamId })
  });
  assert.equal(onlyTeamPart.response.ok, false);

  const team2Player = await request('/api/registro', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Jugador 3', usuario: 'jugador3', clave: '123456', email: 'jugador3@test.local', categoria: 'Avanzado' })
  });
  assert.equal(team2Player.response.ok, true);

  const team2Player4 = await request('/api/registro', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Jugador 4', usuario: 'jugador4', clave: '123456', email: 'jugador4@test.local', categoria: 'Avanzado' })
  });
  assert.equal(team2Player4.response.ok, true);

  const refreshedPlayers = await request('/api/jugadores', { headers: authAdmin });
  const extraIds = refreshedPlayers.body.filter(item => ['Jugador 3', 'Jugador 4'].includes(item.nombre)).map(item => item.id);
  const team2 = await request('/api/equipos', {
    method: 'POST',
    headers: authAdmin,
    body: JSON.stringify({ nombre: 'Pareja Dos', jugador1: extraIds[0], jugador2: extraIds[1] })
  });
  assert.equal(team2.response.ok, true);

  const teams = await request('/api/equipos', { headers: authAdmin });
  const teamsByName = Object.fromEntries(teams.body.map(team => [team.nombre, team.id]));

  const match = await request('/api/partidos', {
    method: 'POST',
    headers: authAdmin,
    body: JSON.stringify({
      torneo_id: tournamentId,
      fecha: '2026-12-02',
      hora: '18:00',
      lugar: 'Cancha 1',
      equipo1: teamsByName['Pareja Uno'],
      equipo2: teamsByName['Pareja Dos']
    })
  });
  assert.equal(match.response.ok, true);

  const matches = await request(`/api/partidos/${tournamentId}`, { headers: authAdmin });
  const matchId = matches.body[0].id;
  const result = await request(`/api/partidos/${matchId}/resultado`, {
    method: 'PUT',
    headers: authAdmin,
    body: JSON.stringify({ resultado: '6-4 6-3', ganador: teamsByName['Pareja Uno'] })
  });
  assert.equal(result.response.ok, true);

  const standings = await request(`/api/clasificacion/${tournamentId}`, { headers: authAdmin });
  assert.equal(standings.body[0].equipo, 'Pareja Uno');
  assert.equal(standings.body[0].pts, 3);
  assert.equal(standings.body[0].pg, 1);
});

test('protege las operaciones administrativas', async () => {
  const result = await request('/api/torneos', {
    method: 'POST',
    headers: { Authorization: `Bearer ${playerToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'No permitido', fecha_inicio: '2026-12-10' })
  });
  assert.equal(result.response.status, 403);
});
