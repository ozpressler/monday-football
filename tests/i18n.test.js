'use strict';
// QA: Hebrew language + right-to-left layout
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, makeMockServer, seedWorld } = require('./helpers');
const { crawlLocal, crawlCloud, HEBREW_NAMES } = require('./crawl');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');   // same result on Windows and Linux
const hasLatin = s => /[A-Za-z]{2,}/.test(s);
// things that are allowed to stay Latin: the language's own name, data typed by users (group names), technical file names
const ALLOWED = [/^English$/, /Sunday Crew/g, /Thursday/g, /supabase[-\w.]*/gi, /Supabase/g];
const stripAllowed = s => ALLOWED.reduce((t, re) => t.replace(re, ''), s);

/* ---- coverage: nothing visible is left in English ---- */
test('Hebrew: every screen and message reached by the crawler is fully translated (local mode)', { timeout: 120000 }, async () => {
  const seen = await crawlLocal('he');
  assert.ok(seen.size > 250, 'crawler should have visited many screens, saw ' + seen.size);
  const left = [...seen].filter(([s]) => hasLatin(stripAllowed(s))).map(([s, step]) => `${JSON.stringify(s)}  (screen: ${step})`);
  assert.deepEqual(left, [], 'untranslated text:\n' + left.join('\n'));
});

test('Hebrew: every screen reached in signed-in mode is fully translated (sign-in, groups, backups, viewer, offline)', { timeout: 120000 }, async () => {
  const seen = await crawlCloud('he');
  assert.ok(seen.size > 100, 'saw ' + seen.size);
  const left = [...seen].filter(([s]) => hasLatin(stripAllowed(s))).map(([s, step]) => `${JSON.stringify(s)}  (screen: ${step})`);
  assert.deepEqual(left, [], 'untranslated text:\n' + left.join('\n'));
});

