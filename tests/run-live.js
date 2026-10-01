'use strict';
// Cross-platform launcher for the live database checks (sets LIVE_DB=1 and runs node's test runner).
const { spawnSync } = require('child_process');
const r = spawnSync(process.execPath, ['--test', 'tests/live-db.test.js'], { stdio: 'inherit', env: { ...process.env, LIVE_DB: '1' } });
process.exit(r.status ?? 1);
