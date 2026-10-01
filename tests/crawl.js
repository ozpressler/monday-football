'use strict';
// Drives the app through (almost) every screen and state and records all visible text.
// Used by i18n.test.js (to prove nothing is left untranslated) and by the dictionary dump tool.
const { loadApp, makeMockServer, seedWorld } = require('./helpers');

const HEBREW_NAMES = ['אבי', 'בני', 'גיל', 'דנה', 'הדר', 'ורד', 'זיו', 'חן', 'טל', 'יעל', 'כרמל', 'לני', 'מאיה', 'נועה', 'סהר', 'עדי', 'פז', 'צביקה', 'קרן', 'רון'];
const T0 = 1_800_000_000_000;

function collector(app) {
  const seen = new Map();   // text -> first step label
  let step = '';
  const add = s => { s = String(s).replace(/\s+/g, ' ').trim(); if (s && !seen.has(s)) seen.set(s, step); };
  return {
    seen,
    at(label) { step = label; },
    snap() {
      for (const id of ['nav', 'app', 'ov']) {
        const el = app.doc.getElementById(id); if (!el) continue;
        const walker = app.doc.createTreeWalker(el, 4);
        while (walker.nextNode()) add(walker.currentNode.nodeValue);
        el.querySelectorAll('[placeholder],[title]').forEach(e => ['placeholder', 'title'].forEach(a => e.hasAttribute(a) && add(e.getAttribute(a))));
      }
      add(app.doc.getElementById('sub').textContent); add(app.doc.querySelector('header h1').textContent); add(app.doc.title);
      app.alerts.splice(0).forEach(m => m.split('\n').forEach(add));
      app.confirms.splice(0).forEach(m => m.split('\n').forEach(add));
    },
  };
}

const tick = (app, n) => { for (let i = 0; i < n; i++) { const c = app.qsa('[data-c="att"]').find(x => !x.checked); if (c) app.change(c, true); } };
const untick = (app, n) => { for (let i = 0; i < n; i++) { const c = app.qsa('[data-c="att"]').find(x => x.checked); if (c) app.change(c, false); } };
const tryRun = (app, code) => { try { app.run(code); } catch (e) { /* alerts are captured */ } };

