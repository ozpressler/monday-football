'use strict';
// QA: the SQL files parse as valid PostgreSQL, and contain the security rules we rely on.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('SQL files are valid PostgreSQL (needs python + pglast; skipped otherwise)', t => {
  const py = ['python', 'python3', 'py'].find(c => spawnSync(c, ['-c', 'import pglast'], { encoding: 'utf8' }).status === 0);
  if (!py) return t.skip('python with pglast not installed (pip install pglast)');
  const r = spawnSync(py, [path.join(__dirname, 'check_sql.py'), path.join(root, 'supabase.sql'), path.join(root, 'supabase-update.sql')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('no real passwords or codes are committed in the SQL files (placeholders only)', () => {
  for (const f of ['supabase.sql', 'supabase-update.sql']) {
    const s = read(f);
    assert.ok(!/values\s*\(\s*1\s*,\s*'\d{4}'/i.test(s), f + ' contains numeric codes');
  }
  assert.match(read('supabase.sql'), /CHANGE-ME-CREATE-CODE/, 'the fresh-install file keeps the creation-code placeholder');
});

test('every function that returns group data or accepts an admin action checks the password safely', () => {
  const s = read('supabase-update.sql');
  // null passwords must be treated as empty, never as "matches"
  assert.match(s, /c text := coalesce\(p_code, ''\)/);
  assert.match(s, /coalesce\(c, ''\) <> r\.admin_code/);
  // admin functions go through the shared check that also counts failed attempts
  for (const fn of ['save_state', 'rename_group', 'change_codes', 'save_backup', 'list_backups', 'get_backup']) {
    const body = s.slice(s.indexOf(`function public.${fn}(`)).split('end $$;')[0];
    assert.match(body, /public\._admin_ok\(/, `${fn} must call _admin_ok`);
  }
  // failed sign-ins are counted and locked
  assert.match(s, /perform public\._note_fail\(k\)/);
  assert.match(s, /'locked'/);
});

test('helpers are not callable by anonymous users, tables have row-level security on', () => {
  const s = read('supabase-update.sql');
  for (const h of ['_note_fail', '_is_locked', '_admin_ok']) assert.match(s, new RegExp(`revoke all on function public\\.${h}\\(.*\\) from public, anon`));
  for (const t of ['app_backups', 'app_attempts']) assert.match(s, new RegExp(`alter table public\\.${t} enable row level security`));
  const full = read('supabase.sql');
  for (const t of ['app_groups', 'app_config']) assert.match(full, new RegExp(`alter table public\\.${t} enable row level security`));
});

test('supabase.sql (fresh install) contains everything supabase-update.sql does', () => {
  const full = read('supabase.sql'), upd = read('supabase-update.sql');
  assert.ok(full.includes(upd.trim()), 'the full file must include the whole update file');
});
