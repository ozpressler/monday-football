'use strict';
// QA: the fair-teams maker
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, seedWorld, names } = require('./helpers');

/** players with given seed grades (no games, so grade == seed) */
async function withGrades(grades, fn) {
  const app = await loadApp();
  try {
    seedWorld(app, { players: grades.map((g, i) => ({ name: `P${String(i + 1).padStart(2, '0')}`, seed: g })) });
    await fn(app);
  } finally { await app.dispose(); }
}
const balance = (app, k) => app.ev(`(() => { const ids = S.players.map(p => p.id); const t = balance(ids, ${k}); const G = grades();
  return { teams: t, means: t.map(x => x.reduce((s, id) => s + G[id].grade, 0) / x.length) }; })()`);
const spread = means => Math.max(...means) - Math.min(...means);

test('15 players / 3 teams: three teams of five, everyone used exactly once', async () => {
  await withGrades(Array.from({ length: 15 }, (_, i) => 3 + (i % 6)), async app => {
    const r = balance(app, 3);
    assert.deepEqual(r.teams.map(t => t.length), [5, 5, 5]);
    assert.deepEqual(r.teams.flat().sort(), names(15));
  });
});

test('20 players / 4 teams gives four teams of five', async () => {
  await withGrades(Array.from({ length: 20 }, (_, i) => 2 + (i % 7)), async app => {
    const r = balance(app, 4);
    assert.deepEqual(r.teams.map(t => t.length), [5, 5, 5, 5]);
    assert.equal(new Set(r.teams.flat()).size, 20);
  });
});

test('10 players / 2 teams gives two teams of five', async () => {
  await withGrades([9, 8, 7, 6, 5, 5, 4, 3, 2, 1], async app => {
    const r = balance(app, 2);
    assert.deepEqual(r.teams.map(t => t.length), [5, 5]);
    assert.ok(spread(r.means) < 0.7, `spread ${spread(r.means)}`);
  });
});

test('uneven numbers differ by at most one player per team (16 players / 3 teams)', async () => {
  await withGrades(Array.from({ length: 16 }, (_, i) => 3 + (i % 5)), async app => {
    const sizes = balance(app, 3).teams.map(t => t.length).sort();
    assert.deepEqual(sizes, [5, 5, 6]);
  });
});

test('teams are fair: average grades stay close (30 random line-ups)', async () => {
  const rnd = (() => { let s = 12345; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; })();
  for (let trial = 0; trial < 30; trial++) {
    const grades = Array.from({ length: 15 }, () => Math.round((2 + rnd() * 7) * 2) / 2);
    await withGrades(grades, async app => {
      const r = balance(app, 3);
      assert.ok(spread(r.means) <= 0.5, `trial ${trial}: spread ${spread(r.means).toFixed(2)} for ${grades.join(',')}`);
    });
  }
});

test('one star player does not end up with all the other top players', async () => {
  await withGrades([10, 9, 9, 8, 8, 5, 5, 5, 4, 4, 3, 3, 2, 2, 2], async app => {
    const r = balance(app, 3);
    const G = Object.fromEntries([10, 9, 9, 8, 8, 5, 5, 5, 4, 4, 3, 3, 2, 2, 2].map((g, i) => [`P${String(i + 1).padStart(2, '0')}`, g]));
    const topPerTeam = r.teams.map(t => t.filter(id => G[id] >= 8).length);
    assert.ok(Math.max(...topPerTeam) <= 2, `top players per team: ${topPerTeam}`);
  });
});

test('shuffle gives variety but stays fair', async () => {
  await withGrades(Array.from({ length: 15 }, (_, i) => 3 + (i % 6)), async app => {
    const seen = new Set();
    for (let i = 0; i < 12; i++) {
      const r = balance(app, 3);
      assert.ok(spread(r.means) <= 0.5);
      seen.add(JSON.stringify(r.teams.map(t => t.slice().sort()).sort()));
    }
    assert.ok(seen.size > 1, 'repeated shuffles should not always return the same teams');
  });
});

test('balancing does not change the player list or grades', async () => {
  await withGrades([5, 6, 7, 8, 4, 3], async app => {
    const before = app.ev('JSON.stringify(S.players)');
    balance(app, 2);
    assert.equal(app.ev('JSON.stringify(S.players)'), before);
  });
});

test('uses current grades, not just starting grades: finds the best possible 2v2 split', async () => {
  const app = await loadApp();
  try {
    // Ace has seed 5 but dominated 4 nights, so the balancer must treat Ace as the strongest player
    const nights = ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'].map(date => ({
      date, teams: { Red: ['Ace', 'B1'], Blue: ['C1', 'D1'] },
      games: [{ a: 'Red', b: 'Blue', goals: [['Red', 'Ace'], ['Red', 'Ace'], ['Red', 'Ace']] }, { a: 'Red', b: 'Blue', goals: [['Red', 'Ace']] }],
    }));
    seedWorld(app, { players: ['Ace', 'B1', 'C1', 'D1'], nights });
    const G = app.ev(`Object.fromEntries(Object.entries(grades()).map(([k, v]) => [k, v.grade]))`);
    assert.ok(G.Ace > 6, `Ace should have earned a high grade, got ${G.Ace}`);
    const others = ['B1', 'C1', 'D1'];
    const best = Math.min(...others.map(mate => Math.abs((G.Ace + G[mate]) - others.filter(o => o !== mate).reduce((s, o) => s + G[o], 0))));
    for (let i = 0; i < 10; i++) {
      const t = app.ev(`balance(['Ace','B1','C1','D1'], 2)`);
      const a = t.find(x => x.includes('Ace')), b = t.find(x => !x.includes('Ace'));
      const diff = Math.abs(a.reduce((s, id) => s + G[id], 0) - b.reduce((s, id) => s + G[id], 0));
      assert.ok(Math.abs(diff - best) < 1e-6 || diff <= best + 0.15, `split diff ${diff} vs best ${best}`);
    }
  } finally { await app.dispose(); }
});
