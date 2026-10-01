'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers');

test('smoke: app boots in local mode with all tabs', async () => {
  const app = await loadApp();
  try {
    assert.deepEqual(app.nav(), ['⚽ Night', '📊 Stats', '👥 Players', '💾 Data', '⚙️ Settings']);
    assert.match(app.text(), /No night in progress/);
    assert.equal(app.doc.title, 'Monday Night Football');
    for (const t of ['stats', 'players', 'data', 'settings', 'night']) app.tab(t);
  } finally { await app.dispose(); }
});
