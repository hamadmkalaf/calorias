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
  const base = { foods: {}, entries: {}, reports: {}, settings: { goals: { ...DEFAULT_GOALS }, updated_at: 0 }, dirty: {}, lastSeq: 0 };
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
let reportMode = 'week';

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
  else { v.innerHTML = settingsHtml(); updateGoalsPreview(); }
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
  ${getCfg() ? `<p class="muted" id="sync-status" style="text-align:center;margin:-6px 0 10px">${esc(session ? syncStatus : authReady ? 'Sem login: os dados ficam só neste aparelho. Entre em Ajustes.' : '')}</p>` : ''}
  <div class="card">
    <div class="row between">
      <div><div class="kcal-big num">${f0(tot.kcal)}</div><div class="muted">de ${f0(g.kcal)} kcal</div></div>
      <div style="text-align:right"><div class="num" style="font-weight:600">${f0(Math.abs(left))} kcal</div><div class="muted">${left >= 0 ? 'restantes' : 'acima da meta'}</div></div>
    </div>
    ${bar(tot.kcal, g.kcal)}
    <div class="macros">${macro('protein', 'Proteína')}${macro('carbs', 'Carbo')}${macro('fat', 'Gordura')}${macro('fiber', 'Fibra')}</div>
  </div>
  <button class="card row between" data-act="weight" style="width:100%;text-align:left">
    <span>Peso</span><span class="num muted">${weights()[day] ? fkg(weights()[day]) + ' kg' : 'Registrar'} ›</span>
  </button>`;

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

/* ---------- peso ---------- */
// As pesagens ficam em settings.weights ({ 'AAAA-MM-DD': kg }) e sincronizam junto com os ajustes.
const weights = () => db.settings.weights || {};
const fkg = n => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
function weightStats(from, to) {
  let n = 0, s = 0;
  for (const [d, kg] of Object.entries(weights())) if (d >= from && d <= to) { n++; s += kg; }
  return n ? { n, avg: s / n } : null;
}
function weightSheet() {
  const cur = weights()[day];
  const last = Object.keys(weights()).filter(d => d < day).sort().pop();
  openSheet('Peso · ' + dayLabel(), `
    <label for="w-kg">Peso (kg)</label><input id="w-kg" inputmode="decimal" value="${cur ?? ''}" placeholder="Ex.: 80,5">
    ${last ? `<p class="muted">Pesagem anterior: ${fkg(weights()[last])} kg em ${shortDay(last)}.</p>` : ''}
    <p class="muted">Pese-se sempre no mesmo horário, de preferência ao acordar. O relatório semanal usa a média das pesagens da semana.</p>
    <div class="btns" style="margin-top:14px">
      ${cur ? '<button class="btn danger" data-act="delweight">Remover</button>' : ''}
      <button class="btn primary" data-act="saveweight">Salvar</button>
    </div>`);
  $('#w-kg').focus();
}
function saveWeight(remove) {
  const kg = num($('#w-kg').value);
  if (!remove && (kg < 20 || kg > 400)) return toast('Informe o peso em kg.');
  const w = { ...weights() };
  if (remove) delete w[day]; else w[day] = kg;
  const s = { ...db.settings, weights: w };
  const latest = Object.keys(w).sort().pop();
  if (latest) { // o peso mais recente passa a valer para a meta de proteína por kg
    s.weight = w[latest];
    if (s.level && s.level !== 'manual') { const { short, ...g } = calcGoals(s.weight, num(s.level), s.goals.kcal); s.goals = g; }
  }
  put('settings', s);
  closeSheet();
  render();
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

/* ---------- relatórios mensais ---------- */
const monthLabel = m => new Date(Number(m.slice(0, 4)), Number(m.slice(5)) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
function buildReport(month, entries) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const byDay = {};
  for (const e of entries) (byDay[e.date] ??= []).push(e);
  const blank = () => ({ days: 0, ...Object.fromEntries(NUTS.map(n => [n, 0])) });
  const total = blank(), weeks = [];
  for (let start = 1; start <= last;) { // semanas de segunda a domingo, cortadas nos limites do mês
    const dow = (new Date(y, m - 1, start).getDay() + 6) % 7;
    const end = Math.min(last, start + 6 - dow);
    const w = { start, end, ...blank() };
    for (let d = start; d <= end; d++) {
      const list = byDay[`${month}-${String(d).padStart(2, '0')}`];
      if (!list) continue;
      w.days++; total.days++;
      for (const n of NUTS) { const s = list.reduce((a, e) => a + (e[n] || 0), 0); w[n] += s; total[n] += s; }
    }
    weeks.push(w);
    start = end + 1;
  }
  return { id: 'report-' + month, month, weeks, total, goals: { ...db.settings.goals }, created_at: Date.now() };
}
function monthsWithData() {
  const live = new Set(Object.values(db.entries).filter(e => !e.deleted).map(e => e.date.slice(0, 7)));
  const done = Object.values(db.reports).filter(r => !r.deleted).map(r => r.month);
  return [...new Set([...live, ...done])].sort().reverse();
}
function reportFor(month) {
  const saved = db.reports['report-' + month];
  if (saved && !saved.deleted) return { ...saved, archived: true };
  return buildReport(month, Object.values(db.entries).filter(e => !e.deleted && e.date.startsWith(month)));
}
const avg = (o, n) => (o.days ? o[n] / o.days : 0);
function reportText(r) {
  const mon = new Date(Number(r.month.slice(0, 4)), Number(r.month.slice(5)) - 1, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  const line = o => `${f0(avg(o, 'kcal'))} kcal/dia · Proteína ${f0(avg(o, 'protein'))} g · Carbo ${f0(avg(o, 'carbs'))} g · Gordura ${f0(avg(o, 'fat'))} g · Fibra ${f0(avg(o, 'fiber'))} g`;
  return [
    `Relatório de ${monthLabel(r.month)}`,
    `Dias registrados: ${r.total.days}`,
    `Média do mês: ${line(r.total)}`,
    `Meta: ${f0(r.goals.kcal)} kcal · Proteína ${f0(r.goals.protein)} g`,
    '',
    ...r.weeks.map((w, i) => `Semana ${i + 1} (${w.start}–${w.end} ${mon}), ${w.days} dia${w.days === 1 ? '' : 's'}: ${w.days ? line(w) : 'sem registros'}`),
  ].join('\n');
}
function statBlock(title, o, g, wt) {
  return `<div class="card" style="margin:10px 0 0">
      <div class="row between"><h3>${title}</h3><span class="muted">${o.days} dia${o.days === 1 ? '' : 's'} registrado${o.days === 1 ? '' : 's'}</span></div>
      ${o.days ? `<div class="row between" style="margin-top:8px"><span class="num"><b>${f0(avg(o, 'kcal'))}</b> kcal por dia</span><span class="muted num">meta ${f0(g.kcal)}</span></div>
      ${bar(avg(o, 'kcal'), g.kcal)}
      <div class="muted" style="margin-top:8px">Proteína ${f0(avg(o, 'protein'))} g (meta ${f0(g.protein)}) · Carbo ${f0(avg(o, 'carbs'))} g · Gordura ${f0(avg(o, 'fat'))} g · Fibra ${f0(avg(o, 'fiber'))} g</div>` : '<div class="empty">Sem registros neste período.</div>'}
      ${wt ? `<div class="num" style="margin-top:8px">Peso médio <b>${fkg(wt.avg)} kg</b> <span class="muted">(${wt.n} pesage${wt.n === 1 ? 'm' : 'ns'})</span></div>` : ''}
    </div>`;
}

/* relatório semanal (segunda a domingo), calculado a partir dos registros ainda guardados */
const dOf = s => new Date(s + 'T12:00');
const addDays = (s, n) => { const d = dOf(s); d.setDate(d.getDate() + n); return isoDate(d); };
const weekStart = s => addDays(s, -((dOf(s).getDay() + 6) % 7));
const shortDay = s => dOf(s).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '');
const weekLabel = st => { const en = addDays(st, 6); return st.slice(0, 7) === en.slice(0, 7) ? `${dOf(st).getDate()}–${shortDay(en)}` : `${shortDay(st)} – ${shortDay(en)}`; };
function weeksWithData() {
  return [...new Set(Object.values(db.entries).filter(e => !e.deleted).map(e => weekStart(e.date)))].sort().reverse();
}
function buildWeek(start) {
  const total = { days: 0, ...Object.fromEntries(NUTS.map(n => [n, 0])) }, days = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i), list = liveEntries(date), d = { date, has: list.length > 0 };
    for (const n of NUTS) d[n] = list.reduce((a, e) => a + (e[n] || 0), 0);
    if (d.has) { total.days++; for (const n of NUTS) total[n] += d[n]; }
    days.push(d);
  }
  return { start, days, total };
}
function weekSheet(start) {
  const w = buildWeek(start), prev = buildWeek(addDays(start, -7)), g = db.settings.goals;
  const wd = s => dOf(s).toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric' }).replace('.', '');
  const diff = avg(w.total, 'kcal') - avg(prev.total, 'kcal');
  const cmpK = w.total.days && prev.total.days ? `Semana anterior: ${f0(avg(prev.total, 'kcal'))} kcal por dia (${diff >= 0 ? '+' : '−'}${f0(Math.abs(diff))} nesta semana).` : '';
  const ws = weightStats(start, addDays(start, 6)), pw = weightStats(addDays(start, -7), addDays(start, -1));
  const wdiff = ws && pw ? ws.avg - pw.avg : 0;
  const cmpW = ws && pw ? `Peso médio na semana anterior: ${fkg(pw.avg)} kg (${wdiff >= 0 ? '+' : '−'}${fkg(Math.abs(wdiff))} kg nesta semana).` : '';
  const cmp = [cmpK, cmpW].filter(Boolean).join(' ');
  const dayW = d => (weights()[d.date] ? `${fkg(weights()[d.date])} kg` : '');
  const line = o => `${f0(avg(o, 'kcal'))} kcal/dia · Proteína ${f0(avg(o, 'protein'))} g · Carbo ${f0(avg(o, 'carbs'))} g · Gordura ${f0(avg(o, 'fat'))} g · Fibra ${f0(avg(o, 'fiber'))} g`;
  reportSheet.text = [
    `Relatório semanal: ${weekLabel(start)}`,
    `Dias registrados: ${w.total.days} de 7`,
    `Média: ${w.total.days ? line(w.total) : 'sem registros'}`,
    `Meta: ${f0(g.kcal)} kcal · Proteína ${f0(g.protein)} g`,
    ...(ws ? [`Peso médio: ${fkg(ws.avg)} kg (${ws.n} pesage${ws.n === 1 ? 'm' : 'ns'})`] : []),
    ...(cmpK ? [cmpK] : []),
    ...(cmpW ? [cmpW] : []),
    '',
    ...w.days.map(d => `${wd(d.date)}: ${[d.has ? `${f0(d.kcal)} kcal · Proteína ${f0(d.protein)} g` : 'sem registro', dayW(d)].filter(Boolean).join(' · ')}`),
  ].join('\n');
  openSheet('Semana de ' + weekLabel(start), `
    <p class="muted" style="margin:0">Médias diárias, considerando só os dias com registro.</p>
    ${statBlock('Média da semana', w.total, g, ws)}
    ${cmp ? `<p class="muted" style="margin:10px 2px 0">${cmp}</p>` : ''}
    <div class="card" style="margin:10px 0 0;padding-bottom:4px">
      <h3 style="margin-bottom:8px">Dia a dia</h3>
      ${w.days.map(d => `<div class="item"><div class="grow" style="text-transform:capitalize">${wd(d.date)}</div>
        <div class="num ${d.has ? '' : 'muted'}" style="text-align:right">${d.has ? `${f0(d.kcal)} kcal · P ${f0(d.protein)} g` : 'sem registro'}${dayW(d) ? `<div class="muted">${dayW(d)}</div>` : ''}</div></div>`).join('')}
    </div>
    <button class="btn primary block" style="margin-top:14px" data-act="sharereport">Compartilhar relatório</button>`);
}

function reportSheet(month) {
  const r = reportFor(month);
  reportSheet.text = reportText(r);
  const dd = n => `${month}-${String(n).padStart(2, '0')}`;
  const block = (title, o) => statBlock(title, o, r.goals, weightStats(dd(o.start || 1), dd(o.end || 31)));
  const mon = new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  openSheet('Relatório de ' + monthLabel(month), `
    <p class="muted" style="margin:0">Médias diárias, considerando só os dias com registro.${r.archived ? ' Os registros detalhados deste mês já foram limpos.' : ''}</p>
    ${block('Mês inteiro', r.total)}
    ${r.weeks.map((w, i) => block(`Semana ${i + 1} · ${w.start}–${w.end} ${mon}`, w)).join('')}
    <button class="btn primary block" style="margin-top:14px" data-act="sharereport">Compartilhar relatório</button>`);
}
async function shareReport() {
  const text = reportSheet.text;
  try {
    if (navigator.share) await navigator.share({ title: text.split('\n')[0], text });
    else { await navigator.clipboard.writeText(text); toast('Relatório copiado.'); }
  } catch (e) { if (e?.name !== 'AbortError') toast('Não foi possível compartilhar.'); }
}
// Cada mês fica guardado por inteiro durante todo o mês seguinte; depois vira relatório e os registros são limpos.
function archiveOldMonths() {
  const now = new Date();
  const cutoff = isoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)).slice(0, 7);
  const old = {};
  for (const e of Object.values(db.entries)) if (!e.deleted && e.date.slice(0, 7) < cutoff) (old[e.date.slice(0, 7)] ??= []).push(e);
  const months = Object.keys(old).sort();
  for (const month of months) {
    const id = 'report-' + month;
    if (db.reports[id] && !db.reports[id].deleted) continue; // já existe relatório: mantém os registros que chegaram depois
    put('reports', buildReport(month, old[month]));
    for (const e of old[month]) put('entries', { id: e.id, date: e.date, deleted: true });
  }
  if (months.some(m => db.reports['report-' + m]?.created_at > Date.now() - 5000)) {
    toast(`Relatório de ${monthLabel(months[months.length - 1])} disponível em Ajustes.`, 5000);
    if ($('#sheet').classList.contains('hidden')) render();
  }
}

/* ---------- ajustes ---------- */
function settingsHtml() {
  const s = db.settings, g = s.goals, lvl = s.level || '1.5';
  const opt = (v, label) => `<option value="${v}" ${v === lvl ? 'selected' : ''}>${label}</option>`;
  return `<h1>Ajustes</h1>
  <div class="card">
    <h3>Metas e macros</h3>
    <div class="grid2">
      <div><label for="g-weight">Seu peso (kg)</label><input id="g-weight" inputmode="decimal" value="${s.weight || ''}"></div>
      <div><label for="g-kcal">Calorias por dia (kcal)</label><input id="g-kcal" inputmode="decimal" value="${g.kcal}"></div>
    </div>
    <label for="g-level">Proteína</label>
    <select id="g-level">
      ${opt('2', 'Alta — 2,0 g por kg')}${opt('1.5', 'Média — 1,5 g por kg')}${opt('1', 'Normal — 1,0 g por kg')}${opt('manual', 'Manual — eu defino os macros')}
    </select>
    <div class="preview num ${lvl === 'manual' ? 'hidden' : ''}" id="g-auto"></div>
    <div class="grid2 ${lvl === 'manual' ? '' : 'hidden'}" id="g-manual">${NUTS.slice(1).map(n => `<div><label for="g-${n}">${NUT_LABEL[n]}</label><input id="g-${n}" inputmode="decimal" value="${g[n]}"></div>`).join('')}</div>
    <button class="btn primary block" style="margin-top:14px" data-act="savegoals">Salvar metas</button>
  </div>
  <div class="card"><h3>Sincronização</h3>${syncHtml()}</div>
  <div class="card" style="padding-bottom:4px">
    <h3>Relatórios</h3>
    <div class="btns" style="margin:10px 0 4px">
      <button class="btn small ${reportMode === 'week' ? 'primary' : ''}" data-act="repmode" data-m="week">Semanal</button>
      <button class="btn small ${reportMode === 'month' ? 'primary' : ''}" data-act="repmode" data-m="month">Mensal</button>
    </div>
    ${reportMode === 'week' ? `<p class="muted">Média diária e dia a dia, de segunda a domingo.</p>
    ${weeksWithData().map(s => `<button class="item" data-act="week" data-s="${s}"><div class="grow">${esc(weekLabel(s))}</div><span class="muted">${s === weekStart(isoDate(new Date())) ? 'em andamento' : 'ver'} ›</span></button>`).join('') || '<div class="empty" style="padding-bottom:10px">Ainda não há registros.</div>'}`
    : `<p class="muted">Resumo por semana. Um mês depois de encerrado, os registros detalhados são limpos e fica só o relatório.</p>
    ${monthsWithData().map(m => `<button class="item" data-act="report" data-m="${m}"><div class="grow" style="text-transform:capitalize">${esc(monthLabel(m))}</div><span class="muted">${db.reports['report-' + m] && !db.reports['report-' + m].deleted ? 'arquivado' : 'ver'} ›</span></button>`).join('') || '<div class="empty" style="padding-bottom:10px">Ainda não há registros.</div>'}`}
  </div>
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
// Proteína pelo peso; gordura = 30% das calorias; carboidrato = o que sobra; fibra = 14 g por 1000 kcal.
function calcGoals(weight, perKg, kcal) {
  const protein = Math.round(weight * perKg);
  const fat = Math.round((kcal * 0.3) / 9);
  const rest = kcal - protein * 4 - fat * 9;
  return { kcal, protein, fat, carbs: Math.max(0, Math.round(rest / 4)), fiber: Math.round((kcal / 1000) * 14), short: rest < 0 };
}
function updateGoalsPreview() {
  const lvl = $('#g-level')?.value;
  if (!lvl) return;
  $('#g-auto').classList.toggle('hidden', lvl === 'manual');
  $('#g-manual').classList.toggle('hidden', lvl !== 'manual');
  if (lvl === 'manual') return;
  const weight = num($('#g-weight').value), kcal = num($('#g-kcal').value);
  if (weight <= 0 || kcal <= 0) { $('#g-auto').textContent = 'Informe seu peso e as calorias para calcular os macros.'; return; }
  const c = calcGoals(weight, num(lvl), kcal);
  const pct = g => Math.round((g / kcal) * 100);
  $('#g-auto').innerHTML = `<b>Proteína ${c.protein} g</b> (${pct(c.protein * 4)}%) · Carbo ${c.carbs} g (${pct(c.carbs * 4)}%) · Gordura ${c.fat} g (${pct(c.fat * 9)}%) · Fibra ${c.fiber} g`
    + (c.short ? '<br>As calorias são baixas demais para essa proteína com 30% de gordura; o carboidrato ficou em zero.' : '');
}
function saveGoals() {
  const level = $('#g-level').value, weight = num($('#g-weight').value), kcal = num($('#g-kcal').value);
  if (kcal <= 0) return toast('Informe as calorias por dia.');
  let goals;
  if (level === 'manual') goals = { kcal, ...Object.fromEntries(NUTS.slice(1).map(n => [n, num($(`#g-${n}`).value)])) };
  else {
    if (weight <= 0) return toast('Informe seu peso para calcular a proteína.');
    const { short, ...c } = calcGoals(weight, num(level), kcal);
    goals = c;
  }
  put('settings', { ...db.settings, weight: weight || null, level, goals });
  render();
  toast('Metas salvas.');
}
function exportData() {
  const blob = new Blob([JSON.stringify({ foods: db.foods, entries: db.entries, reports: db.reports, settings: db.settings }, null, 1)], { type: 'application/json' });
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
    for (const kind of ['foods', 'entries', 'reports']) for (const rec of Object.values(data[kind] || {})) {
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
let sb = null, session = null, authReady = false, syncing = false, syncTimer = null, syncStatus = 'Ainda não sincronizado.';
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
    sb.auth.onAuthStateChange((_e, s) => { const was = session?.user?.id; session = s; if (s?.user?.id !== was) { if ($('#sheet').classList.contains('hidden')) render(); if (s) sync(); } });
    authReady = true;
    if ($('#sheet').classList.contains('hidden')) render();
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
  let ok = false;
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
    ok = true;
  } catch (e) {
    setStatus('Falha ao sincronizar: ' + (e?.message || 'sem conexão') + '.');
  } finally { syncing = false; }
  if (ok) archiveOldMonths(); // só limpa meses antigos depois de receber tudo dos outros aparelhos
}
async function auth(mode) {
  const email = $('#au-email').value.trim(), password = $('#au-pass').value;
  if (!email || password.length < 6) return toast('Informe e-mail e senha (mínimo de 6 caracteres).');
  if (!sb) return toast('Sem conexão com o servidor.');
  const { data, error } = mode === 'signup' ? await sb.auth.signUp({ email, password }) : await sb.auth.signInWithPassword({ email, password });
  if (error) return toast('Erro: ' + error.message, 4000);
  if (mode === 'signup' && !data.session) toast('Conta criada, mas você ainda NÃO está conectado: confirme pelo link enviado ao seu e-mail e depois toque em Entrar.', 9000);
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
  report: d => reportSheet(d.m),
  week: d => weekSheet(d.s),
  weight: weightSheet,
  saveweight: () => saveWeight(false),
  delweight: () => saveWeight(true),
  repmode: d => { reportMode = d.m; render(); },
  sharereport: shareReport,
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
  else if (['g-weight', 'g-kcal', 'g-level'].includes(e.target.id)) updateGoalsPreview();
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'off-q') offSearch();
  else if (e.target.id === 'code-manual') handleCode(e.target.value);
  else if (e.target.id === 'q-grams') saveEntry();
  else if (e.target.id === 'w-kg') saveWeight(false);
});
document.addEventListener('change', e => {
  if (e.target.id === 'import-file' && e.target.files[0]) importData(e.target.files[0]);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
window.addEventListener('online', sync);

render();
initSync();
if (!getCfg()) archiveOldMonths(); // sem sincronização configurada, a limpeza roda ao abrir o app
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
