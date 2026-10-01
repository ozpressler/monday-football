'use strict';
// QA: setting up a night, logging games, finishing, substitutes
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, seedWorld, names } = require('./helpers');

/* ---- helpers ---- */
async function fresh(nPlayers, { regulars = 0, settings } = {}) {
  const app = await loadApp();
  seedWorld(app, { players: names(nPlayers).map((n, i) => ({ name: n, regular: i < regulars })), settings });
  return app;
}
const tick = (app, n) => { for (let i = 0; i < n; i++) { const c = app.qsa('[data-c="att"]').find(x => !x.checked); app.change(c, true); } };
const untick = (app, n) => { for (let i = 0; i < n; i++) { const c = app.qsa('[data-c="att"]').find(x => x.checked); app.change(c, false); } };
const disabled = (app, a) => app.qs(`[data-a="${a}"]`).disabled;
const startDraft = app => { app.tab('night'); app.act('startDraft'); };
async function beginNight(app, n = 15) { startDraft(app); tick(app, n); app.act('autoBalance'); app.act('beginNight'); }
const night = app => app.ev('activeNight()');
const teamsOf = app => app.ev('activeNight().teams.map(t => ({ id: t.id, name: t.name, players: t.playerIds }))');
const newGame = (app, a, b) => {
  if (a) app.change('#nmA', a); if (b) app.change('#nmB', b);
  app.act('newMatch');
};
function score(app, matchIdx = 0) { return app.ev(`(() => { const n = activeNight(), m = n.matches[${matchIdx}]; return score(m, m.a) + '-' + score(m, m.b); })()`); }
/** log a goal for the given team: first player of that team scores, optional assister name */
function goal(app, teamId, scorer, assist) {
  app.click(`[data-a="goal"][data-team="${teamId}"]${scorer ? `[data-p="${scorer}"]` : '[data-p=""]'}`);
  app.click(`[data-a="assist"][data-p="${assist || ''}"]`);
}
const suggestion = app => (app.text().match(/Suggested: (.+?) \((.+?)\)/) || []).slice(1);

/* ---- setup rules ---- */
test('14 players is not enough: Start and Auto-balance are blocked and the message says how many to add', async () => {
  const app = await fresh(20);
  try {
    startDraft(app); tick(app, 14);
    assert.ok(disabled(app, 'beginNight'));
    assert.ok(disabled(app, 'autoBalance'));
    assert.match(app.text(), /14 here\. You need exactly 15 \(3 teams of 5\): add 1 more/);
  } finally { await app.dispose(); }
});

test('16 players is too many: blocked, and the message says how many to untick', async () => {
  const app = await fresh(20);
  try {
    startDraft(app); tick(app, 16);
    assert.ok(disabled(app, 'beginNight'));
    assert.match(app.text(), /untick 1/);
    untick(app, 1);
    assert.ok(!disabled(app, 'autoBalance'));
  } finally { await app.dispose(); }
});

test('15 players: Auto-balance enables, Start stays blocked until every team has exactly 5', async () => {
  const app = await fresh(15);
  try {
    startDraft(app); tick(app, 15);
    assert.ok(!disabled(app, 'autoBalance'));
    assert.ok(disabled(app, 'beginNight'), 'no teams chosen yet');
    assert.match(app.text(), /Put exactly 5 players on each team/);
    app.act('autoBalance');
    assert.ok(!disabled(app, 'beginNight'));
    assert.match(app.text(), /15 here · 3 teams of 5 ✓/);
  } finally { await app.dispose(); }
});

test('moving one player by hand to make teams uneven blocks Start (button and direct action)', async () => {
  const app = await fresh(15);
  try {
    startDraft(app); tick(app, 15); app.act('autoBalance');
    // put one non-Red player on Red -> Red has 6, another has 4
    const mover = app.qsa('[data-a="assign"][data-i="0"]').find(b => !b.style.background);
    mover.click();
    assert.ok(disabled(app, 'beginNight'));
    app.run('A.beginNight(); render();');
    assert.match(app.alerts.at(-1), /Each team needs exactly 5/);
    assert.equal(night(app), null, 'no night should have been created');
  } finally { await app.dispose(); }
});

