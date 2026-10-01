'use strict';
// QA: stats screens, awards, streaks, filters, and managing players
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, seedWorld, names, isoDaysAgo } = require('./helpers');

async function withWorld(spec, fn) {
  const app = await loadApp();
  try { seedWorld(app, spec); await fn(app); } finally { await app.dispose(); }
}
const rows = app => app.qsa('tr.clk').map(tr => [...tr.children].map(td => td.textContent.trim()));
const col = { name: 0, grade: 1, gp: 2, wr: 3, g: 4, a: 5, ga: 6 };

// 3 nights, A beats B every game. A scores, B assists on A's side.
const dominant = (dates = ['2026-01-05', '2026-01-12', '2026-01-19']) => dates.map(date => ({
  date, teams: { Red: ['A', 'B'], Blue: ['C', 'D'] },
  games: [{ a: 'Red', b: 'Blue', goals: [['Red', 'A', 'B'], ['Red', 'A', 'B'], ['Blue', 'C']] }, { a: 'Red', b: 'Blue', goals: [['Red', 'B', 'A']] }],
}));

/* ---- stats table ---- */
test('stats table shows games, win %, goals, assists and G+A per player', async () => {
  await withWorld({ players: ['A', 'B', 'C', 'D'], nights: dominant() }, async app => {
    app.tab('stats');
    const r = Object.fromEntries(rows(app).map(x => [x[0], x]));
    assert.equal(r.A[col.gp], '6');
    assert.equal(r.A[col.wr], '100%');
    assert.equal(r.A[col.g], '6');      // 2 goals x 3 nights
    assert.equal(r.A[col.a], '3');
    assert.equal(r.A[col.ga], '9');
    assert.equal(r.C[col.wr], '0%');
    assert.equal(r.C[col.g], '3');
  });
});

test('win % counts a draw as half a win', async () => {
  await withWorld({
    players: ['A', 'B'], nights: [{ date: '2026-01-05', teams: { Red: ['A'], Blue: ['B'] }, games: [{ a: 'Red', b: 'Blue', goals: [['Red', 'A']] }, { a: 'Red', b: 'Blue', goals: [] }] }],
  }, async app => {
    app.tab('stats');
    const r = Object.fromEntries(rows(app).map(x => [x[0], x]));
    assert.equal(r.A[col.wr], '75%'); // 1 win + 1 draw of 2 games
    assert.equal(r.B[col.wr], '25%');
  });
});

test('clicking a column header sorts, and clicking again reverses', async () => {
  await withWorld({ players: ['A', 'B', 'C', 'D'], nights: dominant() }, async app => {
    app.tab('stats');
    app.act('sort', { k: 'name' });
    assert.deepEqual(rows(app).map(x => x[0]), ['A', 'B', 'C', 'D']);
    app.act('sort', { k: 'name' });
    assert.deepEqual(rows(app).map(x => x[0]), ['D', 'C', 'B', 'A']);
    app.act('sort', { k: 'g' });
    assert.equal(rows(app)[0][0], 'A');
  });
});

test('sorting by win % puts the best record first, and a draw counts half', async () => {
  await withWorld({
    players: ['W', 'D', 'L', 'X'],
    nights: [{ date: '2026-01-05', teams: { Red: ['W', 'D'], Blue: ['L', 'X'] }, games: [{ a: 'Red', b: 'Blue', goals: [['Red', 'W']] }, { a: 'Red', b: 'Blue', goals: [] }] }],
  }, async app => {
    app.tab('stats'); app.act('sort', { k: 'wr' });
    const r = rows(app);
    assert.equal(r[0][col.wr], '75%');
    assert.equal(r.at(-1)[col.wr], '25%');
    app.act('sort', { k: 'wr' });
    assert.equal(rows(app)[0][col.wr], '25%', 'second click reverses');
  });
});

test('sort by win %: three draws (50%) ranks above one win and two losses (33%)', async () => {
  const n = (date, red, blue, goals) => ({ date, teams: { Red: [red], Blue: [blue] }, games: [{ a: 'Red', b: 'Blue', goals }] });
  await withWorld({
    players: ['A', 'B', 'X', 'Y', 'Z'],
    nights: [
      n('2026-01-05', 'A', 'X', []), n('2026-01-06', 'A', 'Y', []), n('2026-01-07', 'A', 'Z', []),           // A: D D D
      n('2026-01-08', 'B', 'X', [['Red', 'B']]), n('2026-01-09', 'B', 'Y', [['Blue', 'Y']]), n('2026-01-10', 'B', 'Z', [['Blue', 'Z']]), // B: W L L
    ],
  }, async app => {
    app.tab('stats'); app.act('sort', { k: 'wr' });
    const order = rows(app).map(r => r[0]);
    const pct = Object.fromEntries(rows(app).map(r => [r[0], r[col.wr]]));
    assert.equal(pct.A, '50%'); assert.equal(pct.B, '33%');
    assert.ok(order.indexOf('A') < order.indexOf('B'), `order was ${order}`);
  });
});

