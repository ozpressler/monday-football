'use strict';
// QA: Settings page and the game timer (with a controllable clock)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, seedWorld, names } = require('./helpers');

const T0 = 1_800_000_000_000;
function clock(app) {
  let now = T0;
  app.w.Date.now = () => now;
  return { set: ms => { now = T0 + ms; }, at: () => now - T0 };
}
async function inGame(settings) {
  const app = await loadApp();
  seedWorld(app, { players: names(15), settings });
  const buzz = []; Object.defineProperty(app.w.navigator, 'vibrate', { value: p => { buzz.push(p); return true; }, configurable: true });
  app.tab('night'); app.act('startDraft');
  for (let i = 0; i < 15; i++) app.change(app.qsa('[data-c="att"]').find(c => !c.checked), true);
  app.act('autoBalance'); app.act('beginNight'); app.act('newMatch');
  const teams = app.ev('activeNight().teams.map(t => ({ id: t.id, players: t.playerIds }))');
  const t = clock(app);
  return { app, t, teams, buzz };
}
const clockText = app => app.qs('#clock').textContent;
const goal = (app, team, scorer) => { app.click(`[data-a="goal"][data-team="${team}"][data-p="${scorer}"]`); app.click('[data-a="assist"][data-p=""]'); };
const tickWait = app => app.wait(380);

/* ---- settings page ---- */
test('defaults: 8 min games, 2 min extra time, 3 teams of 5, subs off', async () => {
  const app = await loadApp();
  try {
    assert.deepEqual(app.ev('cfg()'), { matchMins: 8, extraMins: 2, extraTied: true, sound: true, teams: 3, perSide: 5, allowSubs: false });
    app.tab('settings');
    assert.match(app.text(), /Format: 5 vs 5 vs 5/);
  } finally { await app.dispose(); }
});

test('number settings are saved, rounded and clamped to sensible limits', async () => {
  const app = await loadApp();
  try {
    app.tab('settings');
    const set = (k, v) => app.change(`[data-k="${k}"]`, v);
    set('matchMins', '12'); assert.equal(app.ev('cfg().matchMins'), 12);
    set('matchMins', '0'); assert.equal(app.ev('cfg().matchMins'), 1);
    set('matchMins', '999'); assert.equal(app.ev('cfg().matchMins'), 60);
    set('extraMins', '0'); assert.equal(app.ev('cfg().extraMins'), 0);
    set('teams', '9'); assert.equal(app.ev('cfg().teams'), 4);
    set('teams', '1'); assert.equal(app.ev('cfg().teams'), 2);
    set('perSide', '1'); assert.equal(app.ev('cfg().perSide'), 2);
    set('perSide', '7.6'); assert.equal(app.ev('cfg().perSide'), 8);
    set('matchMins', 'abc'); assert.equal(app.ev('cfg().matchMins'), 8, 'garbage falls back to the default');
  } finally { await app.dispose(); }
});

test('toggles: offer-extra-time, sound, substitutes', async () => {
  const app = await loadApp();
  try {
    app.tab('settings');
    for (const k of ['extraTied', 'sound', 'allowSubs']) {
      const before = app.ev(`cfg().${k}`);
      app.change(`[data-k="${k}"]`, !before);
      assert.equal(app.ev(`cfg().${k}`), !before, k);
    }
  } finally { await app.dispose(); }
});

test('format line follows teams and players per team', async () => {
  const app = await loadApp();
  try {
    app.tab('settings'); app.change('[data-k="teams"]', '2'); app.change('[data-k="perSide"]', '7');
    assert.match(app.text(), /Format: 7 vs 7/);
  } finally { await app.dispose(); }
});

test('settings are persisted on the device and "Reset" restores the defaults', async () => {
  const app = await loadApp();
  try {
    app.tab('settings'); app.change('[data-k="matchMins"]', '15');
    const stored = JSON.parse(app.w.localStorage.getItem('mondayfootball.v1'));
    assert.equal(stored.settings.matchMins, 15);
    app.act('resetSettings');
    assert.equal(app.ev('cfg().matchMins'), 8);
    assert.equal(JSON.parse(app.w.localStorage.getItem('mondayfootball.v1')).settings, undefined);
  } finally { await app.dispose(); }
});

