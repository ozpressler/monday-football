'use strict';
// QA: sign-in, groups, shared data, roles, backups, offline (against a fake database server)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, makeMockServer, seedWorld, names } = require('./helpers');

async function open(opts = {}) {
  const mock = opts.mock || makeMockServer();
  const app = await loadApp({ mock, storage: opts.storage });
  await app.wait(60);
  return { app, mock };
}
async function login(app, group, code) {
  app.set('grp', group); app.set('code', code); app.act('login'); await app.wait(120);
}
async function asAdmin() {
  const { app, mock } = await open();
  await login(app, 'sunday', 'aa11');
  return { app, mock };
}
const g = (mock, k = 'sunday') => mock.groups[k];
const loginScreen = app => /Sign in/.test(app.text()) && app.has('#grp');

/* ---- startup ---- */
test('no database configured: the app runs in local mode with no sign-in screen', async () => {
  const app = await loadApp();
  try { assert.ok(!app.has('#grp')); assert.equal(app.nav().length, 5); } finally { await app.dispose(); }
});

test('with a database configured, the sign-in screen shows first and no data or tabs are visible', async () => {
  const { app } = await open();
  try {
    assert.ok(loginScreen(app));
    assert.deepEqual(app.nav(), []);
    assert.ok(app.has('#grp') && app.has('#code'));
    assert.equal(app.qs('#code').type, 'password');
  } finally { await app.dispose(); }
});

/* ---- sign in ---- */
test('wrong password and unknown group both give the same message (no hints)', async () => {
  const { app } = await open();
  try {
    await login(app, 'sunday', 'nope'); const m1 = app.text();
    assert.match(m1, /Group name or password is not right/);
    await login(app, 'no-such-group', 'aa11'); const m2 = app.text();
    assert.match(m2, /Group name or password is not right/);
    assert.ok(loginScreen(app));
    assert.equal(app.ev('S.players.length'), 0);
  } finally { await app.dispose(); }
});

test('admin sign-in: all five tabs, group name in the header, group name is not case sensitive', async () => {
  const { app } = await open();
  try {
    await login(app, '  SUNDAY ', 'aa11');
    assert.deepEqual(app.nav(), ['⚽ Night', '📊 Stats', '👥 Players', '💾 Data', '⚙️ Settings']);
    assert.match(app.doc.getElementById('sub').textContent, /Sunday Crew · Saved ✓/);
    assert.equal(app.ev('cloud.admin'), true);
  } finally { await app.dispose(); }
});

test('viewer sign-in is read-only: no edit tabs and admin actions are ignored', async () => {
  const { app, mock } = await open();
  try {
    g(mock).data = { players: [{ id: 'A', name: 'Ann', seed: 5, adj: 0 }], nights: [] }; g(mock).version = 3;
    await login(app, 'sunday', 'vv11');
    assert.deepEqual(app.nav(), ['⚽ Tonight', '📊 Stats', '👤 Account']);
    assert.match(app.doc.getElementById('sub').textContent, /Viewing/);
    assert.equal(app.ev('S.players.length'), 1, 'sees the group data');
    // even if an admin button is forced into the page, clicking it does nothing
    app.run(`document.body.insertAdjacentHTML('beforeend', '<button id="evil" data-a="deletePlayer" data-p="A">x</button><button id="evil2" data-a="startDraft">y</button>')`);
    app.click('#evil'); app.click('#evil2');
    assert.equal(app.ev('S.players.length'), 1);
    assert.equal(app.ev('ui.draft'), null);
    assert.equal(app.confirms.length, 0);
    app.tab('data'); assert.ok(!app.has('#newgname'), 'no rename box for viewers');
    assert.ok(!app.has('[data-a="changeCodes"]'));
  } finally { await app.dispose(); }
});