test('Hebrew: every fixed message in the source code has a translation (including rare ones the crawler misses)', async () => {
  const app = await loadApp({ storage: { 'mf.lang': 'he' } });
  try {
    const start = HTML.indexOf('<script>\n');
    assert.ok(start > 0, 'could not find the app script');
    const js = HTML.slice(start);
    const found = new Set(), add = t => { t = t.replace(/\s+/g, ' ').trim(); if (hasLatin(t)) found.add(t); };
    for (const m of js.matchAll(/>([^<>`${}\n]*[A-Za-z]{2,}[^<>`${}\n]*)</g)) add(m[1].replace(/&amp;/g, '&'));
    for (const m of js.matchAll(/(?:alert|confirm)\(\s*(['`"])((?:\\.|(?!\1).)*)\1/g)) if (!m[2].includes('${')) add(m[2].replace(/\\'/g, "'").replace(/\\n/g, ' '));
    for (const m of js.matchAll(/cloud\.err = '([^']*)'/g)) add(m[1]);
    for (const m of js.matchAll(/placeholder="([^"$]*)"/g)) add(m[1]);
    // strings that are code, not text
    const ignore = s => /[(){};=]|=>|\.replace|Math\.|tr\(/.test(s) || s.length < 3;
    assert.ok(found.size > 60, `the scan should find many messages, but found only ${found.size}`);
    const missing = [...found].filter(s => !ignore(s) && s !== 'English').filter(s => app.ev(`tr(${JSON.stringify(s)})`) === s);
    assert.deepEqual(missing, [], 'no Hebrew for:\n' + missing.join('\n'));
  } finally { await app.dispose(); }
});

test('Hebrew dictionary: no accidental English left inside translations, no empty values', async () => {
  const app = await loadApp();
  try {
    const dict = app.ev('I18N.he.dict');
    const bad = Object.entries(dict).filter(([k, v]) => !v || (hasLatin(stripAllowed(v)) && k !== 'English'));
    assert.deepEqual(bad, []);
    assert.ok(Object.keys(dict).length > 200);
  } finally { await app.dispose(); }
});

/* ---- direction and language switching ---- */
test('English is the default and is left-to-right', async () => {
  const app = await loadApp();
  try {
    assert.equal(app.doc.documentElement.dir, 'ltr'); assert.equal(app.doc.documentElement.lang, 'en');
    assert.equal(app.doc.querySelector('header h1').textContent, '⚽ Monday Night Football');
  } finally { await app.dispose(); }
});

test('a Hebrew phone gets Hebrew by default, English phones stay English', async () => {
  const he = await loadApp({ navLang: 'he-IL' }), en = await loadApp({ navLang: 'en-US' }), fr = await loadApp({ navLang: 'fr-FR' });
  try {
    assert.equal(he.ev('LANG'), 'he'); assert.equal(en.ev('LANG'), 'en'); assert.equal(fr.ev('LANG'), 'en', 'unsupported languages fall back to English');
  } finally { await he.dispose(); await en.dispose(); await fr.dispose(); }
});

test('Hebrew: page is right-to-left, with Hebrew title and header', async () => {
  const app = await loadApp({ storage: { 'mf.lang': 'he' } });
  try {
    assert.equal(app.doc.documentElement.dir, 'rtl'); assert.equal(app.doc.documentElement.lang, 'he');
    assert.equal(app.doc.title, 'כדורגל ליל שני');
    assert.equal(app.doc.querySelector('header h1').textContent, '⚽ כדורגל ליל שני');
    assert.deepEqual(app.nav(), ['⚽ ערב', '📊 סטטיסטיקה', '👥 שחקנים', '💾 נתונים', '⚙️ הגדרות']);
  } finally { await app.dispose(); }
});

test('switching language in Settings changes everything at once, is remembered, and switching back restores English exactly', async () => {
  const app = await loadApp({ storage: {} });
  try {
    seedWorld(app, { players: HEBREW_NAMES.slice(0, 6) });
    app.tab('settings');
    const english = app.text() + '|' + app.nav().join();
    app.change('[data-c="lang"]', 'he');
    assert.equal(app.doc.documentElement.dir, 'rtl');
    assert.equal(app.w.localStorage.getItem('mf.lang'), 'he');
    assert.match(app.text(), /שפה/); assert.match(app.text(), /משך משחק/);
    assert.ok(!/Game length/.test(app.text()));
    assert.equal(app.qs('[data-c="lang"]').value, 'he');
    app.change('[data-c="lang"]', 'en');
    assert.equal(app.doc.documentElement.dir, 'ltr');
    assert.equal(app.text() + '|' + app.nav().join(), english, 'English view is identical after a round trip');
  } finally { await app.dispose(); }
});

test('the choice survives a reload (stored on the device)', async () => {
  const app = await loadApp({ storage: { 'mf.lang': 'he' } });
  try { assert.equal(app.ev('LANG'), 'he'); assert.match(app.text(), /אין ערב פעיל/); } finally { await app.dispose(); }
});

test('sign-in screen has a language toggle that works before logging in', async () => {
  const mock = makeMockServer();
  const app = await loadApp({ mock }); await app.wait(60);
  try {
    assert.match(app.text(), /Sign in/);
    app.click('[data-a="setLang"]');
    assert.match(app.text(), /התחברות/); assert.equal(app.doc.documentElement.dir, 'rtl');
    assert.equal(app.qs('#grp').placeholder, 'שם החבורה');
    assert.equal(app.qs('[data-a="setLang"]').textContent, 'English', 'the toggle offers the other language');
    app.click('[data-a="setLang"]');
    assert.match(app.text(), /Sign in/);
  } finally { await app.dispose(); }
});

test('viewers can change language from their Account tab', async () => {
  const mock = makeMockServer();
  const app = await loadApp({ mock }); await app.wait(60);
  try {
    app.set('grp', 'sunday'); app.set('code', 'vv11'); app.act('login'); await app.wait(120);
    app.tab('data');
    assert.ok(app.has('[data-c="lang"]'));
    app.change('[data-c="lang"]', 'he');
    assert.deepEqual(app.nav(), ['⚽ הערב', '📊 סטטיסטיקה', '👤 חשבון']);
  } finally { await app.dispose(); }
});

/* ---- sentences with names and numbers ---- */
async function heApp(players = HEBREW_NAMES) {
  const app = await loadApp({ storage: { 'mf.lang': 'he' } });
  seedWorld(app, { players: players.map((n, i) => ({ name: n, regular: i < 12 })) });
  return app;
}
const tickN = (app, n) => { for (let i = 0; i < n; i++) app.change(app.qsa('[data-c="att"]').find(x => !x.checked), true); };

test('Hebrew: player-count messages read correctly', async () => {
  const app = await heApp();
  try {
    app.tab('night'); app.act('startDraft'); tickN(app, 14);
    assert.match(app.text(), /14 כאן\. נדרשים בדיוק 15 \(3 קבוצות של 5\): הוסיפו עוד 1\./);
    tickN(app, 2);
    assert.match(app.text(), /16 כאן\. נדרשים בדיוק 15 \(3 קבוצות של 5\): בטלו סימון של 1\./);
    app.change(app.qsa('[data-c="att"]').find(x => x.checked), false);
    app.act('autoBalance');
    assert.match(app.text(), /15 כאן · 3 קבוצות של 5 ✓/);
    assert.match(app.text(), /אדומה/); assert.match(app.text(), /כחולה/); assert.match(app.text(), /צהובה/);
  } finally { await app.dispose(); }
});

test('Hebrew: scores, suggestions and plurals', async () => {
  const app = await heApp();
  try {
    app.tab('night'); app.act('startDraft'); tickN(app, 15); app.act('autoBalance'); app.act('beginNight');
    assert.match(app.text(), /הערב · \d{4}-\d\d-\d\d/);
    assert.match(app.text(), /מוצע: אדומה נגד כחולה \(משחק ראשון\)/);
    app.act('newMatch');
    const red = app.ev('activeNight().teams[0]');
    app.click(`[data-a="goal"][data-team="${red.id}"][data-p="${red.playerIds[0]}"]`);
    assert.match(app.qs('.sheet').textContent, /מי בישל\?/);
    app.click(`[data-a="assist"][data-p="${red.playerIds[1]}"]`);
    assert.match(app.qs('.toast').textContent, /⚽ שער של .+ · בישול: .+/);
    app.act('saveMatch');
    assert.match(app.text(), /משחק 1 ✓/);
    assert.match(app.text(), /אדומה 1 – 0 כחולה/);
    assert.match(app.text(), /מוצע: אדומה נגד צהובה \(אדומה ניצחה ונשארת\)/);
    app.act('finishNight');
    assert.match(app.confirms.at(-1), /לסיים את הערב \(משחק אחד\) ולעדכן ציונים\?/);
    assert.match(app.qs('.sheet').textContent, /הערב נשמר/);
  } finally { await app.dispose(); }
});

test('Hebrew: stats table headers, sort arrow and awards', async () => {
  const app = await heApp();
  try {
    app.tab('night'); app.act('startDraft'); tickN(app, 15); app.act('autoBalance'); app.act('beginNight'); app.act('newMatch'); app.act('closeMatch'); app.act('finishNight'); app.act('closeSheet');
    app.tab('stats');
    const heads = app.qsa('#app th').map(th => th.textContent);
    assert.deepEqual(heads, ['שחקן', 'ציון ▾', "מש'", 'נצ%', 'ש', 'ב', 'ש+ב', "ש+ב/מש'"]);
    app.act('view', { k: 'awards' });
    assert.match(app.text(), /פרסים|הציונים הגבוהים ביותר/);
    app.act('view', { k: 'h2h' });
    assert.match(app.text(), /מול אחרים/); assert.match(app.text(), /עם חברים לקבוצה/);
    app.change('[data-c="h2hb"]', HEBREW_NAMES[1]);
    assert.match(app.text(), /אחד מול השני/);
  } finally { await app.dispose(); }
});

test('Hebrew: confirmation and alert messages are translated', async () => {
  const app = await heApp();
  try {
    app.tab('players'); app.act('deletePlayer', { p: HEBREW_NAMES[0] });
    assert.match(app.confirms.at(-1), /^למחוק את אבי לצמיתות\?/);
    assert.match(app.confirms.at(-1), /אפשר לשחזר גיבוי אחר כך/);
    app.tab('night'); app.act('startDraft'); app.run('A.beginNight()');
    assert.match(app.alerts.at(-1), /נדרשים בדיוק 15 שחקנים \(3 קבוצות של 5\) כדי להתחיל\./);
  } finally { await app.dispose(); }
});

test('Hebrew: player names, dates and numbers are left exactly as they are', async () => {
  const app = await heApp(['Alex', 'בני', 'Dana', 'גיל', 'Eli', 'חן']);
  try {
    app.tab('players');
    assert.deepEqual(app.qsa('[data-c="pname"]').map(i => i.value).sort(), ['Alex', 'Dana', 'Eli', 'בני', 'גיל', 'חן'].sort());
    app.tab('night'); app.act('startDraft');
    const t = app.text();
    assert.ok(t.includes('Alex') && t.includes('Dana'), 'Latin player names stay as typed');
    assert.match(app.qs('input[type=date]').value, /^\d{4}-\d\d-\d\d$/, 'dates stay in the same numeric format');
    assert.match(t, /5\.0/, 'grades keep Latin digits');
  } finally { await app.dispose(); }
});

/* ---- layout rules that make right-to-left work ---- */
test('layout uses direction-neutral CSS (start/end, margin-inline) so it mirrors in Hebrew', async () => {
  const css = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));
  assert.match(css, /th,td\{[^}]*text-align:end/);
  assert.match(css, /th:first-child,td:first-child\{text-align:start\}/);
  assert.match(css, /\.pbtn\{[^}]*text-align:start/);
  assert.match(css, /\.pill\{[^}]*margin-inline-end:4px/);
  assert.ok(!/text-align:\s*left/.test(css) && !/text-align:\s*right/.test(css), 'no hard-coded left/right text alignment in CSS');
  assert.ok(!/(?<!-)margin-left|(?<!-)margin-right|padding-left|padding-right/.test(css), 'no hard-coded left/right spacing in CSS');
  assert.match(HTML, /border-inline-start:6px solid/);
});

test('the translator is idempotent and never touches typed values', async () => {
  const app = await heApp(['Red', 'Blue', 'אבי']);       // a player literally named "Red"
  try {
    app.tab('players');
    assert.deepEqual(app.qsa('[data-c="pname"]').map(i => i.value).sort(), ['Blue', 'Red', 'אבי'].sort(), 'input values are never translated');
    const before = app.text(); app.run("translateTree(document.getElementById('app'))");
    assert.equal(app.text(), before);
  } finally { await app.dispose(); }
});

test('English strings are untouched when the language is English (no accidental translation)', async () => {
  const app = await loadApp();
  try { assert.equal(app.ev("tr('Save game')"), 'Save game'); assert.equal(app.ev("trMsg('Delete this game?')"), 'Delete this game?'); } finally { await app.dispose(); }
});

/* ---- share card (drawn on a canvas; jsdom has none, so we record the drawing calls) ---- */
async function drawCard(lang) {
  const app = await loadApp({ storage: lang ? { 'mf.lang': lang } : {} });
  const calls = [];
  const ctx = new Proxy({ textAlign: 'left', direction: 'ltr' }, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'roundRect') return undefined;                          // exercise the plain-rect fallback
      if (k === 'measureText') return s => ({ width: String(s).length * 10 });
      return (...a) => { calls.push({ fn: k, a, align: t.textAlign, dir: t.direction, fill: t.fillStyle }); };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  app.w.HTMLCanvasElement.prototype.getContext = () => ctx;
  app.w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new app.w.Blob(['png'])); };
  seedWorld(app, { players: ['אבי', 'בני', 'גיל', 'דנה'], nights: [{ date: '2026-01-05', teams: { Red: ['אבי', 'בני'], Blue: ['גיל', 'דנה'] },
    games: [{ a: 'Red', b: 'Blue', goals: [['Red', 'אבי'], ['Red', 'אבי'], ['Blue', 'גיל']] }] }] });
  await app.w.eval('nightCardBlob(S.nights[0])');
  await app.dispose();
  return calls;
}

test('share card (English): left-aligned title, first team\'s dot on the left', async () => {
  const calls = await drawCard('');
  const title = calls.find(c => c.fn === 'fillText' && /Monday Night Football/.test(c.a[0]));
  assert.ok(title && title.a[1] === 56 && title.align === 'left');
  const arcs = calls.filter(c => c.fn === 'arc');
  assert.equal(arcs.length, 2);
  assert.ok(arcs[0].a[0] < 540 && arcs[1].a[0] > 540, 'Red dot left, Blue dot right');
  assert.ok(calls.some(c => c.fn === 'fillText' && /Red\s+2 – 1\s+Blue/.test(c.a[0])));
});

test('share card (Hebrew): right-aligned right-to-left title, translated team names, dots mirrored', async () => {
  const calls = await drawCard('he');
  const title = calls.find(c => c.fn === 'fillText' && /כדורגל ליל שני/.test(c.a[0]));
  assert.ok(title, 'translated title');
  assert.equal(title.align, 'right'); assert.equal(title.dir, 'rtl'); assert.equal(title.a[1], 1024);
  const arcs = calls.filter(c => c.fn === 'arc');
  assert.ok(arcs[0].a[0] > 540 && arcs[1].a[0] < 540, 'Red dot on the right (where Red\'s name is), Blue dot on the left');
  assert.ok(calls.some(c => c.fn === 'fillText' && /אדומה\s+2 – 1\s+כחולה/.test(c.a[0])), 'team names translated');
  assert.ok(calls.some(c => c.fn === 'fillText' && /כוכב הערב: אבי \(2 שערים\)/.test(c.a[0])), 'star of the night translated');
  assert.ok(!calls.some(c => c.fn === 'fillText' && /Star of the night|Red|Blue/.test(c.a[0])), 'no English left on the card');
});