test('starting a night creates 3 teams of 5 named Red / Blue / Yellow', async () => {
  const app = await fresh(15);
  try {
    await beginNight(app);
    const t = teamsOf(app);
    assert.deepEqual(t.map(x => x.name), ['Red', 'Blue', 'Yellow']);
    assert.deepEqual(t.map(x => x.players.length), [5, 5, 5]);
    assert.equal(new Set(t.flatMap(x => x.players)).size, 15);
    assert.match(app.text(), /Tonight/);
  } finally { await app.dispose(); }
});

test('format comes from Settings: 2 teams of 4 needs exactly 8', async () => {
  const app = await fresh(10, { settings: { teams: 2, perSide: 4 } });
  try {
    startDraft(app); tick(app, 8);
    assert.match(app.text(), /8 here · 2 teams of 4|Put exactly 4/);
    assert.ok(!disabled(app, 'autoBalance'));
    app.act('autoBalance'); app.act('beginNight');
    assert.deepEqual(teamsOf(app).map(x => x.players.length), [4, 4]);
  } finally { await app.dispose(); }
});

test('regulars are listed first under a heading, and "Tick all regulars" ticks only them', async () => {
  const app = await fresh(10, { regulars: 4 });
  try {
    startDraft(app);
    const order = app.qsa('[data-c="att"]').map(c => c.dataset.p);
    assert.deepEqual(order.slice(0, 4), ['P01', 'P02', 'P03', 'P04']);
    assert.match(app.text(), /⭐ Regulars/);
    assert.match(app.text(), /Others/);
    app.act('tickRegulars');
    assert.equal(app.qsa('[data-c="att"]').filter(c => c.checked).length, 4);
  } finally { await app.dispose(); }
});

test('quick-add during setup creates the player and ticks them', async () => {
  const app = await fresh(3);
  try {
    startDraft(app);
    app.set('quick', 'Newcomer'); app.act('quickAdd');
    assert.equal(app.ev("S.players.some(p => p.name === 'Newcomer')"), true);
    const c = app.qsa('[data-c="att"]').find(x => app.ev(`P('${x.dataset.p}').name`) === 'Newcomer');
    assert.ok(c.checked);
  } finally { await app.dispose(); }
});

test('cancelling setup leaves no night behind', async () => {
  const app = await fresh(15);
  try { startDraft(app); tick(app, 5); app.act('cancelDraft'); assert.equal(night(app), null); assert.match(app.text(), /No night in progress/); }
  finally { await app.dispose(); }
});

/* ---- logging games ---- */
test('first game is suggested as Red vs Blue and pre-selected', async () => {
  const app = await fresh(15);
  try {
    await beginNight(app);
    assert.deepEqual(suggestion(app), ['Red vs Blue', 'first game']);
    assert.equal(app.qs('#nmA').selectedOptions[0].textContent, 'Red');
    assert.equal(app.qs('#nmB').selectedOptions[0].textContent, 'Blue');
  } finally { await app.dispose(); }
});

test('cannot start a game between a team and itself', async () => {
  const app = await fresh(15);
  try { await beginNight(app); app.change('#nmB', teamsOf(app)[0].id); app.act('newMatch'); assert.match(app.alerts.at(-1), /two different teams/); assert.equal(night(app).matches.length, 0); }
  finally { await app.dispose(); }
});

test('scoring: scorer + assist update the score and the goal log', async () => {
  const app = await fresh(15);
  try {
    await beginNight(app); newGame(app);
    const [red, blue] = teamsOf(app);
    goal(app, red.id, red.players[0], red.players[1]);
    assert.equal(score(app), '1-0');
    goal(app, blue.id, blue.players[0], null);
    goal(app, red.id, red.players[2], red.players[0]);
    assert.equal(score(app), '2-1');
    const g = night(app).matches[0].goals;
    assert.deepEqual(g.map(x => [x.scorer, x.assist]), [[red.players[0], red.players[1]], [blue.players[0], null], [red.players[2], red.players[0]]]);
    assert.match(app.text(), /Goals/);
  } finally { await app.dispose(); }
});

