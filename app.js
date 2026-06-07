let state = {
  games: [],
  editingId: null,
  settings: { owner: '', repo: '', token: '' }
};

const LABEL_GAME = 'juego';
const GH_BASE = 'https://api.github.com';

/* ========== STORAGE ========== */
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('piratas_settings'));
    if (s) state.settings = s;
  } catch {}
}
function saveSettings() {
  localStorage.setItem('piratas_settings', JSON.stringify(state.settings));
}

/* ========== AUTO-DETECT REPO FROM URL ========== */
function detectRepoFromURL() {
  const parts = window.location.pathname.replace(/\/+$/, '').split('/');
  const host = window.location.hostname;
  if (host.endsWith('.github.io')) {
    const owner = host.replace('.github.io', '');
    const repo = parts.length >= 2 ? parts[1] : '';
    if (repo) return { owner, repo };
  }
  return null;
}

/* ========== GITHUB API ========== */
async function ghFetch(url, opts = {}) {
  const useToken = opts._withToken !== false && state.settings.token;
  const headers = { 'Accept': 'application/vnd.github.v3+json' };
  if (useToken) headers['Authorization'] = `Bearer ${state.settings.token}`;
  if (opts.body && typeof opts.body === 'string') headers['Content-Type'] = 'application/json';
  Object.assign(headers, opts.headers);
  delete opts._withToken;
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try { const d = await res.json(); msg = d.message || msg; } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

function issueTitle(game) {
  return `[${game.date} ${game.time}] Piratas vs ${game.rival} - ${game.tournament}`;
}
function issueBody(game) {
  return JSON.stringify(game, null, 2);
}
function issueLabels(game) {
  const labels = [LABEL_GAME, game.homeAway === 'Local' ? 'local' : 'visitante'];
  labels.push(game.status === 'Jugado' ? 'jugado' : 'por-jugar');
  if (game.status === 'Jugado' && game.homeScore != null && game.awayScore != null) {
    const ps = game.homeAway === 'Local' ? game.homeScore : game.awayScore;
    const rs = game.homeAway === 'Local' ? game.awayScore : game.homeScore;
    labels.push(ps > rs ? 'victoria' : 'derrota');
  }
  return labels;
}

function parseGameFromIssue(issue) {
  try {
    const g = JSON.parse(issue.body);
    g._issueNumber = issue.number;
    g._issueUrl = issue.html_url;
    return g;
  } catch { return null; }
}

async function fetchGames() {
  const { owner, repo } = state.settings;
  if (!owner || !repo) return [];
  const url = `${GH_BASE}/repos/${owner}/${repo}/issues?labels=${LABEL_GAME}&state=all&per_page=100&sort=created&direction=desc`;
  const data = await ghFetch(url, { _withToken: false });
  const games = (data || []).map(parseGameFromIssue).filter(Boolean);
  games.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  state.games = games;
  return games;
}

async function createGame(game) {
  const { owner, repo, token } = state.settings;
  if (!token) throw new Error('Se necesita un Token de GitHub en Ajustes para añadir partidos');
  const body = { title: issueTitle(game), body: issueBody(game), labels: issueLabels(game) };
  const issue = await ghFetch(`${GH_BASE}/repos/${owner}/${repo}/issues`, { method: 'POST', body: JSON.stringify(body) });
  const g = parseGameFromIssue(issue);
  state.games.push(g);
  state.games.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return g;
}

async function updateGame(issueNumber, game) {
  const { owner, repo, token } = state.settings;
  if (!token) throw new Error('Se necesita un Token de GitHub en Ajustes para editar partidos');
  const body = { title: issueTitle(game), body: issueBody(game), labels: issueLabels(game) };
  await ghFetch(`${GH_BASE}/repos/${owner}/${repo}/issues/${issueNumber}`, { method: 'PATCH', body: JSON.stringify(body) });
  const idx = state.games.findIndex(g => g._issueNumber === issueNumber);
  if (idx !== -1) { game._issueNumber = issueNumber; state.games[idx] = game; }
  return game;
}

async function deleteGame(issueNumber) {
  const { owner, repo, token } = state.settings;
  if (!token) throw new Error('Se necesita un Token de GitHub en Ajustes para eliminar partidos');
  await ghFetch(`${GH_BASE}/repos/${owner}/${repo}/issues/${issueNumber}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) });
  state.games = state.games.filter(g => g._issueNumber !== issueNumber);
}

/* ========== HELPERS ========== */
function formatDate(d) {
  const date = new Date(d + 'T12:00:00');
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '');
}
function getDayName(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long' });
}
function todayStr() { return new Date().toISOString().split('T')[0]; }
function hasToken() { return !!state.settings.token; }

/* ========== VIEWS ========== */
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
    document.getElementById('home-content').innerHTML = `
      <div class="card">
        <div class="settings-info">
          <strong>🏴‍☠️ Bienvenido</strong><br>
          Para ver el calendario, configura el repositorio de GitHub en Ajustes.
        </div>
        <button class="btn btn-gold" onclick="showView('settings-view')">Ir a Ajustes</button>
      </div>`;
    document.getElementById('btn-add-game').style.display = 'none';
    return;
  }

  try {
    const games = await fetchGames();
    const n = new Date();
    const ns = n.toISOString().split('T')[0];
    const nt = n.toTimeString().slice(0, 5);

    const upcoming = games.filter(g => g.status !== 'Jugado' && (g.date + (g.time || '23:59')) >= ns + nt);
    const past = games.filter(g => g.status === 'Jugado' || (g.date + (g.time || '23:59')) < ns + nt);

    let html = '';

    if (upcoming[0]) {
      html += renderGameCard(upcoming[0], 'Próximo Partido', '🏟️');
    } else {
      html += `<div class="card"><div class="empty"><div class="empty-icon">📅</div><p>No hay próximos partidos</p></div></div>`;
    }

    if (past.length) {
      html += renderGameCard(past[past.length - 1], 'Último Partido', '🏁');
    } else {
      html += `<div class="card"><div class="empty"><div class="empty-icon">⚾</div><p>Aún no hay partidos jugados</p></div></div>`;
    }

    document.getElementById('home-content').innerHTML = html;
    document.getElementById('btn-add-game').style.display = hasToken() ? 'block' : 'none';
  } catch (e) {
    document.getElementById('home-content').innerHTML = `
      <div class="card">
        <div class="msg error show">Error: ${e.message}</div>
        <button class="btn btn-gold" onclick="renderHome()">Reintentar</button>
      </div>`;
  }
}

function renderGameCard(game, title, emoji) {
  const played = game.status === 'Jugado';
  const ps = game.homeAway === 'Local' ? game.homeScore : game.awayScore;
  const rs = game.homeAway === 'Local' ? game.awayScore : game.homeScore;
  const win = played && ps > rs;
  const loss = played && ps < rs;
  const isAdmin = hasToken();

  let scoreHtml = '';
  if (played && game.homeScore != null && game.awayScore != null) {
    scoreHtml = `<div class="score-box ${win ? 'win' : loss ? 'loss' : 'pending'}">
      <div class="score-display"><span>${ps}</span><span class="dash">-</span><span>${rs}</span></div>
      <div class="score-label ${win ? 'win-label' : loss ? 'loss-label' : 'pending-label'}">${win ? 'VICTORIA' : loss ? 'DERROTA' : 'EMPATE'}</div>
    </div>`;
  } else if (!played) {
    scoreHtml = `<div class="score-box pending"><div class="score-label pending-label">⏳ PENDIENTE</div></div>`;
  }

  const haBadge = game.homeAway === 'Local' ? '<span class="badge local">Local</span>' : '<span class="badge visit">Visitante</span>';
  const stBadge = played ? '<span class="badge done">Jugado</span>' : '<span class="badge pend">Por Jugar</span>';

  const actions = isAdmin ? `
    <div class="btn-group" style="margin-top:12px">
      <button class="btn btn-blue btn-sm" onclick="editGame(${game._issueNumber})">✏️ Editar</button>
      <button class="btn btn-red btn-sm" onclick="confirmDelete(${game._issueNumber})">🗑️ Eliminar</button>
    </div>` : '';

  return `<div class="card game-card ${played ? 'played' : ''}">
    <div class="card-title"><span class="emoji">${emoji}</span> ${title}</div>
    <div class="game-header">
      <span class="game-vs"><span class="piratas">Piratas</span> vs <span class="rival">${game.rival || '—'}</span></span>
      <span class="game-tournament">${game.tournament || '—'}</span>
    </div>
    ${scoreHtml}
    <div class="game-details">
      <span>${formatDate(game.date)}</span>
      <span>${game.time || '—'}</span>
      <span>${getDayName(game.date)}</span>
      <span>${game.stadium || '—'}</span>
      <span>${haBadge}</span>
      <span>${stBadge}</span>
    </div>
    ${actions}
  </div>`;
}

/* ========== RENDER CALENDAR ========== */
async function renderCalendar() {
  const { owner, repo } = state.settings;
  if (!owner || !repo) {
    document.getElementById('calendar-content').innerHTML = `<div class="card"><div class="settings-info">Configura el repositorio en Ajustes primero.</div></div>`;
    return;
  }

  try {
    const games = state.games.length ? state.games : await fetchGames();
    if (!games.length) {
      document.getElementById('calendar-content').innerHTML = `<div class="card"><div class="empty"><div class="empty-icon">📋</div><p>No hay partidos</p></div></div>`;
      return;
    }
    const isAdmin = hasToken();

    let html = `<div class="table-wrap"><table><thead><tr>
      <th>Fecha</th><th>Hora</th><th>Día</th><th>Torneo</th><th>Rival</th><th>Estadio</th><th>L/V</th><th>Estado</th><th>Score</th>${isAdmin ? '<th>Acc.</th>' : ''}
    </tr></thead><tbody>`;

    games.forEach(g => {
      const played = g.status === 'Jugado';
      const ps = g.homeAway === 'Local' ? g.homeScore : g.awayScore;
      const rs = g.homeAway === 'Local' ? g.awayScore : g.homeScore;
      const sc = played && g.homeScore != null && g.awayScore != null ? `${ps} - ${rs}` : '—';
      const hv = g.homeAway === 'Local' ? '<span class="badge local">L</span>' : '<span class="badge visit">V</span>';
      const st = played ? '<span class="badge done">Jug</span>' : '<span class="badge pend">Pend</span>';

      html += `<tr>
        <td>${formatDate(g.date)}</td>
        <td>${g.time || '—'}</td>
        <td>${getDayName(g.date)}</td>
        <td>${g.tournament || '—'}</td>
        <td><strong>${g.rival || '—'}</strong></td>
        <td>${g.stadium || '—'}</td>
        <td>${hv}</td>
        <td>${st}</td>
        <td><strong>${sc}</strong></td>
        ${isAdmin ? `<td>
          <button class="btn btn-blue btn-sm" onclick="editGame(${g._issueNumber})">✏️</button>
          <button class="btn btn-red btn-sm" onclick="confirmDelete(${g._issueNumber})">🗑️</button>
        </td>` : ''}
      </tr>`;
    });

    html += `</tbody></table></div>`;
    document.getElementById('calendar-content').innerHTML = html;
  } catch (e) {
    document.getElementById('calendar-content').innerHTML = `<div class="card"><div class="msg error show">Error: ${e.message}</div></div>`;
  }
}

/* ========== FORM ========== */
function getDefaultGame() {
  return { date: todayStr(), time: '20:00', day: '', tournament: '', rival: '', stadium: '', homeAway: 'Local', status: 'Por Jugar', homeScore: '', awayScore: '' };
}
function openAddForm() {
  state.editingId = null;
  document.getElementById('form-title').textContent = 'Nuevo Partido';
  fillForm(getDefaultGame());
  showView('form-view');
}
function editGame(issueNumber) {
  showView('form-view');
  document.getElementById('form-title').textContent = 'Editar Partido';
  state.editingId = issueNumber;
  const g = state.games.find(x => x._issueNumber === issueNumber);
  if (g) fillForm(g);
}
function fillForm(g) {
  setVal('game-date', g.date || '');
  setVal('game-time', g.time || '');
  setVal('game-tournament', g.tournament || '');
  setVal('game-rival', g.rival || '');
  setVal('game-stadium', g.stadium || '');
  setVal('game-homeaway', g.homeAway || 'Local');
  setVal('game-status', g.status || 'Por Jugar');
  setVal('game-homescore', g.homeScore != null ? g.homeScore : '');
  setVal('game-awayscore', g.awayScore != null ? g.awayScore : '');
  toggleScoreFields(g.status === 'Jugado');
}
function setVal(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
function getVal(id) { const el = document.getElementById(id); return el ? el.value : ''; }
function toggleScoreFields(show) { document.getElementById('score-fields').style.display = show ? 'block' : 'none'; }

document.addEventListener('change', e => {
  if (e.target.id === 'game-status') toggleScoreFields(e.target.value === 'Jugado');
});

async function saveGame() {
  const msg = document.getElementById('form-msg');
  msg.classList.remove('show');
  const game = {
    date: getVal('game-date'), time: getVal('game-time'), day: '',
    tournament: getVal('game-tournament'), rival: getVal('game-rival'),
    stadium: getVal('game-stadium'), homeAway: getVal('game-homeaway'),
    status: getVal('game-status'), homeScore: getVal('game-homescore'), awayScore: getVal('game-awayscore')
  };
  if (!game.date || !game.rival) { msg.textContent = 'Fecha y Rival son obligatorios'; msg.className = 'msg error show'; return; }
  if (game.status === 'Jugado') {
    if (game.homeScore === '' || game.awayScore === '') { msg.textContent = 'Ingresa el score'; msg.className = 'msg error show'; return; }
    if (!/^\d+$/.test(game.homeScore) || !/^\d+$/.test(game.awayScore)) { msg.textContent = 'Score debe ser numérico'; msg.className = 'msg error show'; return; }
  }
  game.homeScore = game.homeScore !== '' ? Number(game.homeScore) : null;
  game.awayScore = game.awayScore !== '' ? Number(game.awayScore) : null;
  try {
    msg.textContent = 'Guardando...'; msg.className = 'msg success show';
    if (state.editingId) { await updateGame(state.editingId, game); msg.textContent = 'Partido actualizado'; }
    else { await createGame(game); msg.textContent = 'Partido creado'; }
    state.editingId = null;
    setTimeout(() => { showView('home-view'); renderHome(); }, 800);
  } catch (e) { msg.textContent = `Error: ${e.message}`; msg.className = 'msg error show'; }
}

async function confirmDelete(issueNumber) {
  if (!confirm('Eliminar este partido?')) return;
  try {
    await deleteGame(issueNumber);
    const v = document.querySelector('.view.active');
    if (v) { if (v.id === 'home-view') renderHome(); else if (v.id === 'calendar-view') renderCalendar(); }
  } catch (e) { alert('Error: ' + e.message); }
}

/* ========== SETTINGS ========== */
function renderSettings() {
  const s = state.settings;
  document.getElementById('set-owner').value = s.owner || '';
  document.getElementById('set-repo').value = s.repo || '';
  document.getElementById('set-token').value = s.token || '';
  document.getElementById('settings-msg').classList.remove('show');
  const statusEl = document.getElementById('admin-status');
  if (statusEl) {
    statusEl.textContent = hasToken() ? '✅ Modo Administrador activo' : 'ℹ️ Solo lectura. Añade un token para administrar.';
    statusEl.className = hasToken() ? 'msg success show' : 'msg show';
    statusEl.style.display = 'block';
  }
}

function saveRepoSettings() {
  const owner = document.getElementById('set-owner').value.trim();
  const repo = document.getElementById('set-repo').value.trim();
  state.settings.owner = owner;
  state.settings.repo = repo;
  saveSettings();
  const msg = document.getElementById('settings-msg');
  msg.textContent = 'Repositorio guardado. Cargando datos...';
  msg.className = 'msg success show';
  renderHome();
}

function saveToken() {
  const token = document.getElementById('set-token').value.trim();
  const msg = document.getElementById('settings-msg');

  if (!state.settings.owner || !state.settings.repo) {
    msg.textContent = 'Primero guarda el Owner y Repo en la sección de Repositorio.';
    msg.className = 'msg error show';
    return;
  }

  state.settings.token = token;
  saveSettings();

  if (token) {
    msg.textContent = 'Validando token...'; msg.className = 'msg success show';
    ghFetch(`${GH_BASE}/repos/${state.settings.owner}/${state.settings.repo}`, { _withToken: true })
      .then(() => {
        msg.textContent = 'Token válido. Modo administrador activo.';
        msg.className = 'msg success show';
        renderSettings();
        renderHome();
      })
      .catch(e => {
        msg.textContent = `Token inválido: ${e.message}`;
        msg.className = 'msg error show';
        state.settings.token = '';
        saveSettings();
        renderSettings();
      });
  } else {
    msg.textContent = 'Token eliminado. Modo solo lectura.';
    msg.className = 'msg show';
    renderSettings();
    renderHome();
  }
}

/* ========== INIT ========== */
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();

  // Auto-detect if not set
  if (!state.settings.owner || !state.settings.repo) {
    const detected = detectRepoFromURL();
    if (detected) {
      state.settings.owner = detected.owner;
      state.settings.repo = detected.repo;
      saveSettings();
    }
  }

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const viewId = btn.dataset.view;
      showView(viewId);
      if (viewId === 'home-view') renderHome();
      else if (viewId === 'calendar-view') renderCalendar();
      else if (viewId === 'settings-view') renderSettings();
    });
  });

  document.querySelector('.btn-back').addEventListener('click', () => { showView('home-view'); renderHome(); });
  document.getElementById('btn-add-game').addEventListener('click', openAddForm);
  document.getElementById('btn-form-cancel').addEventListener('click', () => { showView('home-view'); renderHome(); });
  document.getElementById('btn-form-save').addEventListener('click', saveGame);
  document.getElementById('btn-settings-repo').addEventListener('click', saveRepoSettings);
  document.getElementById('btn-settings-token').addEventListener('click', saveToken);

  // Register Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  renderHome();
});