test('stats are empty-state friendly before any night is finished', async () => {
  await withWorld({ players: ['A', 'B'] }, async app => {
    app.tab('stats'); app.act('view', { k: 'awards' });
    assert.match(app.text(), /Finish a night to see awards/);
    app.act('view', { k: 'nights' });
    assert.match(app.text(), /No finished nights yet/);
  });
});

test('Past nights lists every finished night with its scores and a Share button', async () => {
  await withWorld({ players: ['A', 'B', 'C', 'D'], nights: dominant() }, async app => {
    app.tab('stats'); app.act('view', { k: 'nights' });
    assert.equal(app.qsa('[data-a="shareNight"]').length, 3);
    assert.match(app.text(), /Red 2 – 1 Blue/);
    assert.match(app.text(), /2026-01-19/);
  });
});

/* ---- period filters ---- */
test('period filter: last 30 days and last 10 nights change the table but not grades', async () => {
  const dates = [100, 60, 20, 10].map(isoDaysAgo);
  await withWorld({ players: ['A', 'B', 'C', 'D'], nights: dominant(dates) }, async app => {
    app.tab('stats');
    const gradeAll = rows(app).find(x => x[0] === 'A')[col.grade];
    assert.equal(rows(app).find(x => x[0] === 'A')[col.gp], '8');           // 4 nights x 2 games
    app.act('range', { k: '30d' });
    assert.equal(rows(app).find(x => x[0] === 'A')[col.gp], '4');           // only the 2 recent nights
    assert.equal(rows(app).find(x => x[0] === 'A')[col.grade], gradeAll, 'grade stays all-time');
    app.act('range', { k: 'all' });
    assert.equal(rows(app).find(x => x[0] === 'A')[col.gp], '8');
  });
});

test('period filter: "last 10 nights" keeps only the newest 10', async () => {
  const dates = Array.from({ length: 12 }, (_, i) => isoDaysAgo(120 - i * 7));
  await withWorld({ players: ['A', 'B', 'C', 'D'], nights: dominant(dates) }, async app => {
    app.tab('stats'); app.act('range', { k: '10n' });
    assert.equal(rows(app).find(x => x[0] === 'A')[col.gp], '20');
  });
});

test('a period with no games says so instead of showing an empty table', async () => {
  await withWorld({ players: ['A', 'B', 'C', 'D'], nights: dominant(['2024-01-01']) }, async app => {
    app.tab('stats'); app.act('range', { k: '30d' });
    assert.match(app.text(), /No games in this period/);
  });
});

/* ---- awards, streaks, partners ---- */
test('awards rank the right people: top scorer, top assister, best win rate', async () => {
  await withWorld({ players: ['A', 'B', 'C', 'D'], nights: dominant() }, async app => {
    app.tab('stats'); app.act('view', { k: 'awards' });
    const card = title => app.qsa('#app .card').find(c => c.textContent.includes(title));
    assert.match(card('Top scorers').textContent, /🥇.*A.*6/);
    assert.match(card('Top assisters').textContent, /B/);
    assert.match(card('Best win rate').textContent, /100%/);
    assert.ok(app.qsa('#app svg').length >= 1, 'goals-per-night chart is drawn');
    assert.match(app.text(), /Goals per night/);
  });
});

test('streak maths: longest and current win/loss runs', async () => {
  const app = await loadApp();
  try {
    const f = seq => app.ev(`(() => { const s = ${JSON.stringify(seq.split('').map(r => ({ r })))}; return { w: streakOf(s, 'W'), l: streakOf(s, 'L') }; })()`);
    assert.deepEqual(f('WWLWWW'), { w: { best: 3, now: 3 }, l: { best: 1, now: 0 } });
    assert.deepEqual(f('WWWLL'), { w: { best: 3, now: 0 }, l: { best: 2, now: 2 } });
    assert.deepEqual(f('DDD'), { w: { best: 0, now: 0 }, l: { best: 0, now: 0 } });
    assert.deepEqual(f(''), { w: { best: 0, now: 0 }, l: { best: 0, now: 0 } });
  } finally { await app.dispose(); }
});

test('best partner needs at least 4 games together', async () => {
  await withWorld({ players: ['A', 'B', 'C', 'D'], nights: dominant(['2026-01-05']) }, async app => {   // only 2 games together
    assert.deepEqual(app.ev(`partnerStats(finishedNights(), 'A')`), []);
  });
  await withWorld({ players: ['A', 'B', 'C', 'D'], nights: dominant() }, async app => {              // 6 games together
    const p = app.ev(`partnerStats(finishedNights(), 'A')`);
    assert.equal(p[0].id, 'B'); assert.equal(p[0].gp, 6); assert.equal(p[0].wr, 1);
  });
});

test("player card shows form (last 5), streak and best partner", async () => {
  await withWorld({ players: ['A', 'B', 'C', 'D'], nights: dominant() }, async app => {
    app.tab('stats');
    app.click('tr.clk[data-id="A"]');
    const sheet = app.qs('.sheet').textContent;
    assert.match(sheet, /Form \(last 5 games\)/);
    assert.match(sheet, /WWWWW/);
    assert.match(sheet, /6 wins in a row/);
    assert.match(sheet, /Wins most with B/);
    assert.match(sheet, /W-D-L.*6-0-0/);
  });
});

