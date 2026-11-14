'use strict';

/* ---------- utilidades ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };
const f0 = n => Math.round(n).toLocaleString('pt-BR');
const f1 = n => (Math.round(n * 10) / 10).toLocaleString('pt-BR');
const uid = () => crypto.randomUUID();
const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const MEALS = [['breakfast', 'Café da manhã'], ['lunch', 'Almoço'], ['dinner', 'Jantar'], ['snack', 'Lanches']];
const NUTS = ['kcal', 'protein', 'carbs', 'fat', 'fiber'];
const NUT_LABEL = { kcal: 'Calorias (kcal)', protein: 'Proteína (g)', carbs: 'Carboidrato (g)', fat: 'Gordura (g)', fiber: 'Fibra (g)' };
const DEFAULT_GOALS = { kcal: 2000, protein: 150, carbs: 200, fat: 65, fiber: 30 };

/* ---------- armazenamento local ---------- */
const LS = 'calorias.v1';
let db = loadDb();
function loadDb() {
  const base = { foods: {}, entries: {}, settings: { goals: { ...DEFAULT_GOALS }, updated_at: 0 }, dirty: {}, lastSeq: 0 };
  try { return { ...base, ...JSON.parse(localStorage.getItem(LS) || '{}') }; } catch { return base; }
}
function saveDb() { localStorage.setItem(LS, JSON.stringify(db)); }
function put(kind, rec) {
  rec.updated_at = Date.now();
  if (kind === 'settings') { db.settings = rec; db.dirty['settings:settings'] = 1; }
  else { db[kind][rec.id] = rec; db.dirty[`${kind}:${rec.id}`] = 1; }
  saveDb();
  scheduleSync();
}
const liveFoods = () => Object.values(db.foods).filter(f => !f.deleted);
const liveEntries = date => Object.values(db.entries).filter(e => !e.deleted && e.date === date);

/* ---------- estado da interface ---------- */
let tab = 'diary';
let day = isoDate(new Date());
let sheetCleanup = null;

function toast(msg, ms = 2500) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.add('hidden'), ms);
}
function openSheet(title, html) {
  if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; }
  $('#sheet-title').textContent = title;
  $('#sheet-content').innerHTML = html;
  $('#sheet').classList.remove('hidden');
  $('.sheet-body').scrollTop = 0;
}
function closeSheet() {
  if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; }
  $('#sheet').classList.add('hidden');
  $('#sheet-content').innerHTML = '';
  onFoodPicked = null;
}

/* ---------- render principal ---------- */
function render() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const v = $('#view');
  if (tab === 'diary') v.innerHTML = diaryHtml();
  else if (tab === 'foods') { v.innerHTML = foodsHtml(); renderFoodList(); }
  else v.innerHTML = settingsHtml();
}

