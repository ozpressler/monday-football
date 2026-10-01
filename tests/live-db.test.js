'use strict';
// QA (optional, needs internet): security checks against the REAL Supabase project from config.js.
// Safe by design: it only uses wrong credentials against made-up group names, never reads or writes real data.
// Run with:  npm run test:live      (add LIVE_LOCKOUT=1 to also test the lock-out; leaves one junk row in app_attempts)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const live = process.env.LIVE_DB === '1';
const cfgText = fs.readFileSync(path.join(__dirname, '..', 'config.js'), 'utf8');
const URL_ = (cfgText.match(/url:\s*'([^']+)'/) || [])[1], KEY = (cfgText.match(/key:\s*'([^']+)'/) || [])[1];
const opts = { skip: !live ? 'set LIVE_DB=1 (npm run test:live) to run' : (!URL_ || !KEY ? 'config.js has no database settings' : false) };
const group = 'qa-' + Math.random().toString(36).slice(2, 10);

const rpc = async (fn, args) => {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  return { status: r.status, body: await r.json() };
};
const forbidden = r => assert.deepEqual(r.body, { error: 'forbidden' });

test('sign-in with an unknown group or wrong password is refused', opts, async () => {
  forbidden(await rpc('get_state', { p_group: group, p_code: 'wrong' }));
});

test('a MISSING password (null) is refused (regression: it once returned data)', opts, async () => {
  forbidden(await rpc('get_state', { p_group: group, p_code: null }));
  forbidden(await rpc('get_state', { p_group: group, p_code: '' }));
});

test('every admin function refuses wrong or missing admin passwords', opts, async () => {
  const g = group + 'b';
  for (const code of ['wrong', null, '']) {
    forbidden(await rpc('save_state', { p_group: g, p_code: code, p_data: {}, p_version: 0 }));
    forbidden(await rpc('rename_group', { p_group: g, p_code: code, p_new_name: 'hacked' }));
    forbidden(await rpc('change_codes', { p_group: g, p_code: code, p_new_view: 'aaaa', p_new_admin: 'bbbb' }));
    forbidden(await rpc('save_backup', { p_group: g, p_code: code, p_label: 'x', p_data: {} }));
    forbidden(await rpc('list_backups', { p_group: g, p_code: code }));
    forbidden(await rpc('get_backup', { p_group: g, p_code: code, p_id: 1 }));
  }
});

test('creating a group needs the creation code', opts, async () => {
  forbidden(await rpc('create_group', { p_name: group, p_view_code: 'aaaa', p_admin_code: 'bbbb', p_create_code: 'definitely-wrong' }));
});

test('internal helper functions cannot be called from outside', opts, async () => {
  for (const [fn, args] of [['_admin_ok', { k: 'x', c: 'y' }], ['_note_fail', { k: 'x' }], ['_is_locked', { k: 'x' }]]) {
    const r = await rpc(fn, args);
    assert.ok(r.status === 401 || r.status === 403 || r.status === 404 || /permission denied|not find|PGRST/i.test(JSON.stringify(r.body)), `${fn}: ${JSON.stringify(r.body)}`);
    assert.ok(!('error' in r.body && r.body.error === 'forbidden') && r.body !== true && r.body !== false, `${fn} must not run for anonymous callers`);
  }
});

test('tables cannot be read or written directly', opts, async () => {
  for (const t of ['app_groups', 'app_backups', 'app_attempts', 'app_config']) {
    const r = await fetch(`${URL_}/rest/v1/${t}?select=*`, { headers: { apikey: KEY } });
    const body = await r.json();
    assert.ok(Array.isArray(body) ? body.length === 0 : r.status >= 400, `${t} leaked: ${JSON.stringify(body).slice(0, 80)}`);
  }
  const w = await fetch(`${URL_}/rest/v1/app_groups`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ name: 'qa-direct', display_name: 'x', view_code: 'aaaa', admin_code: 'bbbb' }) });
  assert.ok(w.status >= 400, `direct insert should be refused, got ${w.status}`);
  const d = await fetch(`${URL_}/rest/v1/app_groups?name=neq.zzzz`, { method: 'DELETE', headers: { apikey: KEY, Prefer: 'return=representation' } });
  const dBody = await d.json().catch(() => null);
  assert.ok(d.status >= 400 || (Array.isArray(dBody) && dBody.length === 0), 'direct delete must not remove anything');
});

test('lock-out: 10 wrong tries lock that group name for a few minutes (opt-in: LIVE_LOCKOUT=1)', { skip: !live ? 'live only' : (process.env.LIVE_LOCKOUT !== '1' ? 'set LIVE_LOCKOUT=1 to run' : false) }, async () => {
  const g = group + 'lock';
  let last;
  for (let i = 0; i < 12; i++) last = (await rpc('get_state', { p_group: g, p_code: 'x' })).body.error;
  assert.equal(last, 'locked');
  forbidden(await rpc('get_state', { p_group: group + 'other', p_code: 'x' }));   // other names are unaffected
});
