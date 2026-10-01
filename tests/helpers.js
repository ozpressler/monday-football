'use strict';
// Test harness: loads the real index.html in jsdom, with optional fake Supabase.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync(process.env.APP_HTML || path.join(__dirname, '..', 'index.html'), 'utf8');

/* ---------- fake Supabase server (mirrors the SQL functions) ---------- */
function makeMockServer() {
  const M = {
    groups: {
      sunday: { name: 'Sunday Crew', data: { players: [], nights: [] }, version: 0, view: 'vv11', admin: 'aa11', pub: false, backups: [] },
    },
    createCode: 'cc11', locked: false, down: false, log: [],
  };
  M.fetch = async (url, o) => {
    if (!String(url).startsWith('https://mock.local')) throw new Error('unexpected network call: ' + url);
    const fn = url.split('/rpc/')[1], a = JSON.parse(o.body); M.log.push(fn);
    if (M.down) throw new TypeError('offline');
    const key = String(a.p_group || '').trim().toLowerCase(), g = M.groups[key], c = a.p_code ?? '';
    let r;
    if (fn === 'create_group') {
      const nm = String(a.p_name || '').trim().toLowerCase();
      if (M.createCode && a.p_create_code !== M.createCode) r = { error: 'forbidden' };
      else if (nm.length < 2 || nm.length > 40 || a.p_admin_code.length < 4 || a.p_view_code.length < 4 || a.p_admin_code === a.p_view_code) r = { error: 'invalid' };
      else if (M.groups[nm]) r = { error: 'exists' };
      else { M.groups[nm] = { name: a.p_name.trim(), data: { players: [], nights: [] }, version: 0, view: a.p_view_code, admin: a.p_admin_code, pub: false, backups: [] }; r = { ok: true }; }
    } else if (!g) r = { error: 'forbidden' };
    else if (fn === 'get_state') {
      if (M.locked) r = { error: 'locked' };
      else r = (g.pub || c === g.view || c === g.admin) ? { data: g.data, version: g.version, admin: c === g.admin, name: g.name } : { error: 'forbidden' };
    } else if (c !== g.admin) r = { error: 'forbidden' };
    else if (fn === 'save_state') {
      if (a.p_version !== g.version) r = { error: 'conflict', data: g.data, version: g.version };
      else { g.data = JSON.parse(JSON.stringify(a.p_data)); g.version++; r = { ok: true, version: g.version }; }
    } else if (fn === 'rename_group') {
      const nm = String(a.p_new_name || '').trim().toLowerCase();
      if (nm.length < 2) r = { error: 'invalid' };
      else if (nm !== key && M.groups[nm]) r = { error: 'exists' };
      else { delete M.groups[key]; g.name = a.p_new_name.trim(); M.groups[nm] = g; r = { ok: true, name: g.name }; }
    } else if (fn === 'change_codes') {
      const nv = (a.p_new_view || '').trim() || g.view, na = (a.p_new_admin || '').trim() || g.admin;
      if (nv === na) r = { error: 'same' }; else { g.view = nv; g.admin = na; r = { ok: true }; }
    } else if (fn === 'save_backup') {
      g.backups.push({ id: g.backups.length + 1, label: a.p_label, at: new Date().toISOString(), data: JSON.parse(JSON.stringify(a.p_data)) }); r = { ok: true };
    } else if (fn === 'list_backups') {
      r = { items: g.backups.slice().reverse().map(x => ({ id: x.id, label: x.label, created_at: x.at, players: x.data.players.length, nights: x.data.nights.length })) };
    } else if (fn === 'get_backup') {
      const x = g.backups.find(v => v.id === a.p_id); r = x ? { data: x.data } : { error: 'notfound' };
    } else r = { error: 'unknown function ' + fn };
    const wire = JSON.stringify(r);                       // like a real network response: the app gets a copy
    return { ok: true, json: async () => JSON.parse(wire) };
  };
  return M;
}