test('the assist list never offers the scorer, and only lists that team', async () => {
  const app = await fresh(15);
  try {
    await beginNight(app); newGame(app);
    const [red, blue] = teamsOf(app);
    app.click(`[data-a="goal"][data-team="${red.id}"][data-p="${red.players[0]}"]`);
    const offered = app.qsa('[data-a="assist"]').map(b => b.dataset.p).filter(Boolean);
    assert.ok(!offered.includes(red.players[0]));
    assert.deepEqual(offered.sort(), red.players.slice(1).sort());
    assert.ok(!offered.some(id => blue.players.includes(id)));
  } finally { await app.dispose(); }
});

test('"Own goal / unknown" counts for the team but credits nobody', async () => {
  const app = await fresh(15);
  try {
    await beginNight(app); newGame(app);
    const [red] = teamsOf(app);
    goal(app, red.id, null, null);
    assert.equal(score(app), '1-0');
    assert.equal(night(app).matches[0].goals[0].scorer, null);
  } finally { await app.dispose(); }
});

test('undo toast appears after a goal and removes exactly that goal', async () => {
  const app = await fresh(15);
  try {
    await beginNight(app); newGame(app);
    const [red, blue] = teamsOf(app);
    goal(app, red.id, red.players[0], null);
    goal(app, blue.id, blue.players[0], null);
    assert.ok(app.has('.toast'));
    assert.match(app.qs('.toast').textContent, /scored/);
    app.act('undoGoal');
    assert.equal(score(app), '1-0', 'only the last goal is undone');
    assert.ok(!app.has('.toast'));
  } finally { await app.dispose(); }
});

test('a goal can be deleted from the log', async () => {
  const app = await fresh(15);
  try {
    await beginNight(app); newGame(app);
    const [red] = teamsOf(app);
    goal(app, red.id, red.players[0], null); goal(app, red.id, red.players[1], null);
    app.click('[data-a="delGoal"]');
    assert.equal(score(app), '1-0');
  } finally { await app.dispose(); }
});

test('Save game marks the game saved and returns to the night; editing it un-saves it', async () => {
  const app = await fresh(15);
  try {
    await beginNight(app); newGame(app);
    const [red] = teamsOf(app);
    goal(app, red.id, red.players[0], null);
    assert.notEqual(night(app).matches[0].saved, true, 'not saved until Save game is pressed');
    app.act('saveMatch');
    assert.equal(night(app).matches[0].saved, true);
    assert.match(app.text(), /Game 1 ✓/);
    app.act('openMatch'); goal(app, red.id, red.players[1], null);
    assert.equal(night(app).matches[0].saved, false);
  } finally { await app.dispose(); }
});

test('a game can be deleted', async () => {
  const app = await fresh(15);
  try { await beginNight(app); newGame(app); app.act('delMatch'); assert.equal(night(app).matches.length, 0); }
  finally { await app.dispose(); }
});

test('winner stays on: Red beats Blue, so Red plays Yellow next', async () => {
  const app = await fresh(15);
  try {
    await beginNight(app); newGame(app);
    const [red] = teamsOf(app); goal(app, red.id, red.players[0], null); app.act('saveMatch');
    assert.deepEqual(suggestion(app), ['Red vs Yellow', 'Red won and stays on']);
  } finally { await app.dispose(); }
});

test('draw: the team that has played fewer games stays on', async () => {
  const app = await fresh(15);
  try {
    await beginNight(app);
    // game 1: Red v Blue 0-0 (a draw). Both have played 1, so Blue (b) stays by the tie rule
    newGame(app); app.act('saveMatch');
    const [s1] = suggestion(app);
    assert.match(s1, /Yellow/);
    assert.match(suggestion(app)[1], /draw/);
  } finally { await app.dispose(); }
});

