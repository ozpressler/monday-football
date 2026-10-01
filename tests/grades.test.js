'use strict';
// QA: stats maths and the player grade formula
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, seedWorld } = require('./helpers');

const stats = app => app.ev(`Object.fromEntries(Object.entries(grades()).map(([k, v]) =>
  [k, { grade: v.grade, gp: v.gp, w: v.w, d: v.d, l: v.l, g: v.g, a: v.a, gf: v.gf, ga: v.ga, nt: v.nt }]))`);

async function withWorld(spec, fn) {
  const app = await loadApp();
  try { seedWorld(app, spec); await fn(app); } finally { await app.dispose(); }
}

test('grade with no games = starting grade + adjustment', async () => {
  await withWorld({ players: ['A', { name: 'B', seed: 7 }, { name: 'C', adj: 1.5 }] }, async app => {
    const s = stats(app);
    assert.equal(s.A.grade, 5);
    assert.equal(s.B.grade, 7);
    assert.equal(s.C.grade, 6.5);
  });
});

test('grade is always clamped between 1 and 10', async () => {
  await withWorld({ players: [{ name: 'Hi', seed: 10, adj: 3 }, { name: 'Lo', seed: 1, adj: -3 }] }, async app => {
    const s = stats(app);
    assert.equal(s.Hi.grade, 10);
    assert.equal(s.Lo.grade, 1);
  });
});

test('counts games, W/D/L, goals, assists and goal difference correctly', async () => {
  await withWorld({
    players: ['A', 'B', 'C', 'D'],
    nights: [{
      date: '2026-01-05', teams: { Red: ['A', 'B'], Blue: ['C', 'D'] },
      games: [
        { a: 'Red', b: 'Blue', goals: [['Red', 'A', 'B'], ['Red', 'A'], ['Blue', 'C', 'D']] },   // Red 2-1
        { a: 'Red', b: 'Blue', goals: [['Red', 'B'], ['Blue', 'D', 'C']] },                      // 1-1
      ],
    }],
  }, async app => {
    const s = stats(app);
    assert.deepEqual({ gp: s.A.gp, w: s.A.w, d: s.A.d, l: s.A.l, g: s.A.g, a: s.A.a, gf: s.A.gf, ga: s.A.ga }, { gp: 2, w: 1, d: 1, l: 0, g: 2, a: 0, gf: 3, ga: 2 });
    assert.deepEqual({ w: s.B.w, d: s.B.d, g: s.B.g, a: s.B.a }, { w: 1, d: 1, g: 1, a: 1 });
    assert.deepEqual({ gp: s.C.gp, w: s.C.w, d: s.C.d, l: s.C.l, g: s.C.g, a: s.C.a, gf: s.C.gf, ga: s.C.ga }, { gp: 2, w: 0, d: 1, l: 1, g: 1, a: 1, gf: 2, ga: 3 });
    assert.deepEqual({ g: s.D.g, a: s.D.a }, { g: 1, a: 1 });
    assert.equal(s.A.nt, 1, 'one night attended');
  });
});

test('a consistent winner is graded higher than a consistent loser', async () => {
  const nights = ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'].map(date => ({
    date, teams: { Red: ['Win'], Blue: ['Lose'] },
    games: [{ a: 'Red', b: 'Blue', goals: [['Red', 'Win'], ['Red', 'Win']] }, { a: 'Red', b: 'Blue', goals: [['Red', 'Win']] }],
  }));
  await withWorld({ players: ['Win', 'Lose'], nights }, async app => {
    const s = stats(app);
    assert.ok(s.Win.grade > 5.5, `winner should be above average, got ${s.Win.grade}`);
    assert.ok(s.Lose.grade < 4.5, `loser should be below average, got ${s.Lose.grade}`);
    assert.ok(s.Win.grade - s.Lose.grade > 2);
  });
});

test('a goal scorer is graded higher than a teammate with identical results', async () => {
  const nights = ['2026-01-05', '2026-01-12', '2026-01-19'].map(date => ({
    date, teams: { Red: ['Scorer', 'Quiet'], Blue: ['X', 'Y'] },
    games: [{ a: 'Red', b: 'Blue', goals: [['Red', 'Scorer'], ['Red', 'Scorer'], ['Blue', 'X']] }],
  }));
  await withWorld({ players: ['Scorer', 'Quiet', 'X', 'Y'], nights }, async app => {
    const s = stats(app);
    assert.equal(s.Scorer.w, s.Quiet.w);
    assert.ok(s.Scorer.grade > s.Quiet.grade, `${s.Scorer.grade} should beat ${s.Quiet.grade}`);
  });
});

test('recent form counts more than old form', async () => {
  const dates = ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26', '2026-02-02', '2026-02-09'];
  // P's team wins the first three nights, Q's team wins the last three: equal totals
  const nights = dates.map((date, i) => ({
    date, teams: { Red: ['P'], Blue: ['Q'] },
    games: [{ a: 'Red', b: 'Blue', goals: i < 3 ? [['Red', 'P']] : [['Blue', 'Q']] }],
  }));
  await withWorld({ players: ['P', 'Q'], nights }, async app => {
    const s = stats(app);
    assert.equal(s.P.w, 3); assert.equal(s.Q.w, 3);
    assert.ok(s.Q.grade > s.P.grade, `recent winner Q (${s.Q.grade}) should beat early winner P (${s.P.grade})`);
  });
});

test('with very few games the starting grade still dominates', async () => {
  await withWorld({
    players: [{ name: 'Strong', seed: 8 }, { name: 'Weak', seed: 3 }, 'O'],
    nights: [{ date: '2026-01-05', teams: { Red: ['Strong', 'Weak'], Blue: ['O'] }, games: [{ a: 'Red', b: 'Blue', goals: [['Blue', 'O']] }] }],
  }, async app => {
    const s = stats(app);
    assert.ok(s.Strong.grade > s.Weak.grade + 2, 'seed difference should survive a single loss');
  });
});

test('open (unfinished) nights do not affect grades or stats', async () => {
  await withWorld({
    players: ['A', 'B'],
    nights: [{ date: '2026-01-05', finished: false, teams: { Red: ['A'], Blue: ['B'] }, games: [{ a: 'Red', b: 'Blue', goals: [['Red', 'A']] }] }],
  }, async app => {
    const s = stats(app);
    assert.equal(s.A.gp, 0);
    assert.equal(s.A.grade, 5);
  });
});

test('goals logged without a scorer still count for the team score but not for any player', async () => {
  await withWorld({
    players: ['A', 'B'],
    nights: [{ date: '2026-01-05', teams: { Red: ['A'], Blue: ['B'] }, games: [{ a: 'Red', b: 'Blue', goals: [['Red', null], ['Red', null]] }] }],
  }, async app => {
    const s = stats(app);
    assert.equal(s.A.g, 0);
    assert.equal(s.A.w, 1);
    assert.equal(s.B.l, 1);
    assert.equal(s.A.gf, 2);
  });
});
