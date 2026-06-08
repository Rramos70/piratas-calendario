let state = {
  games: [], users: [], confirmations: {}, currentUser: null,
  editingId: null, settings: { owner: '', repo: '', token: '' }
};
const LABEL_GAME = 'juego', LABEL_USER = 'usuario', GH_BASE = 'https://api.github.com';

/* ========== STORAGE ========== */
function loadSettings() {
  try { const s = JSON.parse(localStorage.getItem('piratas_settings')); if (s) state.settings = s; } catch {}
}
function saveSettings() { localStorage.setItem('piratas_settings', JSON.stringify(state.settings)); }
function loadSession() {
  try { const u = JSON.parse(sessionStorage.getItem('piratas_session')); if (u) state.currentUser = u; } catch {}
}
function saveSession() { if (state.currentUser) sessionStorage.setItem('piratas_session', JSON.stringify(state.currentUser)); else sessionStorage.removeItem('piratas_session'); }
function clearSession() { state.currentUser = null; sessionStorage.removeItem('piratas_session'); updateUserBadge(); }

function detectRepoFromURL() {
  const parts = window.location.pathname.replace(/\/+$/, '').split('/');
  const host = window.location.hostname;
  if (host.endsWith('.github.io') && parts.length >= 2 && parts[1]) return { owner: host.replace('.github.io', ''), repo: parts[1] };
  return null;
}

/* ========== GITHUB API ========== */
async function ghFetch(url, opts = {}) {
  const useToken = opts._withToken !== false && state.settings.token;
  const headers = { 'Accept': 'application/vnd.github.v3+json' };
  if (useToken) headers['Authorization'] = `Bearer ${state.settings.token}`;
  if (opts.body && typeof opts.body === 'string') headers['Content-Type'] = 'application/json';
  if (opts._type === 'comment') headers['Accept'] = 'application/vnd.github.v3.raw+json';
  Object.assign(headers, opts.headers); delete opts._withToken;
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) { let m = `Error ${res.status}`; try { const d = await res.json(); m = d.message || m; } catch {} throw new Error(m); }
  if (res.status === 204) return null;
  return res.json();
}

function issueTitle(g) { return `[${g.date} ${g.time}] Piratas vs ${g.rival} - ${g.tournament}`; }
function issueLabels(g) {
  const l = [LABEL_GAME, g.homeAway === 'Local' ? 'local' : 'visitante', g.status === 'Jugado' ? 'jugado' : 'por-jugar'];
  if (g.status === 'Jugado' && g.homeScore != null && g.awayScore != null) {
    const ps = g.homeAway === 'Local' ? g.homeScore : g.awayScore;
    const rs = g.homeAway === 'Local' ? g.awayScore : g.homeScore;
    l.push(ps > rs ? 'victoria' : ps < rs ? 'derrota' : 'empate');
  }
  return l;
}