function dayLabel() {
  const today = isoDate(new Date());
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (day === today) return 'Hoje';
  if (day === isoDate(y)) return 'Ontem';
  return new Date(day + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' });
}
function bar(val, goal) {
  const pct = goal > 0 ? Math.min(100, (val / goal) * 100) : 0;
  return `<div class="bar ${goal > 0 && val > goal ? 'over' : ''}"><i style="width:${pct}%"></i></div>`;
}

function diaryHtml() {
  const entries = liveEntries(day);
  const tot = Object.fromEntries(NUTS.map(n => [n, entries.reduce((s, e) => s + (e[n] || 0), 0)]));
  const g = db.settings.goals;
  const left = g.kcal - tot.kcal;
  const macro = (key, name) => `<div><div class="name">${name}</div><div class="val num">${f0(tot[key])} / ${f0(g[key])} g</div>${bar(tot[key], g[key])}</div>`;

  let html = `
  <div class="datebar">
    <button data-act="day" data-d="-1" aria-label="Dia anterior">‹</button>
    <button class="label" data-act="today">${esc(dayLabel())}</button>
    <button data-act="day" data-d="1" aria-label="Próximo dia">›</button>
  </div>
  <div class="card">
    <div class="row between">
      <div><div class="kcal-big num">${f0(tot.kcal)}</div><div class="muted">de ${f0(g.kcal)} kcal</div></div>
      <div style="text-align:right"><div class="num" style="font-weight:600">${f0(Math.abs(left))} kcal</div><div class="muted">${left >= 0 ? 'restantes' : 'acima da meta'}</div></div>
    </div>
    ${bar(tot.kcal, g.kcal)}
    <div class="macros">${macro('protein', 'Proteína')}${macro('carbs', 'Carbo')}${macro('fat', 'Gordura')}${macro('fiber', 'Fibra')}</div>
  </div>`;

  for (const [key, name] of MEALS) {
    const list = entries.filter(e => e.meal === key).sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
    const sub = list.reduce((s, e) => s + e.kcal, 0);
    html += `<div class="card">
      <div class="row between meal-head">
        <div><h3>${name}</h3><div class="muted num">${f0(sub)} kcal</div></div>
        <button class="btn small" data-act="add" data-meal="${key}">+ Adicionar</button>
      </div>
      ${list.map(e => `<button class="item" data-act="entry" data-id="${e.id}">
          <div class="grow"><div class="title">${esc(e.name)}</div><div class="muted num">${f0(e.grams)} g · P ${f0(e.protein)} · C ${f0(e.carbs)} · G ${f0(e.fat)}</div></div>
          <div class="num">${f0(e.kcal)} kcal</div>
        </button>`).join('') || '<div class="empty">Nada registrado</div>'}
    </div>`;
  }
  return html;
}

/* ---------- alimentos ---------- */
function foodsHtml() {
  return `<h1>Meus alimentos</h1>
  <input id="food-q" type="search" placeholder="Buscar nos meus alimentos" autocomplete="off">
  <div class="btns" style="margin:10px 0">
    <button class="btn small" data-act="scan">Escanear código</button>
    <button class="btn small" data-act="online">Buscar online</button>
    <button class="btn small" data-act="newfood">Novo</button>
  </div>
  <div class="card" id="food-list" style="padding-top:4px"></div>`;
}
function foodRows(q, act) {
  const nq = norm(q);
  const list = liveFoods()
    .filter(f => !nq || norm(f.name + ' ' + (f.brand || '')).includes(nq))
    .sort((a, b) => (b.uses || 0) - (a.uses || 0) || a.name.localeCompare(b.name, 'pt'));
  if (!list.length) return `<div class="empty">${liveFoods().length ? 'Nenhum alimento encontrado.' : 'Nenhum alimento salvo ainda. Escaneie um código de barras, busque online ou cadastre um novo.'}</div>`;
  return list.map(f => `<button class="item" data-act="${act}" data-id="${f.id}">
      <div class="grow"><div class="title">${esc(f.name)}</div><div class="muted">${esc(f.brand || '')}${f.brand ? ' · ' : ''}por 100 g</div></div>
      <div class="num">${f0(f.kcal)} kcal</div>
    </button>`).join('');
}
function renderFoodList() {
  const el = $('#food-list');
  if (el) el.innerHTML = foodRows($('#food-q')?.value, 'editfood');
}

let onFoodPicked = null; // o que fazer quando um alimento é escolhido/salvo no fluxo atual

function foodForm(food, isNew) {
  const f = food || {};
  const field = (k, label, attrs = '') => `<div><label for="ff-${k}">${label}</label><input id="ff-${k}" value="${esc(f[k] ?? '')}" ${attrs}></div>`;
  openSheet(isNew ? 'Novo alimento' : 'Editar alimento', `
    ${field('name', 'Nome', 'autocomplete="off"')}
    <div class="grid2">${field('brand', 'Marca / loja (opcional)')}${field('barcode', 'Código de barras (opcional)', 'inputmode="numeric"')}</div>
    <p class="muted" style="margin:14px 0 0">Valores por 100 g (ou 100 ml)</p>
    <div class="grid2">${field('kcal', 'Calorias (kcal)', 'inputmode="decimal"')}${field('protein', 'Proteína (g)', 'inputmode="decimal"')}</div>
    <div class="grid3">${field('carbs', 'Carbo (g)', 'inputmode="decimal"')}${field('fat', 'Gordura (g)', 'inputmode="decimal"')}${field('fiber', 'Fibra (g)', 'inputmode="decimal"')}</div>
    ${field('serving_g', 'Tamanho de 1 porção em gramas (opcional)', 'inputmode="decimal"')}
    <div class="btns" style="margin-top:16px">
      ${!isNew ? `<button class="btn danger" data-act="delfood" data-id="${f.id}">Excluir</button>` : ''}
      <button class="btn primary" data-act="savefood" data-id="${isNew ? '' : f.id}">Salvar</button>
    </div>`);
}
function saveFood(id) {
  const name = $('#ff-name').value.trim();
  if (!name) return toast('Informe o nome do alimento.');
  const food = id ? { ...db.foods[id] } : { id: uid(), uses: 0 };
  food.name = name;
  food.brand = $('#ff-brand').value.trim();
  food.barcode = $('#ff-barcode').value.trim();
  for (const n of NUTS) food[n] = num($(`#ff-${n}`).value);
  food.serving_g = num($('#ff-serving_g').value) || null;
  put('foods', food);
  const cb = onFoodPicked;
  if (cb) cb(food); else { closeSheet(); render(); toast('Alimento salvo.'); }
}

/* ---------- registro no diário ---------- */
function pickSheet(meal) {
  onFoodPicked = food => qtySheet(food, meal);
  openSheet('Adicionar a ' + MEALS.find(m => m[0] === meal)[1], `
    <input id="pick-q" type="search" placeholder="Buscar nos meus alimentos" autocomplete="off">
    <div class="btns" style="margin:10px 0">
      <button class="btn small" data-act="scan">Escanear código</button>
      <button class="btn small" data-act="online">Buscar online</button>
      <button class="btn small" data-act="newfood">Novo</button>
    </div>
    <div id="pick-list">${foodRows('', 'pick')}</div>`);
}

function qtySheet(food, meal, entry) {
  const grams = entry ? entry.grams : (food.serving_g || 100);
  qtySheet.ctx = { food, entry };
  openSheet(food.name, `
    <div class="muted">${esc(food.brand || '')}${food.brand ? ' · ' : ''}${f0(food.kcal)} kcal por 100 g</div>
    <div class="grid2">
      <div><label for="q-grams">Quantidade (g)</label><input id="q-grams" inputmode="decimal" value="${grams}"></div>
      <div><label for="q-meal">Refeição</label><select id="q-meal">${MEALS.map(([k, n]) => `<option value="${k}" ${k === meal ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    </div>
    <div class="btns" style="margin-top:10px">
      ${food.serving_g ? [0.5, 1, 2].map(m => `<button class="btn small" data-act="setg" data-g="${food.serving_g * m}">${m === 0.5 ? '½' : m} porç${m > 1 ? 'ões' : 'ão'}</button>`).join('') : [50, 100, 150, 200].map(g => `<button class="btn small" data-act="setg" data-g="${g}">${g} g</button>`).join('')}
    </div>
    <div class="preview num" id="q-preview"></div>
    <div class="btns" style="margin-top:16px">
      ${entry ? `<button class="btn danger" data-act="delentry">Excluir</button>` : ''}
      <button class="btn primary" data-act="saveentry">${entry ? 'Salvar' : 'Adicionar'}</button>
    </div>`);
  updateQtyPreview();
}
function scaled(food, grams) {
  return Object.fromEntries(NUTS.map(n => [n, Math.round((food[n] || 0) * grams) / 100]));
}
function updateQtyPreview() {
  const el = $('#q-preview');
  if (!el) return;
  const s = scaled(qtySheet.ctx.food, num($('#q-grams').value));
  el.innerHTML = `<b>${f0(s.kcal)} kcal</b> · Proteína ${f1(s.protein)} g · Carbo ${f1(s.carbs)} g · Gordura ${f1(s.fat)} g · Fibra ${f1(s.fiber)} g`;
}
function saveEntry() {
  const { food, entry } = qtySheet.ctx;
  const grams = num($('#q-grams').value);
  if (grams <= 0) return toast('Informe a quantidade em gramas.');
  const rec = entry ? { ...entry } : { id: uid(), date: day, created_at: Date.now(), food_id: food.id, name: food.name };
  Object.assign(rec, scaled(food, grams), { grams, meal: $('#q-meal').value });
  put('entries', rec);
  if (!entry && db.foods[food.id]) put('foods', { ...db.foods[food.id], uses: (db.foods[food.id].uses || 0) + 1 });
  closeSheet();
  render();
}
function editEntry(id) {
  const e = db.entries[id];
  let food = db.foods[e.food_id];
  if (!food || food.deleted) { // alimento apagado: reconstrói os valores por 100 g a partir do registro
    food = { id: e.food_id, name: e.name };
    for (const n of NUTS) food[n] = e.grams ? (e[n] / e.grams) * 100 : 0;
  }
  qtySheet(food, e.meal, e);
}

/* ---------- Open Food Facts ---------- */
const OFF_FIELDS = 'code,product_name,brands,nutriments,serving_quantity';
function offToFood(p) {
  const n = p.nutriments || {};
  const kcal = n['energy-kcal_100g'] ?? (n.energy_100g != null ? n.energy_100g / 4.184 : 0);
  return {
    name: p.product_name || '', brand: (p.brands || '').split(',')[0].trim(), barcode: p.code || '',
    kcal: Math.round(num(kcal)), protein: num(n.proteins_100g), carbs: num(n.carbohydrates_100g),
    fat: num(n.fat_100g), fiber: num(n.fiber_100g), serving_g: num(p.serving_quantity) || '',
  };
}
async function handleCode(code) {
  code = String(code).replace(/\D/g, '');
  if (!code) return toast('Código inválido.');
  const local = liveFoods().find(f => f.barcode === code);
  if (local) { if (onFoodPicked) onFoodPicked(local); else foodForm(local, false); return; }
  openSheet('Buscando produto…', `<p class="muted">Consultando o Open Food Facts (código ${esc(code)})…</p>`);
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${OFF_FIELDS}`);
    const j = await r.json();
    if (j.status === 1 && j.product) { foodForm(offToFood({ ...j.product, code }), true); toast('Produto encontrado. Confira os valores e salve.'); return; }
    toast('Produto não encontrado. Cadastre os valores do rótulo.', 4000);
  } catch { toast('Sem conexão. Cadastre os valores do rótulo.', 4000); }
  foodForm({ barcode: code }, true);
}
function onlineSheet() {
  openSheet('Buscar online', `
    <div class="row"><input id="off-q" type="search" placeholder="Ex.: tesco greek yogurt" autocomplete="off"><button class="btn primary" data-act="offsearch">Buscar</button></div>
    <p class="muted">Base aberta Open Food Facts. Confira sempre os valores com o rótulo.</p>
    <div id="off-list"></div>`);
  $('#off-q').focus();
}
let offResults = [];
async function offSearch() {
  const q = $('#off-q').value.trim();
  if (!q) return;
  const list = $('#off-list');
  list.innerHTML = '<div class="empty">Buscando…</div>';
  // Tenta primeiro os produtos vendidos na Irlanda; se não achar nada, busca na base mundial.
  const search = async host => {
    const r = await fetch(`https://${host}.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=30&fields=${OFF_FIELDS}`);
    return ((await r.json()).products || []).map(offToFood).filter(f => f.name && f.kcal > 0);
  };
  try {
    let found = [], failed = 0;
    for (const host of ['ie', 'world']) {
      try { found = await search(host); } catch { failed++; }
      if (found.length) break;
    }
    if (failed === 2) throw new Error('offline');
    offResults = found;
    if (!$('#off-list')) return;
    list.innerHTML = offResults.map((f, i) => `<button class="item" data-act="offpick" data-i="${i}">
        <div class="grow"><div class="title">${esc(f.name)}</div><div class="muted">${esc(f.brand || 'sem marca')} · por 100 g</div></div>
        <div class="num">${f0(f.kcal)} kcal</div></button>`).join('') || '<div class="empty">Nada encontrado.</div>';
  } catch { list.innerHTML = '<div class="empty">Não foi possível buscar agora. Tente de novo em instantes.</div>'; }
}

/* ---------- leitor de código de barras ---------- */
function loadScript(src) {
  return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = fail; document.head.appendChild(s); });
}
async function scanSheet() {
  openSheet('Escanear código de barras', `
    <video id="cam" playsinline muted></video>
    <p class="muted" id="cam-msg">Aponte a câmera para o código de barras.</p>
    <div class="row"><input id="code-manual" inputmode="numeric" placeholder="Ou digite o código"><button class="btn" data-act="codemanual">Buscar</button></div>`);
  let stream = null, stop = false, zx = null;
  sheetCleanup = () => { stop = true; try { zx?.stop(); } catch {} stream?.getTracks().forEach(t => t.stop()); };
  const video = $('#cam');
  const found = code => { if (stop) return; stop = true; navigator.vibrate?.(60); handleCode(code); };
  try {
    if ('BarcodeDetector' in window) {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (stop) return stream.getTracks().forEach(t => t.stop());
      video.srcObject = stream;
      await video.play();
      const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
      const tick = async () => {
        if (stop) return;
        try { const codes = await det.detect(video); if (codes.length) return found(codes[0].rawValue); } catch {}
        setTimeout(tick, 200);
      };
      tick();
    } else {
      await loadScript('https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js');
      if (stop) return;
      const reader = new ZXingBrowser.BrowserMultiFormatReader();
      zx = await reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, video, res => { if (res) found(res.getText()); });
      if (stop) zx.stop();
    }
  } catch {
    const m = $('#cam-msg');
    if (m) m.textContent = 'Não foi possível abrir a câmera. Permita o acesso ou digite o código abaixo.';
  }
}

