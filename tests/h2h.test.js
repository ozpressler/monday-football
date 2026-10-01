'use strict';
// QA: head to head (against each other / as teammates)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, seedWorld, isoDaysAgo } = require('./helpers');

async function withWorld(spec, fn) {
  const app = await loadApp();
  try { seedWorld(app, spec); await fn(app); } finally { await app.dispose(); }
}
const rel = (app, pid) => app.ev(`relations(finishedNights(), '${pid}')`);

// Hand-computed world
//  N1  Red[A,B] v Blue[C,D]:  G1 Red 2-1,  G2 1-1
//  N2  Red[A,C] v Blue[B,D]:  G1 Blue 1-0
const WORLD = {
  players: ['A', 'B', 'C', 'D'],
  nights: [
    { date: '2026-01-05', teams: { Red: ['A', 'B'], Blue: ['C', 'D'] }, games: [
      { a: 'Red', b: 'Blue', goals: [['Red', 'A'], ['Red', 'A'], ['Blue', 'C']] },
      { a: 'Red', b: 'Blue', goals: [['Red', 'B'], ['Blue', 'D']] } ] },
    { date: '2026-01-12', teams: { Red: ['A', 'C'], Blue: ['B', 'D'] }, games: [
      { a: 'Red', b: 'Blue', goals: [['Blue', 'B']] } ] },
  ],
};

test('relations: records against and with each player are counted correctly', async () => {
  await withWorld(WORLD, async app => {
    const r = rel(app, 'A');
    assert.deepEqual(r.C.vs, { gp: 2, w: 1, d: 1, l: 0, gf: 3, ga: 2 });
    assert.deepEqual(r.C.tm, { gp: 1, w: 0, d: 0, l: 1 });
    assert.deepEqual(r.D.vs, { gp: 3, w: 1, d: 1, l: 1, gf: 3, ga: 3 });
    assert.deepEqual(r.D.tm, { gp: 0, w: 0, d: 0, l: 0 });
    assert.deepEqual(r.B.vs, { gp: 1, w: 0, d: 0, l: 1, gf: 0, ga: 1 });
    assert.deepEqual(r.B.tm, { gp: 2, w: 1, d: 1, l: 0 });
    assert.equal(r.A, undefined, 'a player has no record against themselves');
  });
});

test('relations are mirror images: A\'s wins over B are B\'s losses to A', async () => {
  await withWorld(WORLD, async app => {
    for (const [x, y] of [['A', 'B'], ['A', 'C'], ['A', 'D'], ['B', 'C'], ['B', 'D'], ['C', 'D']]) {
      const p = rel(app, x)[y].vs, q = rel(app, y)[x].vs;
      assert.deepEqual([p.gp, p.w, p.d, p.l, p.gf, p.ga], [q.gp, q.l, q.d, q.w, q.ga, q.gf], `${x} v ${y}`);
      assert.deepEqual(rel(app, x)[y].tm, rel(app, y)[x].tm, `${x} with ${y}`);
    }
  });
});

test('every game a player plays is accounted for: against + with', async () => {
  await withWorld(WORLD, async app => {
    // A played 3 games; each game has 3 opponents slots (2 opponents) and 1 teammate slot
    const r = rel(app, 'A');
    assert.equal(Object.values(r).reduce((s, e) => s + e.vs.gp, 0), 3 * 2);
    assert.equal(Object.values(r).reduce((s, e) => s + e.tm.gp, 0), 3 * 1);
  });
});

test('screen: pick a player and see tables of opponents and teammates', async () => {
  await withWorld(WORLD, async app => {
    app.tab('stats'); app.act('view', { k: 'h2h' });
    assert.match(app.text(), /A against/);
    const tables = app.qsa('#app table');
    assert.equal(tables.length, 2);
    const oppRows = [...tables[0].querySelectorAll('tr')].slice(1).map(tr => [...tr.children].map(td => td.textContent));
    assert.deepEqual(oppRows.find(r => r[0] === 'D'), ['D', '3', '1', '1', '1', '0']);    // GP W D L GD
    assert.deepEqual(oppRows.find(r => r[0] === 'C'), ['C', '2', '1', '1', '0', '+1']);
    const tmRows = [...tables[1].querySelectorAll('tr')].slice(1).map(tr => [...tr.children].map(td => td.textContent));
    assert.deepEqual(tmRows.find(r => r[0] === 'B'), ['B', '2', '1-1-0', '75%']);
    assert.ok(!tmRows.some(r => r[0] === 'D'), 'never teammates with D');
    // switch to another player
    app.change('[data-c="h2ha"]', 'D');
    assert.match(app.text(), /D against/);
  });
});