async function crawlLocal(lang, names = HEBREW_NAMES) {
  const app = await loadApp({ storage: lang ? { 'mf.lang': lang } : {} });
  const C = collector(app), snap = (label) => { C.at(label); C.snap(); };
  let now = T0; app.w.Date.now = () => now;
  const buzz = []; Object.defineProperty(app.w.navigator, 'vibrate', { value: p => { buzz.push(p); return true; }, configurable: true });
  try {
    // ---- empty state
    for (const t of ['night', 'stats', 'players', 'data', 'settings']) { app.tab(t); snap('empty ' + t); }
    app.tab('stats'); for (const v of ['awards', 'h2h', 'nights', 'players']) { app.act('view', { k: v }); snap('empty stats ' + v); }
    // ---- players
    app.tab('players'); app.set('bulk', names.join('\n')); app.act('bulkAdd'); snap('players list');
    app.set('newName', names[0] + '2'); app.act('addPlayer');
    app.act('toggleActive', { p: app.ev('S.players[S.players.length - 1].id') }); snap('retired player');
    app.act('toggleActive', { p: app.ev('S.players[S.players.length - 1].id') });
    app.change('[data-c="preg"]', true);
    const id21 = app.ev('S.players[S.players.length - 1].id'); app.act('deletePlayer', { p: id21 }); snap('delete confirm');
    names.slice(0, 14).forEach((n, i) => { app.run(`S.players[${i}].regular = true`); });
    // ---- setup screens
    app.tab('night'); snap('night empty'); app.act('startDraft'); snap('setup empty');
    app.act('tickRegulars'); snap('setup regulars ticked');
    tick(app, 14 - 14 + 0); tick(app, 1); snap('setup 15?');   // may be 14 or 15 depending on regulars
    untick(app, 100); tick(app, 14); snap('setup 14 (short)');
    tick(app, 2); snap('setup 16 (extra)'); untick(app, 1);
    app.act('autoBalance'); snap('setup balanced');
    const mover = app.qsa('[data-a="assign"][data-i="0"]').find(b => !b.style.background); if (mover) mover.click(); snap('setup uneven');
    tryRun(app, 'A.beginNight()'); snap('uneven alert');
    app.act('autoBalance');
    app.set('quick', names[1] + 'x'); app.act('quickAdd'); snap('quick add');
    app.act('cancelDraft'); app.run('S.players.pop(); save()');
    // ---- start a real night
    app.act('startDraft'); tick(app, 15); app.act('autoBalance'); app.act('beginNight'); snap('night overview');
    app.act('editTeams'); snap('edit teams'); app.act('cancelDraft');
    // ---- game 1: timer states, goals, sheets
    app.act('newMatch'); snap('match idle');
    const teams = app.ev('activeNight().teams.map(t => ({ id: t.id, p: t.playerIds }))');
    const goal = (team, scorer, assist) => { if (!app.has('[data-a="goal"]')) throw new Error('not on match screen: ' + app.text().slice(0, 300)); app.click(`[data-a="goal"][data-team="${team}"]${scorer ? `[data-p="${scorer}"]` : '[data-p=""]'}`); snap('assist sheet'); app.click(`[data-a="assist"][data-p="${assist || ''}"]`); snap('toast after goal'); };
    app.act('timerToggle'); snap('timer running'); now = T0 + 90_000; await app.wait(300);
    goal(teams[0].id, teams[0].p[0], teams[0].p[1]);
    goal(teams[1].id, null, null);
    app.act('timerToggle'); snap('timer paused'); app.act('timerToggle');
    app.qsa('[data-a="editGoalTime"]')[0].click(); snap('goal time sheet'); app.act('clearGoalTime');
    app.act('undoGoal'); snap('after undo');
    goal(teams[1].id, teams[1].p[0], null);
    now = T0 + 8 * 60_000 + 200; await app.wait(300); snap('full time level');
    app.act('timerExtra'); snap('extra time'); now += 130_000; await app.wait(300); snap('full time after extra');
    app.act('timerReset'); snap('timer reset');
    app.act('saveMatch'); snap('night after game 1 (suggestion)');
    // ---- game 2 (a winner) and a draw suggestion
    app.act('newMatch'); goal(app.ev('activeNight().matches[1].a'), app.ev('(() => { const n = activeNight(), m = n.matches[1]; return teamOf(n, m.a).playerIds[0]; })()'), null); app.act('saveMatch'); snap('night after winner');
    app.act('newMatch'); app.act('delMatch'); snap('delete game confirm');
    // ---- finish night
    app.act('finishNight'); snap('finish sheet'); app.act('closeSheet');
    // ---- stats views
    app.tab('stats');
    for (const v of ['players', 'awards', 'h2h', 'nights']) { app.act('view', { k: v }); snap('stats ' + v); for (const r of ['30d', '10n', 'all']) { if (v !== 'nights') { app.act('range', { k: r }); snap(`stats ${v} ${r}`); } } }
    app.act('view', { k: 'h2h' }); app.change('[data-c="h2hb"]', app.ev('S.players[1].id')); snap('h2h pair'); app.change('[data-c="h2hb"]', '');
    app.act('view', { k: 'players' }); app.click('tr.clk'); snap('player sheet'); app.act('closeSheet');
    app.act('sort', { k: 'name' }); snap('sorted asc'); app.act('sort', { k: 'name' }); snap('sorted desc');
    app.act('view', { k: 'nights' }); snap('nights list'); app.act('reopen'); snap('reopen'); tryRun(app, "A.reopen({ id: 'zzz' })"); snap('reopen refused');
    app.act('finishNight'); app.act('closeSheet');
    // ---- subs flow
    app.run("S.settings = { ...cfg(), allowSubs: true }; render()");
    app.tab('night'); app.act('startDraft'); tick(app, 17); snap('subs setup 17'); untick(app, 4); snap('subs setup short'); tick(app, 4); app.act('autoBalance'); snap('subs balanced');
    app.act('beginNight'); snap('subs night (bench)');
    app.act('newMatch'); app.click(`[data-a="subStart"]`); snap('sub out sheet'); app.click('[data-a="subOut"]'); snap('sub in sheet'); app.click('[data-a="subIn"]'); snap('after substitution');
    app.act('saveMatch'); app.act('discardNight'); snap('discard confirm');
    // ---- settings + data screens
    app.run("S.settings = undefined"); app.tab('settings'); snap('settings');
    app.change('[data-k="teams"]', '2'); snap('settings 2 teams'); app.act('resetSettings'); app.act('demo'); snap('demo confirm'); app.tab('settings'); app.act('wipe'); snap('wipe confirm');
    app.tab('data'); snap('data');
    // ---- install banner (iPhone, not installed)
    Object.defineProperty(app.w.navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', configurable: true });
    app.run("render()"); app.tab('night'); snap('iphone install hint');
    // ---- language switch UI
    app.tab('settings'); snap('language card');
  } finally { await app.dispose(); }
  return C.seen;
}

async function crawlCloud(lang, names = HEBREW_NAMES) {
  const mock = makeMockServer();
  const app = await loadApp({ mock, storage: lang ? { 'mf.lang': lang } : {} });
  await app.wait(60);
  const C = collector(app), snap = label => { C.at(label); C.snap(); };
  try {
    snap('login screen');
    app.set('grp', 'sunday'); app.set('code', 'bad'); app.act('login'); await app.wait(120); snap('login wrong');
    mock.locked = true; app.set('grp', 'sunday'); app.set('code', 'aa11'); app.act('login'); await app.wait(120); snap('login locked'); mock.locked = false;
    app.act('showCreate'); snap('create screen');
    const fill = (n, a, a2, v, c) => { app.set('gname', n); app.set('gadmin', a); app.set('gadmin2', a2); app.set('gview', v); app.set('gcreate', c); app.act('createGroup'); };
    fill('X', 'pass1', 'pass1', 'view1', 'cc11'); await app.wait(50); snap('create short name');
    fill('Team', 'abc', 'abc', 'view1', 'cc11'); await app.wait(50); snap('create short pw');
    fill('Team', 'pass1', 'pass2', 'view1', 'cc11'); await app.wait(50); snap('create mismatch');
    fill('Team', 'same1', 'same1', 'same1', 'cc11'); await app.wait(50); snap('create same');
    fill('Team', 'pass1', 'pass1', 'view1', 'wrong'); await app.wait(120); snap('create wrong code');
    fill('Sunday', 'pass1', 'pass1', 'view1', 'cc11'); await app.wait(120); snap('create taken');
    mock.down = true; fill('Team', 'pass1', 'pass1', 'view1', 'cc11'); await app.wait(120); snap('create offline'); mock.down = false;
    app.act('showLogin');
    mock.down = true; app.set('grp', 'sunday'); app.set('code', 'aa11'); app.act('login'); await app.wait(120); snap('login offline'); mock.down = false;
    // admin
    app.set('grp', 'sunday'); app.set('code', 'aa11'); app.act('login'); await app.wait(150); snap('admin in');
    seedWorld(app, { players: names.slice(0, 15).map((n, i) => ({ name: n, regular: i < 10 })) }); app.run('save()'); await app.wait(800); snap('saved');
    mock.down = true; app.tab('players'); app.set('newName', 'x'); app.act('addPlayer'); await app.wait(700); snap('not saved'); mock.down = false; await app.run('sync()'); await app.wait(100);
    app.tab('night'); app.act('startDraft'); tick(app, 15); app.act('autoBalance'); app.act('beginNight'); app.act('newMatch'); app.act('closeMatch'); app.act('finishNight'); app.act('closeSheet'); await app.wait(200);
    app.tab('settings'); await app.wait(300); snap('settings with backups'); app.act('backupNowBtn'); await app.wait(300); snap('backups list');
    app.set('newadmin', ''); app.set('newview', ''); app.act('changeCodes'); snap('change codes empty');
    app.set('newadmin', 'abc'); app.act('changeCodes'); snap('change codes short');
    app.set('newadmin', 'vv11'); app.act('changeCodes'); await app.wait(100); snap('change codes same');
    app.set('newadmin', 'newadmin1'); app.set('newview', 'newview1'); app.act('changeCodes'); await app.wait(100); snap('change codes ok');
    app.set('newgname', names[0]); app.act('renameGroup'); await app.wait(100); snap('rename ok');
    mock.groups.thursday = { name: 'Thursday', data: { players: [], nights: [] }, version: 0, view: 't1', admin: 't2', pub: false, backups: [] };
    app.set('newgname', 'Thursday'); app.act('renameGroup'); await app.wait(100); snap('rename taken'); app.set('newgname', 'x'); app.act('renameGroup'); await app.wait(50); snap('rename short');
    app.run('A.restoreBackup({ id: 1 })'); await app.wait(150); snap('restore confirm');
    app.tab('settings'); app.act('logout'); snap('logout confirm');
    // viewer with a live night
    const { worldJson } = require('./helpers');
    const live = { players: names.slice(0, 4), nights: [{ date: '2026-01-05', finished: false, teams: { Red: [names[0], names[1]], Blue: [names[2], names[3]] }, games: [{ a: 'Red', b: 'Blue', goals: [['Red', names[0], names[1], 7], ['Blue', null]] }] }] };
    const key = Object.keys(mock.groups).find(k => k !== 'thursday'); mock.groups[key].data = worldJson(live); mock.groups[key].version = 50;
    app.set('grp', key); app.set('code', 'newview1'); app.act('login'); await app.wait(200); snap('viewer tonight');
    app.tab('stats'); snap('viewer stats'); app.tab('data'); snap('viewer account');
    mock.down = true; await app.run('pull()'); snap('viewer offline');
  } finally { await app.dispose(); }
  return C.seen;
}

module.exports = { crawlLocal, crawlCloud, HEBREW_NAMES };