test('manually choosing different teams overrides the suggestion for that game only', async () => {
  const app = await fresh(15);
  try {
    await beginNight(app);
    const [red, blue, yellow] = teamsOf(app);
    newGame(app, yellow.id, blue.id);
    const m = night(app).matches[0];
    assert.deepEqual([m.a, m.b], [yellow.id, blue.id]);
  } finally { await app.dispose(); }
});

/* ---- finishing ---- */
test('finish night: marks it finished, shows grade changes, saves every game', async () => {
  const app = await fresh(15);
  try {
    await beginNight(app); newGame(app);
    const [red] = teamsOf(app);
    goal(app, red.id, red.players[0], red.players[1]); // game not explicitly saved
    app.act('closeMatch');                              // Back to the night overview
    assert.notEqual(app.ev('activeNight().matches[0].saved'), true);
    app.act('finishNight');
    assert.equal(app.ev('S.nights[0].finished'), true);
    assert.equal(app.ev('S.nights[0].matches[0].saved'), true);
    assert.match(app.doc.querySelector('.sheet').textContent, /Night saved/);
    const winner = app.ev(`grades()['${red.players[0]}'].grade`);
    assert.ok(winner > 5, 'the scorer on the winning team should be above the starting grade');
    app.act('closeSheet');
    assert.match(app.text(), /No night in progress/);
  } finally { await app.dispose(); }
});

test('finish is disabled until at least one game exists', async () => {
  const app = await fresh(15);
  try { await beginNight(app); assert.ok(disabled(app, 'finishNight')); } finally { await app.dispose(); }
});

test('discarding the night removes it and its games without affecting stats', async () => {
  const app = await fresh(15);
  try {
    await beginNight(app); newGame(app); app.act('closeMatch'); app.act('discardNight');
    assert.equal(app.ev('S.nights.length'), 0);
    assert.match(app.text(), /No night in progress/);
  } finally { await app.dispose(); }
});

test('a finished night can be reopened to fix it, but only when no other night is open', async () => {
  const app = await fresh(15);
  try {
    await beginNight(app); newGame(app); app.act('closeMatch'); app.act('finishNight'); app.act('closeSheet');
    app.tab('stats'); app.act('view', { k: 'nights' });
    app.act('reopen');
    assert.equal(app.ev('S.nights[0].finished'), false);
    // start a second night is impossible while one is open: reopen another should be refused
    app.run("S.nights.push({ id:'x', date:'2026-01-01', created:'1', teams:[], matches:[], finished:true });");
    app.run("A.reopen({ id: 'x' })");
    assert.match(app.alerts.at(-1), /Finish or discard tonight/);
  } finally { await app.dispose(); }
});

test('changing teams mid-night (everyone still 5 per team) keeps the games already logged', async () => {
  const app = await fresh(15);
  try {
    await beginNight(app); newGame(app);
    const [red, blue] = teamsOf(app);
    goal(app, red.id, red.players[0], null); app.act('saveMatch');
    app.act('editTeams');
    // swap a Red and a Blue player
    const r = red.players[1], b = blue.players[1];
    app.click(`[data-a="assign"][data-p="${r}"][data-i="1"]`);
    app.click(`[data-a="assign"][data-p="${b}"][data-i="0"]`);
    assert.ok(!disabled(app, 'beginNight'));
    app.act('beginNight');
    const n = night(app);
    assert.equal(n.matches.length, 1);
    assert.ok(n.teams.find(t => t.name === 'Red').playerIds.includes(b));
    assert.deepEqual(n.teams.map(t => t.playerIds.length), [5, 5, 5]);
  } finally { await app.dispose(); }
});

/* ---- substitutes (opt-in) ---- */
test('substitutes OFF by default: a 16th player cannot start the night', async () => {
  const app = await fresh(16);
  try { startDraft(app); tick(app, 16); assert.ok(disabled(app, 'beginNight')); assert.equal(app.ev('cfg().allowSubs'), false); }
  finally { await app.dispose(); }
});

