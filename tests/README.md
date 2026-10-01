# QA tests

Automated tests load the **real `index.html`** in a simulated browser (jsdom), click through the real screens, and check what a person would see. A fake database server (`helpers.js`) stands in for Supabase, so the tests are fast, free and never touch your real data.

## Run them
```bash
npm install          # once
npm test             # all automated tests (about 25 seconds)
npm run test:live    # optional: security checks against the REAL database (read-only, made-up group names)
```
Run one file: `node --test tests/night-flow.test.js`.
`LIVE_LOCKOUT=1 npm run test:live` also tests the password lock-out (leaves one harmless row in `app_attempts`).

## What is covered
| File | Covers |
|---|---|
| `grades.test.js` | stats counting (W/D/L, goals, assists, goal difference), grade formula, recency, clamping, unfinished nights ignored |
| `balance.test.js` | fair teams: sizes, parity over random line-ups, uneven numbers, variety on shuffle, uses current grades |
| `night-flow.test.js` | exact-player-count rule, regulars, Auto-balance, starting a night, goals/assists/undo, saving games, winner-stays suggestions, finishing/reopening/discarding, editing teams, substitutes (opt-in) |
| `stats-players.test.js` | stats table and sorting, period filters, awards, streaks, partners, player card, adding/editing/retiring/deleting players |
| `settings-timer.test.js` | every setting and its limits, the game timer (start/pause/resume/reset), full time, extra time, goal minutes (record, edit, clear) |
| `cloud.test.js` | sign-in, viewer vs admin, groups (create/rename/passwords), saving and conflicts, backups and restore, lock-out message, offline start-up |
| `sql.test.js` | SQL parses as valid PostgreSQL, null-password protection, helpers locked down, tables protected |
| `live-db.test.js` | (optional) the real database refuses wrong/missing passwords, hides its tables, hides helper functions |
| `smoke.test.js` | the app boots |

## Not automated (use `docs/QA-CHECKLIST.md`)
Anything that needs a real phone or human judgement: the buzzer sound, wake-lock, installing to the home screen, the share-card picture, layout on small screens, the feel of one-handed use at the pitch.

## Are the tests any good? Mutation check
Tests were verified by deliberately breaking the app 14 ways (removing the player-count rule, ignoring win rate in grades, letting viewers edit, breaking undo, etc.) and checking the suite fails each time. All 14 are caught. If you change core logic and no test fails, add one.

## Writing a new test
```js
const { loadApp, seedWorld } = require('./helpers');
const app = await loadApp();                       // add { mock: makeMockServer() } for signed-in tests
seedWorld(app, { players: ['A','B'], nights: [...] });   // build data without clicking
app.tab('stats'); app.act('sort', { k: 'name' });  // click like a user
assert.match(app.text(), /…/);                     // read what's on screen
app.ev('S.players.length');                        // peek at app state
await app.dispose();
```