/* ---------- app loader ---------- */
async function loadApp({ mock = null, storage = {}, config = null } = {}) {
  const alerts = [], confirms = [];
  const dom = new JSDOM(HTML, {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      Object.entries(storage).forEach(([k, v]) => w.localStorage.setItem(k, v));
      w.MF_CONFIG = mock ? { url: 'https://mock.local', key: 'k' } : (config || { url: '', key: '' });
      if (mock) w.fetch = mock.fetch;
      w.alert = m => alerts.push(String(m));
      w.confirm = m => { confirms.push(String(m)); return true; };
    },
  });
  const w = dom.window;
  const doc = w.document;
  const app = {
    w, doc, alerts, confirms, mock,
    /** run code inside the app and return a plain JSON copy of the result */
    ev: code => JSON.parse(w.eval(`JSON.stringify((() => { return (${code}); })())`) ?? 'null'),
    run: code => w.eval(code),
    qs: sel => doc.querySelector(sel),
    qsa: sel => [...doc.querySelectorAll(sel)],
    click: sel => { const el = doc.querySelector(sel); if (!el) throw new Error('click: not found ' + sel); el.click(); },
    has: sel => !!doc.querySelector(sel),
    text: () => doc.getElementById('app').textContent.replace(/\s+/g, ' ').trim(),
    nav: () => [...doc.querySelectorAll('#nav button')].map(b => b.textContent.trim()),
    set(id, value) { const el = doc.getElementById(id); if (!el) throw new Error('set: no element #' + id); el.value = value; },
    change(el, value) {
      if (typeof el === 'string') el = doc.querySelector(el);
      if (!el) throw new Error('change: element not found');
      if (el.type === 'checkbox') el.checked = value; else if (value !== undefined) el.value = value;
      el.dispatchEvent(new w.Event('change', { bubbles: true }));
    },
    wait: ms => new Promise(r => setTimeout(r, ms)),
    /** click a [data-a] action, optionally narrowed by other data attributes */
    act(action, attrs = {}) {
      const sel = `[data-a="${action}"]` + Object.entries(attrs).map(([k, v]) => `[data-${k}="${v}"]`).join('');
      app.click(sel);
    },
    tab(k) { app.click(`[data-a="tab"][data-k="${k}"]`); },
    async dispose() { await new Promise(r => setTimeout(r, 40)); w.close(); },
  };
  return app;
}

/* ---------- world builder: create players/nights without clicking ---------- */
// spec = { players: ['Ann', ...], nights: [{ date, teams: { Red: [...], Blue: [...] }, games: [{ a, b, goals: [[team, scorer, assist?, min?]] }] }], settings }
function worldJson(spec) {
  const COL = { Red: '#e5484d', Blue: '#3e63dd', Yellow: '#f5c400', Green: '#30a46c' };
  const players = spec.players.map(n => (typeof n === 'string' ? { name: n } : n)).map(p => ({ id: p.name, name: p.name, seed: 5, adj: 0, regular: false, ...p }));
  const nights = (spec.nights || []).map((n, ni) => {
    const teams = Object.entries(n.teams).map(([name, ids]) => ({ id: `${n.date}-${name}`, name, color: COL[name], playerIds: ids }));
    const matches = (n.games || []).map((g, gi) => ({
      id: `${n.date}-g${gi}`, a: `${n.date}-${g.a}`, b: `${n.date}-${g.b}`, saved: true,
      goals: (g.goals || []).map((x, k) => ({ id: `${n.date}-g${gi}-${k}`, teamId: `${n.date}-${x[0]}`, scorer: x[1] || null, assist: x[2] || null, min: x[3] ?? null })),
    }));
    return { id: 'n' + ni, date: n.date, created: String(ni), teams, bench: n.bench || [], matches, finished: n.finished !== false };
  });
  return { players, nights, settings: spec.settings };
}
function seedWorld(app, spec) {
  app.w.__world = JSON.stringify(worldJson(spec));
  app.run('S = JSON.parse(__world); render();');
}
/** add n generic players named P01..Pn (seed grade configurable) */
const names = (n, prefix = 'P') => Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`);
const isoDaysAgo = d => new Date(Date.now() - d * 864e5).toLocaleDateString('en-CA');

module.exports = { loadApp, makeMockServer, seedWorld, worldJson, names, isoDaysAgo };