test('substitutes ON: extras wait on the bench and teams stay exactly 5', async () => {
  const app = await fresh(17, { regulars: 12, settings: { allowSubs: true } });
  try {
    startDraft(app); tick(app, 17);
    assert.ok(!disabled(app, 'autoBalance'));
    app.act('autoBalance');
    assert.match(app.text(), /17 here · 3 teams of 5 ✓ · 2 on the bench/);
    app.act('beginNight');
    const n = night(app);
    assert.deepEqual(n.teams.map(t => t.playerIds.length), [5, 5, 5]);
    assert.equal(n.bench.length, 2);
    assert.equal(new Set([...n.teams.flatMap(t => t.playerIds), ...n.bench]).size, 17);
    assert.match(app.text(), /Bench/);
  } finally { await app.dispose(); }
});

test('substitutes ON: still need at least 15 players', async () => {
  const app = await fresh(15, { settings: { allowSubs: true } });
  try { startDraft(app); tick(app, 14); assert.ok(disabled(app, 'autoBalance')); assert.match(app.text(), /at least 15/); }
  finally { await app.dispose(); }
});

test('substituting swaps a bench player into that game only, and both players are credited with the game', async () => {
  const app = await fresh(16, { settings: { allowSubs: true } });
  try {
    startDraft(app); tick(app, 16); app.act('autoBalance'); app.act('beginNight');
    const n0 = night(app), bench = n0.bench[0];
    const [red, blue] = teamsOf(app);
    newGame(app);
    const off = red.players[0];
    app.click(`[data-a="subStart"][data-team="${red.id}"]`);
    app.click(`[data-a="subOut"][data-p="${off}"]`);
    app.click(`[data-a="subIn"][data-p="${bench}"]`);
    const m = night(app).matches[0];
    assert.ok(m.squads[red.id].includes(bench) && !m.squads[red.id].includes(off));
    assert.equal(m.squads[red.id].length, 5);
    assert.match(app.text(), /⇄/);
    // the sub can score
    goal(app, red.id, bench, null);
    assert.equal(score(app), '1-0');
    // credits: both the player who went off and the sub played the game
    app.act('saveMatch'); app.act('finishNight');
    const s = app.ev(`(() => { const R = grades(); return { sub: R['${bench}'].gp, off: R['${off}'].gp, subGoals: R['${bench}'].g, mate: R['${red.players[1]}'].gp }; })()`);
    assert.deepEqual(s, { sub: 1, off: 1, subGoals: 1, mate: 1 });
    // next game the original squad is back
    assert.equal(app.ev('S.nights[0].teams.find(t => t.name === "Red").playerIds.includes("' + off + '")'), true);
  } finally { await app.dispose(); }
});

test('the substitute list only offers people not already in that game', async () => {
  const app = await fresh(16, { settings: { allowSubs: true } });
  try {
    startDraft(app); tick(app, 16); app.act('autoBalance'); app.act('beginNight');
    const [red, blue] = teamsOf(app); newGame(app);
    app.click(`[data-a="subStart"][data-team="${red.id}"]`); app.click(`[data-a="subOut"][data-p="${red.players[0]}"]`);
    const offered = app.qsa('[data-a="subIn"]').map(b => b.dataset.p);
    const inGame = new Set([...red.players, ...blue.players]);
    assert.ok(offered.length > 0 && offered.every(id => !inGame.has(id)), 'nobody currently playing may be offered');
  } finally { await app.dispose(); }
});

test('4 teams: next game is the two teams with the fewest games', async () => {
  const app = await fresh(20, { settings: { teams: 4 } });
  try {
    startDraft(app); tick(app, 20); app.act('autoBalance'); app.act('beginNight');
    newGame(app); app.act('saveMatch');   // Red v Blue
    assert.deepEqual(suggestion(app), ['Yellow vs Green', 'the teams with the fewest games']);
  } finally { await app.dispose(); }
});