test('screen: two players compared directly (against each other + as teammates)', async () => {
  await withWorld(WORLD, async app => {
    app.tab('stats'); app.act('view', { k: 'h2h' });
    app.change('[data-c="h2hb"]', 'D');
    const t = app.text();
    assert.match(t, /Against each other/);
    assert.match(t, /3 games against each other · goals 3–3/);
    assert.match(t, /Never played on the same team/);
    const tiles = app.qsa('#app .grid .card b').map(b => b.textContent);
    assert.deepEqual(tiles, ['1', '1', '1'], 'A wins, draws, D wins');
    app.change('[data-c="h2hb"]', 'B');
    assert.match(app.text(), /1 game against each other · goals 0–1/);
    assert.match(app.text(), /75%/);
    assert.match(app.text(), /win rate · 2 games · 1-1-0/);
  });
});

test('choosing the same player twice clears the second selector', async () => {
  await withWorld(WORLD, async app => {
    app.tab('stats'); app.act('view', { k: 'h2h' });
    app.change('[data-c="h2hb"]', 'C');
    app.change('[data-c="h2ha"]', 'C');
    assert.equal(app.ev('ui.h2h.b'), '');
  });
});

test('player card shows the toughest and favourite opponent (3+ games needed)', async () => {
  const win = date => ({ date, teams: { Red: ['A'], Blue: ['X'] }, games: [{ a: 'Red', b: 'Blue', goals: [['Red', 'A']] }] });
  const lose = date => ({ date, teams: { Red: ['A'], Blue: ['Y'] }, games: [{ a: 'Red', b: 'Blue', goals: [['Blue', 'Y']] }] });
  await withWorld({
    players: ['A', 'X', 'Y'],
    nights: [win('2026-01-05'), win('2026-01-06'), win('2026-01-07'), lose('2026-01-08'), lose('2026-01-09'), lose('2026-01-10')],
  }, async app => {
    app.tab('stats'); app.click('tr.clk[data-id="A"]');
    const sheet = app.qs('.sheet').textContent.replace(/\s+/g, ' ');
    assert.match(sheet, /Toughest opponent Y \(0% · 3 games\)/);
    assert.match(sheet, /Favourite opponent X \(100% · 3 games\)/);
  });
});

test('no rivalry line when there are fewer than 3 games against anyone', async () => {
  await withWorld(WORLD.nights.length ? { ...WORLD, nights: WORLD.nights.slice(1) } : WORLD, async app => {
    app.tab('stats'); app.click('tr.clk[data-id="A"]');
    assert.doesNotMatch(app.qs('.sheet').textContent, /Toughest opponent/);
  });
});

test('the "Head to head" button on a player card opens that player on the H2H screen', async () => {
  await withWorld(WORLD, async app => {
    app.tab('stats'); app.click('tr.clk[data-id="D"]');
    app.act('openH2h', { id: 'D' });
    assert.equal(app.ev('ui.view'), 'h2h');
    assert.equal(app.ev('ui.h2h.a'), 'D');
    assert.ok(!app.has('.sheet'));
    assert.match(app.text(), /D against/);
  });
});

test('head to head follows the period filter', async () => {
  const nights = [
    { date: isoDaysAgo(100), teams: { Red: ['A'], Blue: ['B'] }, games: [{ a: 'Red', b: 'Blue', goals: [['Red', 'A']] }] },
    { date: isoDaysAgo(5), teams: { Red: ['A'], Blue: ['B'] }, games: [{ a: 'Red', b: 'Blue', goals: [['Blue', 'B']] }] },
  ];
  await withWorld({ players: ['A', 'B'], nights }, async app => {
    app.tab('stats'); app.act('view', { k: 'h2h' }); app.change('[data-c="h2hb"]', 'B');
    assert.match(app.text(), /2 games against each other/);
    app.act('range', { k: '30d' });
    assert.match(app.text(), /1 game against each other · goals 0–1/);
  });
});

test('empty states: no finished night yet, and fewer than two players', async () => {
  await withWorld({ players: ['A', 'B'] }, async app => {
    app.tab('stats'); app.act('view', { k: 'h2h' });
    assert.match(app.text(), /Finish a night to see head to head/);
  });
  await withWorld({ players: ['A'] }, async app => {
    app.tab('stats'); app.act('view', { k: 'h2h' });
    assert.match(app.text(), /Add at least two players/);
  });
});

test('substitutes count as having played: they appear in head to head', async () => {
  const world = { players: ['A', 'B', 'C', 'D', 'E'], nights: [{
    date: '2026-01-05', bench: ['E'], teams: { Red: ['A', 'B'], Blue: ['C', 'D'] }, games: [{ a: 'Red', b: 'Blue', goals: [['Red', 'A']] }],
  }] };
  await withWorld(world, async app => {
    app.run(`S.nights[0].matches[0].squads = { '2026-01-05-Red': ['E', 'B'], '2026-01-05-Blue': ['C', 'D'] }; S.nights[0].matches[0].subs = [{ t: '2026-01-05-Red', out: 'A', in: 'E' }];`);
    const r = rel(app, 'E');
    assert.equal(r.C.vs.gp, 1); assert.equal(r.B.tm.gp, 1);
    assert.equal(rel(app, 'A').E.tm.gp, 1, 'the player who went off played alongside the sub');
  });
});