/* ---- managing players ---- */
test('add one player, add many at once (lines and commas), ignore blanks', async () => {
  await withWorld({ players: [] }, async app => {
    app.tab('players');
    app.set('newName', 'Solo'); app.act('addPlayer');
    app.set('bulk', 'One, Two\nThree\n\n  \nFour'); app.act('bulkAdd');
    assert.deepEqual(app.ev('S.players.map(p => p.name)'), ['Solo', 'One', 'Two', 'Three', 'Four']);
    app.set('newName', '   '); app.act('addPlayer');
    assert.equal(app.ev('S.players.length'), 5, 'blank names are ignored');
  });
});

test('edit name, starting grade, adjustment and regular flag; values are clamped', async () => {
  await withWorld({ players: ['Ann'] }, async app => {
    app.tab('players');
    app.change('[data-c="pname"]', 'Annie');
    app.change('[data-c="pseed"]', '99');
    app.change('[data-c="padj"]', '-9');
    app.change('[data-c="preg"]', true);
    const p = app.ev('S.players[0]');
    assert.equal(p.name, 'Annie'); assert.equal(p.seed, 10); assert.equal(p.adj, -3); assert.equal(p.regular, true);
    assert.equal(app.ev("grades()['Ann'].grade"), 7);   // 10 - 3
  });
});

test('regulars are listed first on the Players tab', async () => {
  await withWorld({ players: [{ name: 'Zed', regular: true }, { name: 'Amy' }, { name: 'Bob', regular: true }] }, async app => {
    app.tab('players');
    assert.deepEqual(app.qsa('[data-c="pname"]').map(i => i.value), ['Bob', 'Zed', 'Amy']);
  });
});

test('retire hides a player from setup and the table but keeps history; restore brings them back', async () => {
  await withWorld({ players: ['A', 'B', 'C', 'D'], nights: dominant() }, async app => {
    app.tab('players'); app.act('toggleActive', { p: 'A' });
    assert.equal(app.ev("P('A').inactive"), true);
    app.tab('stats'); assert.ok(!rows(app).some(r => r[0] === 'A'));
    assert.equal(app.ev("grades()['A'].gp"), 6, 'history is kept');
    app.tab('night'); app.act('startDraft');
    assert.ok(!app.qsa('[data-c="att"]').some(c => c.dataset.p === 'A'), 'not offered for tonight');
    app.act('cancelDraft'); app.tab('players'); app.act('toggleActive', { p: 'A' });
    app.tab('stats'); assert.ok(rows(app).some(r => r[0] === 'A'));
  });
});

test('deleting a player removes them everywhere but keeps every game score', async () => {
  await withWorld({ players: ['A', 'B', 'C', 'D'], nights: dominant() }, async app => {
    const scoresBefore = app.ev(`S.nights.flatMap(n => n.matches.map(m => score(m, m.a) + '-' + score(m, m.b)))`);
    app.tab('players'); app.act('deletePlayer', { p: 'A' });
    assert.match(app.confirms.at(-1), /Permanently delete A/);
    assert.equal(app.ev("S.players.some(p => p.id === 'A')"), false);
    assert.equal(app.ev(`JSON.stringify(S).includes('"A"')`), false, 'no leftover references');
    assert.deepEqual(app.ev(`S.nights.flatMap(n => n.matches.map(m => score(m, m.a) + '-' + score(m, m.b)))`), scoresBefore);
    // goals A scored are now "unknown" but still count for the team
    assert.ok(app.ev(`S.nights[0].matches[0].goals.some(g => g.scorer === null)`));
    app.tab('stats'); assert.ok(!rows(app).some(r => r[0] === 'A'));
    assert.equal(app.ev("grades()['B'].gp"), 6, "teammates' games are unaffected");
  });
});

test('deleting a player also cleans substitutions and the bench', async () => {
  await withWorld({ players: ['A', 'B', 'C', 'D', 'E'], nights: [{
    date: '2026-01-05', bench: ['E'], teams: { Red: ['A', 'B'], Blue: ['C', 'D'] }, games: [{ a: 'Red', b: 'Blue', goals: [] }],
  }] }, async app => {
    app.run(`S.nights[0].matches[0].squads = { '2026-01-05-Red': ['E', 'B'], '2026-01-05-Blue': ['C', 'D'] };`);
    app.tab('players'); app.act('deletePlayer', { p: 'E' });
    assert.deepEqual(app.ev('S.nights[0].bench'), []);
    assert.deepEqual(app.ev("S.nights[0].matches[0].squads['2026-01-05-Red']"), ['B']);
  });
});

test('deleting a player does not break the next night (Edit teams / setup still work)', async () => {
  await withWorld({ players: names(16) }, async app => {
    app.tab('players'); app.act('deletePlayer', { p: 'P16' });
    app.tab('night'); app.act('startDraft');
    assert.equal(app.qsa('[data-c="att"]').length, 15);
  });
});