test('settings are kept when loading demo data or deleting all data', async () => {
  const app = await loadApp();
  try {
    app.tab('settings'); app.change('[data-k="matchMins"]', '11');
    app.act('demo'); assert.equal(app.ev('cfg().matchMins'), 11); assert.ok(app.ev('S.players.length') >= 15);
    app.tab('settings'); app.act('wipe'); assert.equal(app.ev('cfg().matchMins'), 11); assert.equal(app.ev('S.players.length'), 0);
  } finally { await app.dispose(); }
});

test('the default number of teams for a night comes from Settings', async () => {
  const app = await loadApp();
  try {
    seedWorld(app, { players: names(8), settings: { teams: 2, perSide: 4 } });
    app.tab('night'); app.act('startDraft');
    assert.equal(app.ev('ui.draft.k'), 2);
  } finally { await app.dispose(); }
});

/* ---- timer ---- */
test('timer starts idle at the game length, counts down, pauses and resumes', async () => {
  const { app, t } = await inGame();
  try {
    assert.equal(clockText(app), '08:00');
    assert.match(app.qs('[data-a="timerToggle"]').textContent, /Start/);
    app.act('timerToggle');
    assert.match(app.qs('[data-a="timerToggle"]').textContent, /Pause/);
    t.set(5 * 60000); await tickWait(app);
    assert.equal(clockText(app), '03:00');
    app.act('timerToggle');                                    // pause
    t.set(7 * 60000); await tickWait(app);
    assert.equal(clockText(app), '03:00', 'paused clock does not move');
    assert.match(app.qs('[data-a="timerToggle"]').textContent, /Resume/);
    app.act('timerToggle');                                    // resume
    t.set(8 * 60000); await tickWait(app);
    assert.equal(clockText(app), '02:00');
  } finally { await app.dispose(); }
});

test('the match length from Settings is used by the timer', async () => {
  const { app } = await inGame({ matchMins: 10 });
  try { assert.equal(clockText(app), '10:00'); } finally { await app.dispose(); }
});

test('goal minute is recorded from the timer (and blank if the timer was never started)', async () => {
  const { app, t, teams } = await inGame();
  try {
    const [red] = teams;
    goal(app, red.id, red.players[0]);
    assert.equal(app.ev('activeNight().matches[0].goals[0].min'), null);
    app.act('timerToggle'); t.set(4 * 60000 + 30000); await tickWait(app);
    goal(app, red.id, red.players[1]);
    assert.equal(app.ev('activeNight().matches[0].goals[1].min'), 5, '4:30 elapsed is the 5th minute');
    t.set(60000 * 7 + 1000); await tickWait(app);
    goal(app, red.id, red.players[2]);
    assert.equal(app.ev('activeNight().matches[0].goals[2].min'), 8);
  } finally { await app.dispose(); }
});

test('goal minutes can be edited and cleared afterwards; the log re-sorts by time', async () => {
  const { app, t, teams } = await inGame();
  try {
    const [red] = teams;
    app.act('timerToggle'); t.set(60000); await tickWait(app); goal(app, red.id, red.players[0]);       // 1'
    t.set(5 * 60000); await tickWait(app); goal(app, red.id, red.players[1]);                          // 5'
    app.qsa('[data-a="editGoalTime"]')[0].click();                                                     // edit the 1' goal
    app.set('gmin', '7'); app.act('saveGoalTime');
    assert.deepEqual(app.qsa('[data-a="editGoalTime"]').map(b => b.textContent.trim()), ["5'", "7'"], 'sorted by minute');
    app.qsa('[data-a="editGoalTime"]')[0].click(); app.act('clearGoalTime');
    assert.ok(app.ev('activeNight().matches[0].goals.some(g => g.min === null)'));
    app.qsa('[data-a="editGoalTime"]')[0].click(); app.set('gmin', '9999'); app.act('saveGoalTime');
    assert.ok(app.ev('activeNight().matches[0].goals.every(g => g.min === null || g.min <= 120)'), 'minute is capped');
  } finally { await app.dispose(); }
});