test('viewers see tonight live (teams, scores, goals with minutes) and no buttons', async () => {
  const { app, mock } = await open();
  try {
    const world = { players: ['A', 'B', 'C', 'D'], nights: [{ date: '2026-01-05', finished: false, teams: { Red: ['A', 'B'], Blue: ['C', 'D'] }, games: [{ a: 'Red', b: 'Blue', goals: [['Red', 'A', 'B', 7]] }] }] };
    const { worldJson } = require('./helpers');
    g(mock).data = worldJson(world); g(mock).version = 2;
    await login(app, 'sunday', 'vv11');
    const t = app.text();
    assert.match(t, /Tonight · 2026-01-05/);
    assert.match(t, /Red 1 – 0 Blue/);
    assert.match(t, /7' A \(assist B\)/);
    assert.ok(!app.has('[data-a="newMatch"]') && !app.has('[data-a="finishNight"]') && !app.has('[data-a="goal"]'));
  } finally { await app.dispose(); }
});

test('viewers pick up new data from the admin automatically', async () => {
  const { app, mock } = await open();
  try {
    await login(app, 'sunday', 'vv11');
    assert.equal(app.ev('S.players.length'), 0);
    g(mock).data = { players: [{ id: 'N', name: 'Newbie', seed: 5, adj: 0 }], nights: [] }; g(mock).version = 9;
    await app.run('pull()'); await app.wait(50);
    assert.equal(app.ev('S.players[0].name'), 'Newbie');
  } finally { await app.dispose(); }
});

test('saved sign-in is reused on the next visit', async () => {
  const { app, mock } = await open({ storage: { 'mf.group': 'sunday', 'mf.code': 'aa11' } });
  try {
    await app.wait(150);
    assert.equal(app.ev('cloud.authed'), true);
    assert.equal(app.ev('cloud.admin'), true);
    assert.ok(!loginScreen(app));
  } finally { await app.dispose(); }
});

test('sign out clears the device (data and saved sign-in) and returns to the sign-in screen', async () => {
  const { app } = await asAdmin();
  try {
    app.run("S.players.push({ id: 'X', name: 'X', seed: 5, adj: 0 }); localSave();");
    app.tab('settings'); app.act('logout');
    assert.ok(loginScreen(app));
    assert.equal(app.w.localStorage.getItem('mf.code'), null);
    assert.equal(app.w.localStorage.getItem('mondayfootball.v1'), null);
    assert.equal(app.ev('S.players.length'), 0);
  } finally { await app.dispose(); }
});

test('too many wrong attempts shows a lock-out message, and a locked viewer poll does not sign them out', async () => {
  const { app, mock } = await open();
  try {
    mock.locked = true;
    await login(app, 'sunday', 'aa11');
    assert.match(app.text(), /Too many wrong attempts/);
    assert.ok(loginScreen(app));
    mock.locked = false; await login(app, 'sunday', 'vv11');
    assert.equal(app.ev('cloud.authed'), true);
    mock.locked = true; await app.run('pull()'); await app.wait(50);
    assert.equal(app.ev('cloud.authed'), true, 'a viewer who is already in stays in during a lock');
  } finally { await app.dispose(); }
});

/* ---- saving / syncing ---- */
test('admin changes are saved to the database automatically and the version goes up', async () => {
  const { app, mock } = await asAdmin();
  try {
    app.tab('players'); app.set('newName', 'Zoe'); app.act('addPlayer');
    await app.wait(800);
    assert.deepEqual(g(mock).data.players.map(p => p.name), ['Zoe']);
    assert.equal(g(mock).version, 1);
    assert.match(app.doc.getElementById('sub').textContent, /Saved ✓/);
    app.set('newName', 'Yan'); app.act('addPlayer'); await app.wait(800);
    assert.equal(g(mock).version, 2);
    assert.equal(g(mock).data.players.length, 2);
  } finally { await app.dispose(); }
});

test('rapid edits are batched into few saves', async () => {
  const { app, mock } = await asAdmin();
  try {
    app.tab('players');
    for (const n of ['A1', 'A2', 'A3', 'A4', 'A5']) { app.set('newName', n); app.act('addPlayer'); }
    await app.wait(900);
    assert.equal(g(mock).data.players.length, 5);
    assert.ok(mock.log.filter(x => x === 'save_state').length <= 2, 'saves: ' + mock.log.filter(x => x === 'save_state').length);
  } finally { await app.dispose(); }
});

test('conflict: if another device saved first, the newer data is loaded and the admin is told', async () => {
  const { app, mock } = await asAdmin();
  try {
    g(mock).data = { players: [{ id: 'O', name: 'OtherDevice', seed: 5, adj: 0 }], nights: [] }; g(mock).version = 5;
    app.tab('players'); app.set('newName', 'Mine'); app.act('addPlayer');
    await app.wait(900);
    assert.deepEqual(app.ev('S.players.map(p => p.name)'), ['OtherDevice']);
    assert.match(app.alerts.at(-1), /Another device saved newer data/);
    assert.equal(g(mock).data.players.length, 1, 'the newer server data was not overwritten');
  } finally { await app.dispose(); }
});

test('two groups never see each other\'s data and passwords do not cross over', async () => {
  const { app, mock } = await open();
  try {
    mock.groups.thursday = { name: 'Thursday', data: { players: [{ id: 'T', name: 'ThursdayGuy', seed: 5, adj: 0 }], nights: [] }, version: 1, view: 'tv11', admin: 'ta11', pub: false, backups: [] };
    await login(app, 'sunday', 'aa11'); assert.equal(app.ev('S.players.length'), 0);
    app.tab('settings'); app.act('logout');
    await login(app, 'thursday', 'aa11'); assert.ok(loginScreen(app), "Sunday's password must not open Thursday");
    await login(app, 'thursday', 'tv11'); assert.equal(app.ev('S.players[0].name'), 'ThursdayGuy');
    assert.equal(app.ev('cloud.admin'), false);
  } finally { await app.dispose(); }
});

/* ---- creating groups ---- */
test('create a group: validation messages', async () => {
  const { app } = await open();
  try {
    app.act('showCreate');
    const fill = (n, a, a2, v, c) => { app.set('gname', n); app.set('gadmin', a); app.set('gadmin2', a2); app.set('gview', v); app.set('gcreate', c); app.act('createGroup'); };
    fill('X', 'pass1', 'pass1', 'view1', 'cc11'); await app.wait(50); assert.match(app.text(), /at least 2 characters/);
    fill('Team', 'abc', 'abc', 'view1', 'cc11'); await app.wait(50); assert.match(app.text(), /at least 4 characters/);
    fill('Team', 'pass1', 'pass2', 'view1', 'cc11'); await app.wait(50); assert.match(app.text(), /do not match/);
    fill('Team', 'same1', 'same1', 'same1', 'cc11'); await app.wait(50); assert.match(app.text(), /must be different/);
    fill('Team', 'pass1', 'pass1', 'view1', 'wrong'); await app.wait(120); assert.match(app.text(), /Wrong creation code/);
    fill('Sunday', 'pass1', 'pass1', 'view1', 'cc11'); await app.wait(120); assert.match(app.text(), /already taken/);
    assert.equal(app.ev('cloud.authed'), false);
  } finally { await app.dispose(); }
});

test('create a group: success signs you in as admin of an empty group', async () => {
  const { app, mock } = await open();
  try {
    app.act('showCreate');
    app.set('gname', 'Thursday Crew'); app.set('gadmin', 'pass1'); app.set('gadmin2', 'pass1'); app.set('gview', 'view1'); app.set('gcreate', 'cc11');
    app.act('createGroup'); await app.wait(250);
    assert.equal(app.ev('cloud.authed'), true); assert.equal(app.ev('cloud.admin'), true);
    assert.match(app.doc.getElementById('sub').textContent, /Thursday Crew/);
    assert.equal(app.ev('S.players.length'), 0);
    assert.ok(mock.groups['thursday crew']);
  } finally { await app.dispose(); }
});

/* ---- group management ---- */
test('rename the group: new name works, old name stops working, name clashes are refused', async () => {
  const { app, mock } = await asAdmin();
  try {
    mock.groups.thursday = { name: 'Thursday', data: { players: [], nights: [] }, version: 0, view: 't1', admin: 't2', pub: false, backups: [] };
    app.tab('settings');
    app.set('newgname', 'Thursday'); app.act('renameGroup'); await app.wait(120);
    assert.match(app.alerts.at(-1), /already taken/);
    app.set('newgname', 'x'); app.act('renameGroup'); await app.wait(50);
    assert.match(app.alerts.at(-1), /2 to 40 characters/);
    app.set('newgname', 'Monday Crew'); app.act('renameGroup'); await app.wait(150);
    assert.match(app.doc.getElementById('sub').textContent, /Monday Crew/);
    assert.ok(mock.groups['monday crew'] && !mock.groups.sunday);
    app.tab('players'); app.set('newName', 'After'); app.act('addPlayer'); await app.wait(800);
    assert.equal(g(mock, 'monday crew').data.players.length, 1, 'still saves after the rename');
    app.tab('settings'); app.act('logout');
    await login(app, 'sunday', 'aa11'); assert.ok(loginScreen(app));
    await login(app, 'MONDAY CREW', 'aa11'); assert.equal(app.ev('cloud.admin'), true);
  } finally { await app.dispose(); }
});

test('change passwords: admin password change keeps the session working; viewer password change blocks the old one', async () => {
  const { app, mock } = await asAdmin();
  try {
    app.tab('settings');
    app.set('newadmin', 'newadmin1'); app.set('newview', 'newview1'); app.act('changeCodes'); await app.wait(150);
    assert.match(app.alerts.at(-1), /Passwords changed/);
    assert.equal(g(mock).admin, 'newadmin1'); assert.equal(g(mock).view, 'newview1');
    assert.equal(app.w.localStorage.getItem('mf.code'), 'newadmin1');
    app.tab('players'); app.set('newName', 'Still'); app.act('addPlayer'); await app.wait(800);
    assert.equal(g(mock).data.players.length, 1, 'saving continues with the new admin password');
    app.tab('settings'); app.set('newadmin', 'newview1'); app.set('newview', ''); app.act('changeCodes'); await app.wait(150);
    assert.match(app.alerts.at(-1), /must be different/);
    app.set('newadmin', 'abc'); app.set('newview', ''); app.act('changeCodes');
    assert.match(app.alerts.at(-1), /at least 4 characters/);
    app.act('logout'); await login(app, 'sunday', 'vv11'); assert.ok(loginScreen(app), 'old viewer password no longer works');
  } finally { await app.dispose(); }
});

/* ---- backups ---- */
test('backups: saved after finishing a night and before deleting a player; listed in Settings', async () => {
  const { app, mock } = await asAdmin();
  try {
    seedWorld(app, { players: names(15) });
    app.tab('night'); app.act('startDraft');
    for (let i = 0; i < 15; i++) app.change(app.qsa('[data-c="att"]').find(c => !c.checked), true);
    app.act('autoBalance'); app.act('beginNight'); app.act('newMatch'); app.act('closeMatch');
    app.act('finishNight'); app.act('closeSheet'); await app.wait(150);
    app.tab('players'); app.act('deletePlayer', { p: 'P15' }); await app.wait(150);
    const labels = g(mock).backups.map(b => b.label);
    assert.ok(labels.some(l => /^After night /.test(l)), labels.join('|'));
    assert.ok(labels.includes('Before deleting P15'));
    app.tab('settings'); await app.wait(150);
    assert.match(app.text(), /Automatic backups/);
    assert.ok(app.qsa('[data-a="restoreBackup"]').length >= 2);
    assert.match(app.text(), /Before deleting P15/);
  } finally { await app.dispose(); }
});

test('restore a backup: data comes back, it syncs to the database, and the current data is backed up first', async () => {
  const { app, mock } = await asAdmin();
  try {
    seedWorld(app, { players: names(5) }); app.run('save()'); await app.wait(800);
    app.tab('settings'); app.act('wipe'); await app.wait(900);          // let the delete reach the database first
    assert.equal(app.ev('S.players.length'), 0);
    assert.equal(g(mock).data.players.length, 0, 'the database is empty before the restore');
    await app.run('loadBackups()'); await app.wait(60);
    const btn = app.qsa('[data-a="restoreBackup"]').find(b => /Before deleting all data/.test(b.parentElement.textContent));
    assert.ok(btn, 'wipe created a backup');
    btn.click(); await app.wait(900);
    assert.equal(app.ev('S.players.length'), 5);
    assert.equal(g(mock).data.players.length, 5, 'restored data reached the database');
    assert.ok(g(mock).backups.some(b => b.label === 'Before restoring a backup'));
  } finally { await app.dispose(); }
});

test('"Back up now" adds a manual backup', async () => {
  const { app, mock } = await asAdmin();
  try { app.tab('settings'); app.act('backupNowBtn'); await app.wait(100); assert.ok(g(mock).backups.some(b => b.label === 'Manual backup')); }
  finally { await app.dispose(); }
});

test('viewers never trigger backups', async () => {
  const { app, mock } = await open();
  try { await login(app, 'sunday', 'vv11'); app.run("backupNow('x')"); await app.wait(50); assert.equal(mock.log.filter(x => x === 'save_backup').length, 0); }
  finally { await app.dispose(); }
});

/* ---- connection problems ---- */
test('losing the connection: status shows "not saved", and the change is saved when it returns', async () => {
  const { app, mock } = await asAdmin();
  try {
    mock.down = true;
    app.tab('players'); app.set('newName', 'Offline1'); app.act('addPlayer'); await app.wait(800);
    assert.match(app.doc.getElementById('sub').textContent, /Not saved/);
    assert.equal(app.w.localStorage.getItem('mf.dirty'), '1');
    assert.equal(g(mock).data.players.length, 0);
    mock.down = false; await app.run('sync()'); await app.wait(100);
    assert.equal(g(mock).data.players.length, 1);
    assert.match(app.doc.getElementById('sub').textContent, /Saved ✓/);
    assert.equal(app.w.localStorage.getItem('mf.dirty'), null);
  } finally { await app.dispose(); }
});

test('opening the app with no connection: admin gets the saved copy, keeps working, and syncs later', async () => {
  const mock = makeMockServer(); mock.down = true;
  const cached = { players: [{ id: 'C', name: 'Cached', seed: 5, adj: 0 }], nights: [] };
  const { app } = await open({ mock, storage: {
    'mf.group': 'sunday', 'mf.code': 'aa11', 'mf.admin': '1', 'mf.name': 'Sunday Crew', 'mf.version': '4', 'mondayfootball.v1': JSON.stringify(cached),
  } });
  try {
    await app.wait(250);
    assert.equal(app.ev('cloud.authed'), true); assert.equal(app.ev('cloud.admin'), true);
    assert.match(app.doc.getElementById('sub').textContent, /Offline/);
    assert.equal(app.ev('S.players[0].name'), 'Cached');
    assert.equal(app.nav().length, 5);
    app.tab('players'); app.set('newName', 'EditedOffline'); app.act('addPlayer'); await app.wait(700);
    assert.equal(app.w.localStorage.getItem('mf.dirty'), '1');
    mock.down = false; g(mock).version = 4; await app.run('sync()'); await app.wait(150);
    assert.ok(g(mock).data.players.some(p => p.name === 'EditedOffline'), 'offline edit reached the database');
  } finally { await app.dispose(); }
});

test('opening with no connection as a viewer shows the saved copy read-only', async () => {
  const mock = makeMockServer(); mock.down = true;
  const { app } = await open({ mock, storage: {
    'mf.group': 'sunday', 'mf.code': 'vv11', 'mf.name': 'Sunday Crew', 'mf.version': '2',
    'mondayfootball.v1': JSON.stringify({ players: [{ id: 'C', name: 'Cached', seed: 5, adj: 0 }], nights: [] }),
  } });
  try {
    await app.wait(250);
    assert.equal(app.ev('RO()'), true);
    assert.equal(app.ev('S.players[0].name'), 'Cached');
    assert.deepEqual(app.nav(), ['⚽ Tonight', '📊 Stats', '👤 Account']);
  } finally { await app.dispose(); }
});

test('first-time visit with no connection shows a clear message and no data', async () => {
  const mock = makeMockServer(); mock.down = true;
  const { app } = await open({ mock });
  try {
    await login(app, 'sunday', 'aa11');
    assert.match(app.text(), /Can't reach the server/);
    assert.ok(loginScreen(app));
  } finally { await app.dispose(); }
});