/* ---------- ajustes ---------- */
function settingsHtml() {
  const g = db.settings.goals;
  return `<h1>Ajustes</h1>
  <div class="card">
    <h3>Metas diárias</h3>
    <div class="grid2">${NUTS.map(n => `<div><label for="g-${n}">${NUT_LABEL[n]}</label><input id="g-${n}" inputmode="decimal" value="${g[n]}"></div>`).join('')}</div>
    <button class="btn primary block" style="margin-top:14px" data-act="savegoals">Salvar metas</button>
  </div>
  <div class="card"><h3>Sincronização</h3>${syncHtml()}</div>
  <div class="card">
    <h3>Backup</h3>
    <p class="muted">Exporta ou importa todos os seus dados em um arquivo.</p>
    <div class="btns"><button class="btn" data-act="export">Exportar</button><button class="btn" data-act="import">Importar</button></div>
    <input id="import-file" type="file" accept="application/json,.json" class="hidden">
  </div>`;
}
function syncHtml() {
  const c = getCfg();
  if (!c) return `<p class="muted">Para sincronizar entre aparelhos, informe os dados do seu projeto Supabase (veja o LEIAME).</p>
    <label for="cfg-url">URL do projeto</label><input id="cfg-url" placeholder="https://xxxx.supabase.co" autocomplete="off">
    <label for="cfg-key">Chave pública (anon / publishable)</label><input id="cfg-key" autocomplete="off">
    <button class="btn block" style="margin-top:14px" data-act="savecfg">Conectar</button>`;
  if (!session) return `<p class="muted">Entre para sincronizar seus dados entre aparelhos.</p>
    <label for="au-email">E-mail</label><input id="au-email" type="email" autocomplete="email">
    <label for="au-pass">Senha</label><input id="au-pass" type="password" autocomplete="current-password">
    <div class="btns" style="margin-top:14px"><button class="btn" data-act="signup">Criar conta</button><button class="btn primary" data-act="signin">Entrar</button></div>
    ${localStorage.getItem(CFG) ? '<button class="btn small block" style="margin-top:10px" data-act="clearcfg">Trocar projeto Supabase</button>' : ''}`;
  return `<p class="muted">Conectado como ${esc(session.user.email)}.<br><span id="sync-status">${esc(syncStatus)}</span></p>
    <div class="btns"><button class="btn" data-act="signout">Sair</button><button class="btn primary" data-act="syncnow">Sincronizar agora</button></div>`;
}
function saveGoals() {
  const goals = Object.fromEntries(NUTS.map(n => [n, num($(`#g-${n}`).value)]));
  put('settings', { ...db.settings, goals });
  toast('Metas salvas.');
}
function exportData() {
  const blob = new Blob([JSON.stringify({ foods: db.foods, entries: db.entries, settings: db.settings }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `calorias-backup-${isoDate(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    let n = 0;
    for (const kind of ['foods', 'entries']) for (const rec of Object.values(data[kind] || {})) {
      if (!rec?.id) continue;
      const cur = db[kind][rec.id];
      if (!cur || (rec.updated_at || 0) > (cur.updated_at || 0)) { db[kind][rec.id] = rec; db.dirty[`${kind}:${rec.id}`] = 1; n++; }
    }
    if (data.settings && (data.settings.updated_at || 0) > (db.settings.updated_at || 0)) { db.settings = data.settings; db.dirty['settings:settings'] = 1; }
    saveDb(); scheduleSync(); render();
    toast(`${n} registros importados.`);
  } catch { toast('Arquivo de backup inválido.'); }
}

/* ---------- sincronização (Supabase) ---------- */
const CFG = 'calorias.cfg';
let sb = null, session = null, syncing = false, syncTimer = null, syncStatus = 'Ainda não sincronizado.';
function getCfg() {
  const c = window.APP_CONFIG || {};
  if (c.supabaseUrl && c.supabaseKey) return c;
  try { const l = JSON.parse(localStorage.getItem(CFG)); if (l?.supabaseUrl && l?.supabaseKey) return l; } catch {}
  return null;
}
async function initSync() {
  const c = getCfg();
  if (!c) return;
  try {
    if (!window.supabase) await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js');
    sb = window.supabase.createClient(c.supabaseUrl, c.supabaseKey);
    session = (await sb.auth.getSession()).data.session;
    sb.auth.onAuthStateChange((_e, s) => { const was = session?.user?.id; session = s; if (s?.user?.id !== was) { if (tab === 'settings') render(); if (s) sync(); } });
    if (tab === 'settings') render();
    if (session) sync();
  } catch { syncStatus = 'Sem conexão com o servidor.'; }
}
function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(sync, 1500);
}
function setStatus(s) { syncStatus = s; const el = $('#sync-status'); if (el) el.textContent = s; }
async function sync() {
  if (!sb || !session || syncing) return;
  syncing = true;
  setStatus('Sincronizando…');
  try {
    const user_id = session.user.id;
    // envia alterações locais
    const keys = Object.keys(db.dirty);
    const rows = keys.map(k => {
      const [kind, id] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
      const rec = kind === 'settings' ? db.settings : db[kind]?.[id];
      return rec && { user_id, id, kind, data: rec, updated_at: rec.updated_at || 0, deleted: !!rec.deleted };
    }).filter(Boolean);
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { error } = await sb.from('records').upsert(chunk, { onConflict: 'user_id,id' });
      if (error) throw error;
      for (const r of chunk) {
        const cur = r.kind === 'settings' ? db.settings : db[r.kind][r.id];
        if ((cur.updated_at || 0) === r.updated_at) delete db.dirty[`${r.kind}:${r.id}`];
      }
      saveDb();
    }
    // recebe alterações do servidor
    let changed = false;
    for (;;) {
      const { data, error } = await sb.from('records').select('id,kind,data,updated_at,seq').gt('seq', db.lastSeq || 0).order('seq').limit(500);
      if (error) throw error;
      for (const r of data) {
        const cur = r.kind === 'settings' ? db.settings : db[r.kind]?.[r.id];
        if (!cur || r.updated_at > (cur.updated_at || 0)) {
          if (r.kind === 'settings') db.settings = r.data; else if (db[r.kind]) db[r.kind][r.id] = r.data;
          delete db.dirty[`${r.kind}:${r.id}`];
          changed = true;
        }
        db.lastSeq = r.seq;
      }
      saveDb();
      if (data.length < 500) break;
    }
    setStatus('Sincronizado às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + '.');
    if (changed && $('#sheet').classList.contains('hidden')) render();
  } catch (e) {
    setStatus('Falha ao sincronizar: ' + (e?.message || 'sem conexão') + '.');
  } finally { syncing = false; }
}
async function auth(mode) {
  const email = $('#au-email').value.trim(), password = $('#au-pass').value;
  if (!email || password.length < 6) return toast('Informe e-mail e senha (mínimo de 6 caracteres).');
  if (!sb) return toast('Sem conexão com o servidor.');
  const { data, error } = mode === 'signup' ? await sb.auth.signUp({ email, password }) : await sb.auth.signInWithPassword({ email, password });
  if (error) return toast('Erro: ' + error.message, 4000);
  if (mode === 'signup' && !data.session) toast('Conta criada. Confirme pelo link enviado ao seu e-mail e depois entre.', 6000);
}

/* ---------- eventos ---------- */
const acts = {
  day: d => { const x = new Date(day + 'T12:00'); x.setDate(x.getDate() + Number(d.d)); day = isoDate(x); render(); },
  today: () => { day = isoDate(new Date()); render(); },
  add: d => pickSheet(d.meal),
  pick: d => qtySheet(db.foods[d.id], qtyMealFromPick()),
  entry: d => editEntry(d.id),
  setg: d => { $('#q-grams').value = d.g; updateQtyPreview(); },
  saveentry: saveEntry,
  delentry: () => { put('entries', { ...qtySheet.ctx.entry, deleted: true }); closeSheet(); render(); },
  newfood: () => foodForm({ name: ($('#pick-q') || $('#food-q'))?.value || '' }, true),
  editfood: d => { onFoodPicked = null; foodForm(db.foods[d.id], false); },
  savefood: d => saveFood(d.id),
  delfood: d => { if (confirm('Excluir este alimento? Os registros já feitos no diário são mantidos.')) { put('foods', { ...db.foods[d.id], deleted: true }); closeSheet(); render(); } },
  scan: () => { if (tab === 'foods' && $('#sheet').classList.contains('hidden')) onFoodPicked = null; scanSheet(); },
  codemanual: () => handleCode($('#code-manual').value),
  online: () => { if (tab === 'foods' && $('#sheet').classList.contains('hidden')) onFoodPicked = null; onlineSheet(); },
  offsearch: offSearch,
  offpick: d => foodForm(offResults[d.i], true),
  savegoals: saveGoals,
  export: exportData,
  import: () => $('#import-file').click(),
  savecfg: () => {
    const supabaseUrl = $('#cfg-url').value.trim().replace(/\/+$/, ''), supabaseKey = $('#cfg-key').value.trim();
    if (!/^https:\/\/.+/.test(supabaseUrl) || !supabaseKey) return toast('Informe a URL e a chave do projeto.');
    localStorage.setItem(CFG, JSON.stringify({ supabaseUrl, supabaseKey }));
    render(); initSync();
  },
  clearcfg: () => { localStorage.removeItem(CFG); sb = null; session = null; render(); },
  signin: () => auth('signin'),
  signup: () => auth('signup'),
  signout: async () => { await sb.auth.signOut(); session = null; render(); },
  syncnow: sync,
};
let pickMeal = 'snack';
function qtyMealFromPick() { return pickMeal; }

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el) { if (el.dataset.act === 'add') pickMeal = el.dataset.meal; acts[el.dataset.act]?.(el.dataset); return; }
  const t = e.target.closest('#tabs button');
  if (t) { tab = t.dataset.tab; render(); window.scrollTo(0, 0); return; }
  if (e.target.id === 'sheet-close' || e.target.id === 'sheet') { closeSheet(); render(); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'pick-q') $('#pick-list').innerHTML = foodRows(e.target.value, 'pick');
  else if (e.target.id === 'food-q') renderFoodList();
  else if (e.target.id === 'q-grams') updateQtyPreview();
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'off-q') offSearch();
  else if (e.target.id === 'code-manual') handleCode(e.target.value);
  else if (e.target.id === 'q-grams') saveEntry();
});
document.addEventListener('change', e => {
  if (e.target.id === 'import-file' && e.target.files[0]) importData(e.target.files[0]);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
window.addEventListener('online', sync);

render();
initSync();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