test('full time: clock stops, buzzer fires, and extra time is offered only when level', async () => {
  const { app, t, teams, buzz } = await inGame();
  try {
    app.act('timerToggle'); t.set(8 * 60000 + 100); await tickWait(app);
    assert.equal(app.ev('ui.timer.done'), true);
    assert.equal(clockText(app), '00:00');
    assert.match(app.text(), /Full time/);
    assert.equal(buzz.length, 1, 'vibrates once');
    assert.ok(app.has('[data-a="timerExtra"]'), '0-0 is level, so extra time is offered');
  } finally { await app.dispose(); }
});

test('no extra time offered when one team is ahead', async () => {
  const { app, t, teams } = await inGame();
  try {
    goal(app, teams[0].id, teams[0].players[0]);
    app.act('timerToggle'); t.set(8 * 60000 + 100); await tickWait(app);
    assert.match(app.text(), /Full time/);
    assert.ok(!app.has('[data-a="timerExtra"]'));
  } finally { await app.dispose(); }
});

test('extra time: 2 minutes, labelled, goals get minutes beyond full time', async () => {
  const { app, t, teams } = await inGame();
  try {
    app.act('timerToggle'); t.set(8 * 60000 + 100); await tickWait(app);
    assert.match(app.qs('[data-a="timerExtra"]').textContent, /\+ 2 min extra time/);
    app.act('timerExtra');
    assert.equal(app.ev('ui.timer.phase'), 'extra');
    assert.match(app.text(), /Extra time/);
    t.set(8 * 60000 + 100 + 30000); await tickWait(app);
    assert.equal(clockText(app), '01:30');
    goal(app, teams[0].id, teams[0].players[0]);
    assert.equal(app.ev('activeNight().matches[0].goals[0].min'), 9);
    t.set(8 * 60000 + 100 + 2 * 60000 + 50); await tickWait(app);
    assert.match(app.text(), /Full time \(after extra time\)/);
    assert.ok(!app.has('[data-a="timerExtra"]'), 'only one period of extra time');
  } finally { await app.dispose(); }
});

test('extra time can be switched off in Settings (0 minutes, or "offer when tied" off)', async () => {
  for (const settings of [{ extraMins: 0 }, { extraTied: false }]) {
    const { app, t } = await inGame(settings);
    try {
      app.act('timerToggle'); t.set(8 * 60000 + 100); await tickWait(app);
      assert.match(app.text(), /Full time/);
      assert.ok(!app.has('[data-a="timerExtra"]'), JSON.stringify(settings));
    } finally { await app.dispose(); }
  }
});

test('sound & vibration can be turned off', async () => {
  const { app, t, buzz } = await inGame({ sound: false });
  try { app.act('timerToggle'); t.set(8 * 60000 + 100); await tickWait(app); assert.equal(app.ev('ui.timer.done'), true); assert.equal(buzz.length, 0); }
  finally { await app.dispose(); }
});

test('reset returns the clock to the full game length', async () => {
  const { app, t } = await inGame();
  try {
    app.act('timerToggle'); t.set(3 * 60000); await tickWait(app);
    app.act('timerReset');
    assert.equal(clockText(app), '08:00');
    assert.equal(app.ev('ui.timer.running'), false);
    assert.equal(app.ev('ui.timer.phase'), 'main');
  } finally { await app.dispose(); }
});

test('the timer state is stored on the device so a reload does not lose it', async () => {
  const { app, t } = await inGame();
  try {
    app.act('timerToggle'); t.set(60000);
    const stored = JSON.parse(app.w.localStorage.getItem('mf.timer'));
    assert.equal(stored.running, true);
    assert.equal(stored.endAt, T0 + 8 * 60000);
  } finally { await app.dispose(); }
});

test('saving the game stops a running clock', async () => {
  const { app, t } = await inGame();
  try { app.act('timerToggle'); t.set(60000); app.act('saveMatch'); assert.equal(app.ev('ui.timer.running'), false); assert.equal(app.ev('ui.timer.remaining'), 7 * 60000); }
  finally { await app.dispose(); }
});