/* ========== GAMES ========== */
function parseGame(i) { try { const g = JSON.parse(i.body); g._issueNumber = i.number; g._issueUrl = i.html_url; return g; } catch { return null; } }
async function fetchGames() {
  const { owner, repo } = state.settings;
  if (!owner || !repo) return [];
  const data = await ghFetch(`${GH_BASE}/repos/${owner}/${repo}/issues?labels=${LABEL_GAME}&state=open&per_page=100`, { _withToken: false });
  state.games = (data||[]).map(parseGame).filter(Boolean);
  state.games.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return state.games;
}
async function createGame(g) {
  if (!requireToken('crear partidos')) return;
  const d = await ghFetch(`${GH_BASE}/repos/${state.settings.owner}/${state.settings.repo}/issues`, { method: 'POST', body: JSON.stringify({ title: issueTitle(g), body: JSON.stringify(g), labels: issueLabels(g) }) });
  const ng = parseGame(d); state.games.push(ng); state.games.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)); return ng;
}
async function updateGame(num, g) {
  if (!requireToken('editar partidos')) return;
  await ghFetch(`${GH_BASE}/repos/${state.settings.owner}/${state.settings.repo}/issues/${num}`, { method: 'PATCH', body: JSON.stringify({ title: issueTitle(g), body: JSON.stringify(g), labels: issueLabels(g) }) });
  const idx = state.games.findIndex(x => x._issueNumber === num); if (idx !== -1) { g._issueNumber = num; state.games[idx] = g; }
}
async function deleteGame(num) {
  if (!requireToken('eliminar partidos')) return;
  await ghFetch(`${GH_BASE}/repos/${state.settings.owner}/${state.settings.repo}/issues/${num}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) });
  state.games = state.games.filter(g => g._issueNumber !== num);
}

/* ========== USERS ========== */
function parseUser(i) {
  try { const u = JSON.parse(i.body); u._issueNumber = i.number; u._active = i.labels.some(l => l.name === 'activo'); u._role = i.labels.some(l => l.name === 'admin') ? 'admin' : 'player'; return u; } catch { return null; }
}
async function fetchUsers() {
  const { owner, repo } = state.settings; if (!owner || !repo) return [];
  const data = await ghFetch(`${GH_BASE}/repos/${owner}/${repo}/issues?labels=${LABEL_USER}&state=all&per_page=100`, { _withToken: false });
  state.users = (data||[]).map(parseUser).filter(Boolean); return state.users;
}
function userLabels(u) {
  const l = [LABEL_USER, u.role || 'player'];
  l.push(u.active !== false ? 'activo' : 'inactivo');
  return l;
}
async function createUser(u) {
  if (!requireToken('crear usuarios')) return;
  const body = { title: u.name, body: JSON.stringify(u), labels: userLabels(u) };
  const d = await ghFetch(`${GH_BASE}/repos/${state.settings.owner}/${state.settings.repo}/issues`, { method: 'POST', body: JSON.stringify(body) });
  const nu = parseUser(d); if (nu) state.users.push(nu); return nu;
}
async function updateUser(num, u) {
  if (!requireToken('modificar usuarios')) return;
  await ghFetch(`${GH_BASE}/repos/${state.settings.owner}/${state.settings.repo}/issues/${num}`, { method: 'PATCH', body: JSON.stringify({ title: u.name, body: JSON.stringify(u), labels: userLabels(u) }) });
}
async function setUserActive(num, active) {
  if (!requireToken('cambiar estado de usuarios')) return;
  num = Number(num);
  const u = state.users.find(x => x._issueNumber === num); if (!u) return;
  u.active = active;
  await updateUser(num, u);
  const idx = state.users.findIndex(x => x._issueNumber === num); if (idx !== -1) { state.users[idx]._active = active; state.users[idx].active = active; }
}
async function setUserRole(num, role) {
  if (!requireToken('cambiar rol de usuarios')) return;
  num = Number(num);
  const u = state.users.find(x => x._issueNumber === num); if (!u) return;
  u.role = role;
  await updateUser(num, u);
  const idx = state.users.findIndex(x => x._issueNumber === num); if (idx !== -1) { state.users[idx]._role = role; state.users[idx].role = role; }
}

async function hashPass(p) {
  const e = new TextEncoder(); const d = e.encode(p);
  const h = await crypto.subtle.digest('SHA-256', d);
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ========== CONFIRMATIONS ========== */
async function getConfirmations(gameNum) {
  const { owner, repo } = state.settings; if (!owner || !repo) return [];
  try {
    const data = await ghFetch(`${GH_BASE}/repos/${owner}/${repo}/issues/${gameNum}/comments?per_page=100`, { _withToken: false, _type: 'comment' });
    return (data||[]).map(c => { try { return JSON.parse(c.body); } catch { return null; } }).filter(Boolean).filter(c => c._type === 'confirm');
  } catch { return []; }
}
async function setConfirmation(gameNum, playerName, status) {
  if (!state.currentUser) throw new Error('Debes iniciar sesion');
  const { owner, repo } = state.settings;
  const comment = JSON.stringify({ _type: 'confirm', player: playerName, status: status, timestamp: new Date().toISOString() });
  await ghFetch(`${GH_BASE}/repos/${owner}/${repo}/issues/${gameNum}/comments`, { method: 'POST', body: comment });
}

/* ========== HELPERS ========== */
function formatDate(d) { return new Date(d + 'T12:00:00').toLocaleDateString('es-ES', { day:'numeric', month:'short', year:'numeric' }).replace('.',''); }
function getDayName(d) { return new Date(d + 'T12:00:00').toLocaleDateString('es-ES', { weekday:'long' }); }
function todayStr() { return new Date().toISOString().split('T')[0]; }
function hasToken() { return !!state.settings.token; }
function isAdmin() { return hasToken() || (state.currentUser && state.currentUser._role === 'admin'); }
function isLogged() { return !!state.currentUser; }
function requireToken(action) {
  if (!state.settings.token) {
    throw new Error(`Se necesita el Token de GitHub en Ajustes para ${action}. Ve a Ajustes e ingresa el token.`);
  }
  return true;
}
function updateUserBadge() {
  const el = document.getElementById('user-badge');
  if (state.currentUser) { el.textContent = state.currentUser.name; el.style.display = 'block'; }
  else { el.style.display = 'none'; }
}

function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const navBtn = document.querySelector(`.nav-btn[data-view="${viewId}"]`);
  if (navBtn) navBtn.classList.add('active');
  document.querySelector('.btn-back').style.display = viewId === 'home-view' ? 'none' : 'block';
}

/* ========== RENDER HOME ========== */
async function renderHome() {
  const { owner, repo } = state.settings;
  if (!owner || !repo) {
    document.getElementById('home-content').innerHTML = `<div class="card"><div class="settings-info"><strong>Bienvenido</strong><br>Configura el repositorio en Ajustes.</div><button class="btn btn-gold" onclick="showView('settings-view')">Ir a Ajustes</button></div>`;
    document.getElementById('btn-add-game').style.display = 'none'; return;
  }
  try {
    const games = await fetchGames(); const n = new Date();
    const ns = n.toISOString().split('T')[0]; const nt = n.toTimeString().slice(0, 5);
    const upcoming = games.filter(g => g.status !== 'Jugado' && (g.date + (g.time||'23:59')) >= ns + nt);
    const past = games.filter(g => g.status === 'Jugado' || (g.date + (g.time||'23:59')) < ns + nt);
    let html = '';

    if (upcoming[0]) html += await renderGameCard(upcoming[0], 'Proximo Partido');
    else html += `<div class="card"><div class="empty"><div class="empty-icon">📅</div><p>No hay proximos partidos</p></div></div>`;

    if (past.length) html += await renderGameCard(past[past.length-1], 'Ultimo Partido');
    else html += `<div class="card"><div class="empty"><div class="empty-icon">⚾</div><p>Aun no hay partidos jugados</p></div></div>`;

    document.getElementById('home-content').innerHTML = html;
    document.getElementById('btn-add-game').style.display = isAdmin() ? 'block' : 'none';
  } catch (e) {
    document.getElementById('home-content').innerHTML = `<div class="card"><div class="msg error show">Error: ${e.message}</div><button class="btn btn-gold" onclick="renderHome()">Reintentar</button></div>`;
  }
}

async function renderGameCard(game, title) {
  const played = game.status === 'Jugado';
  const ps = game.homeAway === 'Local' ? game.homeScore : game.awayScore;
  const rs = game.homeAway === 'Local' ? game.awayScore : game.homeScore;
  const win = played && ps > rs; const loss = played && ps < rs;
  let scoreHtml = '';
  if (played && game.homeScore != null && game.awayScore != null) {
    scoreHtml = `<div class="score-box ${win?'win':loss?'loss':'pending'}"><div class="score-display"><span>${ps}</span><span class="dash">-</span><span>${rs}</span></div><div class="score-label ${win?'win-label':loss?'loss-label':'pending-label'}">${win?'VICTORIA':loss?'DERROTA':'EMPATE'}</div></div>`;
  } else if (!played) {
    scoreHtml = `<div class="score-box pending"><div class="score-label pending-label">PENDIENTE</div></div>`;
  }

  let confirmHtml = '';
  if (!played && isLogged()) {
    const confs = await getConfirmations(game._issueNumber);
    const myConf = confs.find(c => c.player === state.currentUser.name);
    confirmHtml = `<div class="confirm-bar">
      <button class="btn btn-green btn-sm" onclick="doConfirm(${game._issueNumber},'si')" ${myConf?.status==='si'?'style=opacity:1':''}>Si, voy</button>
      <button class="btn btn-red btn-sm" onclick="doConfirm(${game._issueNumber},'no')" ${myConf?.status==='no'?'style=opacity:1':''}>No ire</button>
    </div>`;
    if (confs.length) {
      const y = confs.filter(c => c.status === 'si');
      const n = confs.filter(c => c.status === 'no');
      confirmHtml += `<div style="margin-top:8px;font-size:.8rem;color:var(--gray)">Confirmados: ${y.length} | No asisten: ${n.length}</div>`;
    }
  } else if (!played && !isLogged()) {
    confirmHtml = `<div style="margin-top:8px;font-size:.8rem;color:var(--gray)"><a href="#" onclick="showView('team-view');return false">Inicia sesion</a> para confirmar asistencia</div>`;
  }

  return `<div class="card game-card ${played?'played':''}">
    <div class="card-title">${title}</div>
    <div class="game-header">
      <span class="game-vs"><span class="piratas">Piratas</span> vs <span class="rival">${game.rival||'---'}</span></span>
      <span class="game-tournament">${game.tournament||'---'}</span>
    </div>
    ${scoreHtml}
    <div class="game-details">
      <span>${formatDate(game.date)}</span><span>${game.time||'---'}</span>
      <span>${getDayName(game.date)}</span><span>${game.stadium||'---'}</span>
      <span class="badge ${game.homeAway==='Local'?'local':'visit'}">${game.homeAway||'---'}</span>
      <span class="badge ${played?'done':'pend'}">${played?'Jugado':'Por Jugar'}</span>
    </div>
    ${confirmHtml}
  </div>`;
}

async function doConfirm(gameNum, status) {
  try {
    await setConfirmation(gameNum, state.currentUser.name, status);
    renderHome();
  } catch (e) { alert('Error: ' + e.message); }
}

/* ========== RENDER CALENDAR ========== */
async function renderCalendar() {
  const { owner, repo } = state.settings;
  if (!owner || !repo) { document.getElementById('calendar-content').innerHTML = `<div class="card"><div class="settings-info">Configura el repositorio primero.</div></div>`; return; }
  try {
    const games = state.games.length ? state.games : await fetchGames();
    if (!games.length) { document.getElementById('calendar-content').innerHTML = `<div class="card"><div class="empty"><div class="empty-icon">📋</div><p>No hay partidos</p></div></div>`; return; }
    const isAdm = isAdmin();
    let html = `<div class="table-wrap"><table><thead><tr>
      <th>Fecha</th><th>Hora</th><th>Dia</th><th>Torneo</th><th>Rival</th><th>Estadio</th><th>L/V</th><th>Estado</th><th>Score</th>${isAdm?'<th>Acc.</th>':''}
    </tr></thead><tbody>`;
    games.forEach(g => {
      const p = g.status === 'Jugado'; const ps = g.homeAway==='Local'?g.homeScore:g.awayScore; const rs = g.homeAway==='Local'?g.awayScore:g.homeScore;
      html += `<tr>
        <td>${formatDate(g.date)}</td><td>${g.time||'---'}</td><td>${getDayName(g.date)}</td>
        <td>${g.tournament||'---'}</td><td><strong>${g.rival||'---'}</strong></td><td>${g.stadium||'---'}</td>
        <td><span class="badge ${g.homeAway==='Local'?'local':'visit'}">${g.homeAway==='Local'?'L':'V'}</span></td>
        <td><span class="badge ${p?'done':'pend'}">${p?'Jug':'Pend'}</span></td>
        <td><strong>${p&&g.homeScore!=null&&g.awayScore!=null?`${ps}-${rs}`:'---'}</strong></td>
        ${isAdm?`<td><button class="btn btn-blue btn-sm" onclick="editGame(${g._issueNumber})">E</button> <button class="btn btn-red btn-sm" onclick="confirmDelete(${g._issueNumber})">X</button></td>`:''}
      </tr>`;
    });
    html += `</tbody></table></div>`;
    document.getElementById('calendar-content').innerHTML = html;
  } catch (e) { document.getElementById('calendar-content').innerHTML = `<div class="card"><div class="msg error show">Error: ${e.message}</div></div>`; }
}

/* ========== TEAM VIEW ========== */
async function renderTeam() {
  const el = document.getElementById('team-content');
  if (isAdmin()) {
    try { await fetchUsers(); } catch {}
    renderAdminPanel(el);
  } else if (state.currentUser) {
    renderPlayerProfile(el);
  } else {
    renderLoginForm(el);
  }
}

function renderLoginForm(el) {
  el.innerHTML = `<div class="card">
    <div class="card-title">Iniciar Sesion</div>
    <div class="msg" id="login-msg"></div>
    <div class="form-group"><label>Nombre de usuario</label><input type="text" id="login-name" placeholder="Tu nombre registrado"></div>
    <div class="form-group"><label>Contrasena</label><input type="password" id="login-pass" placeholder="Tu contrasena"></div>
    <button class="btn btn-gold" id="btn-login">Entrar</button>
    <hr>
    <p style="text-align:center;font-size:.85rem;color:var(--gray)">No tienes cuenta? <a href="#" onclick="showView('register-view');return false" style="color:var(--blue);font-weight:600">Registrate aqui</a></p>
  </div>`;
  document.getElementById('btn-login').addEventListener('click', doLogin);
}

function renderPlayerProfile(el) {
  const u = state.currentUser;
  el.innerHTML = `<div class="card">
    <div class="card-title">Mi Perfil</div>
    <p style="font-size:1.1rem;font-weight:700">${u.name}</p>
    <p style="font-size:.85rem;color:var(--gray)">${u.email||''} ${u.phone?' | Tel: '+u.phone:''} ${u.dob?' | Nac: '+u.dob:''}</p>
    <p style="font-size:.8rem;margin-top:6px"><span class="badge ${u._active?'activo':'inactivo'}">${u._active?'Activo':'Inactivo'}</span> <span class="badge player">Jugador</span></p>
    <hr>
    <button class="btn btn-red" onclick="doLogout()">Cerrar Sesion</button>
  </div>`;
}

function renderAdminPanel(el) {
  const users = state.users;
  const hasToken = !!state.settings.token;
  let html = `<div class="card"><div class="card-title">Administrar Equipo</div>
    <div class="msg" id="admin-user-msg"></div>
    <p style="font-size:.85rem;color:var(--gray);margin-bottom:10px">Admin: ${state.currentUser?state.currentUser.name:'Token'}</p>
    ${!hasToken?'<div class="msg error show" style="margin-bottom:10px;font-size:.85rem">⚠ Token de GitHub no configurado. Las acciones de administrador requieren el token en <strong>Ajustes</strong>.</div>':''}`;

  // Create user form
  html += `<details style="margin-bottom:12px"><summary style="cursor:pointer;font-weight:600;color:var(--blue);font-size:.85rem">+ Crear nuevo usuario</summary>
    <div style="margin-top:8px;padding:10px;background:var(--gray-light);border-radius:8px">
      <div class="form-row">
        <div class="form-group"><label>Nombre</label><input type="text" id="admin-new-name" placeholder="Nombre"></div>
        <div class="form-group"><label>Contrasena</label><input type="password" id="admin-new-pass" placeholder="pass"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Telefono</label><input type="tel" id="admin-new-phone" placeholder="telefono"></div>
        <div class="form-group"><label>Fecha Nac</label><input type="date" id="admin-new-dob"></div>
      </div>
      <div class="form-group"><label>Email</label><input type="email" id="admin-new-email" placeholder="email"></div>
      <div class="form-row">
        <div class="form-group"><label>Rol</label>
          <select id="admin-new-role"><option value="player">Jugador</option><option value="admin">Admin</option></select>
        </div>
        <div class="form-group"><label>Activo</label>
          <select id="admin-new-active"><option value="true">Si</option><option value="false">No</option></select>
        </div>
      </div>
      <button class="btn btn-blue btn-sm" id="btn-admin-create-user">Crear Usuario</button>
    </div></details>`;

  // Users list
  html += `<h3 style="font-size:.85rem;margin-top:12px">Jugadores (${users.filter(u=>u._role==='player').length})</h3>`;
  users.filter(u => u._role === 'player').forEach(u => {
    html += renderUserItem(u);
  });

  html += `<h3 style="font-size:.85rem;margin-top:12px">Administradores (${users.filter(u=>u._role==='admin').length})</h3>`;
  users.filter(u => u._role === 'admin').forEach(u => {
    html += renderUserItem(u);
  });

  html += `</div>`;
  el.innerHTML = html;

  // Events
  document.getElementById('btn-admin-create-user').addEventListener('click', adminCreateUser);
  document.querySelectorAll('.btn-toggle-active').forEach(btn => btn.addEventListener('click', e => toggleUserActive(e.target.dataset.num)));
  document.querySelectorAll('.btn-set-role').forEach(btn => btn.addEventListener('click', e => toggleUserRole(e.target.dataset.num, e.target.dataset.role)));
}

function renderUserItem(u) {
  const active = u._active !== false;
  return `<div class="user-item">
    <div class="user-info">
      <div class="user-name">${u.name}</div>
      <div class="user-meta"><span class="badge ${active?'activo':'inactivo'}">${active?'Activo':'Inactivo'}</span> <span class="badge ${u._role==='admin'?'admin':'player'}">${u._role==='admin'?'Admin':'Jugador'}</span> ${u.email||''} ${u.phone?'| '+u.phone:''}</div>
    </div>
    <div class="user-actions">
      <button class="btn btn-sm ${active?'btn-gray':'btn-green'} btn-toggle-active" data-num="${u._issueNumber}">${active?'Desactivar':'Activar'}</button>
      <button class="btn btn-sm btn-blue btn-set-role" data-num="${u._issueNumber}" data-role="${u._role==='admin'?'player':'admin'}">${u._role==='admin'?'Hacer Jugador':'Hacer Admin'}</button>
    </div>
  </div>`;
}

async function doLogin() {
  const msg = document.getElementById('login-msg');
  const name = document.getElementById('login-name').value.trim();
  const pass = document.getElementById('login-pass').value.trim();
  if (!name || !pass) { msg.textContent = 'Completa todos los campos'; msg.className = 'msg error show'; return; }
  try {
    await fetchUsers();
    const user = state.users.find(u => u.name.toLowerCase() === name.toLowerCase());
    if (!user) { msg.textContent = 'Usuario no encontrado'; msg.className = 'msg error show'; return; }
    const hash = await hashPass(pass);
    if (user.password !== hash) { msg.textContent = 'Contrasena incorrecta'; msg.className = 'msg error show'; return; }
    if (!user._active) { msg.textContent = 'Tu cuenta esta inactiva. Espera a que el administrador la active.'; msg.className = 'msg error show'; return; }
    state.currentUser = user; saveSession(); updateUserBadge();
    if (user._role === 'admin' && !state.settings.token) {
      msg.textContent = 'Sesion iniciada como admin. Configura el Token en Ajustes para poder realizar acciones.'; msg.className = 'msg warning show';
      setTimeout(() => { showView('settings-view'); renderSettings(); }, 2000);
    } else {
      msg.textContent = 'Sesion iniciada!'; msg.className = 'msg success show';
      setTimeout(() => { showView('home-view'); renderHome(); }, 500);
    }
  } catch (e) { msg.textContent = 'Error: ' + e.message; msg.className = 'msg error show'; }
}

function doLogout() { clearSession(); showView('team-view'); renderTeam(); }

async function doRegister() {
  const msg = document.getElementById('reg-msg');
  const name = document.getElementById('reg-name').value.trim();
  const pass = document.getElementById('reg-pass').value;
  const phone = document.getElementById('reg-phone').value.trim();
  const dob = document.getElementById('reg-dob').value;
  const email = document.getElementById('reg-email').value.trim();
  if (!name || !pass || pass.length < 4) { msg.textContent = 'Nombre y contrasena (min 4 caracteres) obligatorios'; msg.className = 'msg error show'; return; }
  try {
    await fetchUsers();
    if (state.users.some(u => u.name.toLowerCase() === name.toLowerCase())) { msg.textContent = 'Ese nombre ya esta registrado'; msg.className = 'msg error show'; return; }
    const hash = await hashPass(pass);
    const user = { name, password: hash, phone, dob, email, role: 'player', active: false, createdAt: new Date().toISOString() };
    await createUser(user);
    msg.textContent = 'Registro exitoso! El administrador debe activar tu cuenta.'; msg.className = 'msg success show';
    setTimeout(() => { showView('team-view'); renderTeam(); }, 1500);
  } catch (e) { msg.textContent = 'Error: ' + e.message; msg.className = 'msg error show'; }
}

async function adminCreateUser() {
  const msg = document.getElementById('admin-user-msg');
  const name = document.getElementById('admin-new-name').value.trim();
  const pass = document.getElementById('admin-new-pass').value;
  const phone = document.getElementById('admin-new-phone').value.trim();
  const dob = document.getElementById('admin-new-dob').value;
  const email = document.getElementById('admin-new-email').value.trim();
  const role = document.getElementById('admin-new-role').value;
  const active = document.getElementById('admin-new-active').value === 'true';
  if (!name || !pass) { msg.textContent = 'Nombre y contrasena obligatorios'; msg.className = 'msg error show'; return; }
  try {
    const hash = await hashPass(pass);
    const user = { name, password: hash, phone, dob, email, role, active, createdAt: new Date().toISOString() };
    await createUser(user);
    msg.textContent = 'Usuario creado exitosamente'; msg.className = 'msg success show';
    renderTeam();
  } catch (e) { msg.textContent = 'Error: ' + e.message; msg.className = 'msg error show'; }
}

async function toggleUserActive(num) {
  try {
    const u = state.users.find(x => x._issueNumber == num);
    if (!u) { alert('Usuario no encontrado en la lista'); return; }
    await setUserActive(num, !u._active);
    renderTeam();
  } catch (e) { alert('Error: ' + e.message); }
}

async function toggleUserRole(num, newRole) {
  try {
    await setUserRole(num, newRole);
    renderTeam();
  } catch (e) { alert('Error: ' + e.message); }
}

/* ========== GAME FORM ========== */
function getDefaultGame() { return { date: todayStr(), time: '20:00', day: '', tournament: '', rival: '', stadium: '', homeAway: 'Local', status: 'Por Jugar', homeScore: '', awayScore: '' }; }
function openAddForm() { state.editingId = null; document.getElementById('form-title').textContent = 'Nuevo Partido'; fillForm(getDefaultGame()); showView('form-view'); }
function editGame(num) { showView('form-view'); document.getElementById('form-title').textContent = 'Editar Partido'; state.editingId = num; const g = state.games.find(x => x._issueNumber === num); if (g) fillForm(g); }
function fillForm(g) {
  setVal('game-date', g.date||''); setVal('game-time', g.time||''); setVal('game-tournament', g.tournament||''); setVal('game-rival', g.rival||'');
  setVal('game-stadium', g.stadium||''); setVal('game-homeaway', g.homeAway||'Local'); setVal('game-status', g.status||'Por Jugar');
  setVal('game-homescore', g.homeScore!=null?g.homeScore:''); setVal('game-awayscore', g.awayScore!=null?g.awayScore:'');
  toggleScoreFields(g.status === 'Jugado');
}
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
function getVal(id) { const el = document.getElementById(id); return el?el.value:''; }
function toggleScoreFields(s) { document.getElementById('score-fields').style.display = s ? 'block' : 'none'; }
document.addEventListener('change', e => { if (e.target.id === 'game-status') toggleScoreFields(e.target.value === 'Jugado'); });

async function saveGame() {
  const msg = document.getElementById('form-msg'); msg.classList.remove('show');
  const game = { date:getVal('game-date'), time:getVal('game-time'), day:'', tournament:getVal('game-tournament'), rival:getVal('game-rival'), stadium:getVal('game-stadium'), homeAway:getVal('game-homeaway'), status:getVal('game-status'), homeScore:getVal('game-homescore'), awayScore:getVal('game-awayscore') };
  if (!game.date || !game.rival) { msg.textContent = 'Fecha y Rival obligatorios'; msg.className='msg error show'; return; }
  if (game.status === 'Jugado') { if (game.homeScore===''||game.awayScore==='') { msg.textContent='Ingresa el score'; msg.className='msg error show'; return; } if (!/^\d+$/.test(game.homeScore)||!/^\d+$/.test(game.awayScore)) { msg.textContent='Score numerico'; msg.className='msg error show'; return; } }
  game.homeScore = game.homeScore!==''?Number(game.homeScore):null; game.awayScore = game.awayScore!==''?Number(game.awayScore):null;
  try {
    msg.textContent='Guardando...'; msg.className='msg success show';
    if (state.editingId) { await updateGame(state.editingId, game); msg.textContent='Partido actualizado'; }
    else { await createGame(game); msg.textContent='Partido creado'; }
    state.editingId=null; setTimeout(()=>{ showView('home-view'); renderHome(); }, 800);
  } catch(e) { msg.textContent='Error: '+e.message; msg.className='msg error show'; }
}

async function confirmDelete(num) {
  if (!confirm('Eliminar este partido?')) return;
  try { await deleteGame(num); const v=document.querySelector('.view.active'); if(v){if(v.id==='home-view')renderHome();else if(v.id==='calendar-view')renderCalendar();} }
  catch(e) { alert('Error: '+e.message); }
}

/* ========== SETTINGS ========== */
function renderSettings() {
  const s = state.settings;
  document.getElementById('set-owner').value = s.owner||''; document.getElementById('set-repo').value = s.repo||''; document.getElementById('set-token').value = s.token||'';
  document.getElementById('settings-msg').classList.remove('show');
  const se = document.getElementById('admin-status');
  if (se) {
    if (hasToken()) {
      se.textContent='Modo Administrador activo (Token configurado)'; se.className='msg success show';
    } else if (state.currentUser && state.currentUser._role === 'admin') {
      se.textContent='Admin: '+state.currentUser.name+' - Falta Token para acciones de escritura'; se.className='msg warning show';
    } else {
      se.textContent='Solo lectura - Configura el Token para administrar'; se.className='msg info show';
    }
    se.style.display='block';
  }
}
function saveRepoSettings() {
  state.settings.owner=document.getElementById('set-owner').value.trim(); state.settings.repo=document.getElementById('set-repo').value.trim(); saveSettings();
  const m=document.getElementById('settings-msg'); m.textContent='Repositorio guardado'; m.className='msg success show'; renderHome();
}
async function saveToken() {
  const token=document.getElementById('set-token').value.trim(); const msg=document.getElementById('settings-msg');
  if (!state.settings.owner||!state.settings.repo) { msg.textContent='Guarda Owner y Repo primero'; msg.className='msg error show'; return; }
  state.settings.token=token; saveSettings();
  if (token) {
    msg.textContent='Validando...'; msg.className='msg success show';
    try {
      await ghFetch(`${GH_BASE}/repos/${state.settings.owner}/${state.settings.repo}`, {_withToken:true});
      msg.textContent='Token valido'; msg.className='msg success show'; renderSettings(); renderHome();
    } catch (e) {
      msg.textContent='Token invalido: '+e.message; msg.className='msg error show'; state.settings.token=''; saveSettings(); renderSettings();
    }
  } else { msg.textContent='Token eliminado'; msg.className='msg info show'; renderSettings(); renderHome(); }
}

/* ========== REGISTER ========== */
function renderRegister() {
  document.getElementById('reg-msg').classList.remove('show');
  document.getElementById('reg-name').value=''; document.getElementById('reg-pass').value='';
  document.getElementById('reg-phone').value=''; document.getElementById('reg-dob').value=''; document.getElementById('reg-email').value='';
}

/* ========== INIT ========== */
document.addEventListener('DOMContentLoaded', () => {
  loadSettings(); loadSession();

  if (!state.settings.owner||!state.settings.repo) { const d=detectRepoFromURL(); if(d){state.settings.owner=d.owner;state.settings.repo=d.repo;saveSettings();} }
  if (state.currentUser) updateUserBadge();

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const v=btn.dataset.view; showView(v);
      if(v==='home-view') renderHome();
      else if(v==='calendar-view') renderCalendar();
      else if(v==='team-view') renderTeam();
      else if(v==='settings-view') renderSettings();
      else if(v==='register-view') renderRegister();
    });
  });

  document.querySelector('.btn-back').addEventListener('click', ()=>{ showView('home-view'); renderHome(); });
  document.getElementById('btn-add-game').addEventListener('click', openAddForm);
  document.getElementById('btn-form-cancel').addEventListener('click', ()=>{ showView('home-view'); renderHome(); });
  document.getElementById('btn-form-save').addEventListener('click', saveGame);
  document.getElementById('btn-settings-repo').addEventListener('click', saveRepoSettings);
  document.getElementById('btn-settings-token').addEventListener('click', saveToken);
  document.getElementById('btn-reg-cancel').addEventListener('click', ()=>{ showView('team-view'); renderTeam(); });
  document.getElementById('btn-reg-save').addEventListener('click', doRegister);

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});

  renderHome();
});
