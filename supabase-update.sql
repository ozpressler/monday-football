create table if not exists public.app_backups (
  id         bigint generated always as identity primary key,
  grp        text not null,
  label      text not null default '',
  data       jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists app_backups_grp_idx on public.app_backups (grp, created_at desc);

create table if not exists public.app_attempts (
  grp          text primary key,
  fails        int not null default 0,
  window_start timestamptz,
  locked_until timestamptz
);

alter table public.app_backups enable row level security;
alter table public.app_attempts enable row level security;

create or replace function public._note_fail(k text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.app_attempts (grp, fails, window_start) values (k, 1, now())
  on conflict (grp) do update set
    fails = case when app_attempts.window_start is null or app_attempts.window_start < now() - interval '10 minutes'
                 then 1 else app_attempts.fails + 1 end,
    window_start = case when app_attempts.window_start is null or app_attempts.window_start < now() - interval '10 minutes'
                        then now() else app_attempts.window_start end;
  update public.app_attempts
    set locked_until = now() + interval '5 minutes', fails = 0, window_start = now()
    where grp = k and fails >= 10;
end $$;

create or replace function public._is_locked(k text)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from public.app_attempts where grp = k and locked_until is not null and locked_until > now());
$$;

create or replace function public._admin_ok(k text, c text)
returns boolean language plpgsql security definer set search_path = public as $$
declare r public.app_groups;
begin
  if public._is_locked(k) then
    return false;
  end if;
  select * into r from public.app_groups where name = k;
  if not found or coalesce(c, '') <> r.admin_code then
    perform public._note_fail(k);
    return false;
  end if;
  return true;
end $$;

create or replace function public.get_state(p_group text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k text := lower(trim(coalesce(p_group, '')));
  c text := coalesce(p_code, '');
  r public.app_groups;
begin
  if public._is_locked(k) then
    return jsonb_build_object('error', 'locked');
  end if;
  select * into r from public.app_groups where name = k;
  if not found or not (r.public_view or c = r.view_code or c = r.admin_code) then
    perform public._note_fail(k);
    return jsonb_build_object('error', 'forbidden');
  end if;
  return jsonb_build_object('data', r.data, 'version', r.version, 'admin', c = r.admin_code, 'name', r.display_name);
end $$;

create or replace function public.save_state(p_group text, p_code text, p_data jsonb, p_version int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k text := lower(trim(coalesce(p_group, '')));
  r public.app_groups;
begin
  if not public._admin_ok(k, p_code) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into r from public.app_groups where name = k for update;
  if p_version is distinct from r.version then
    return jsonb_build_object('error', 'conflict', 'data', r.data, 'version', r.version);
  end if;
  update public.app_groups set data = p_data, version = version + 1, updated_at = now() where name = k;
  return jsonb_build_object('ok', true, 'version', r.version + 1);
end $$;

create or replace function public.create_group(p_name text, p_view_code text, p_admin_code text, p_create_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  need text;
  nm text := lower(trim(coalesce(p_name, '')));
begin
  if public._is_locked('*create*') then
    return jsonb_build_object('error', 'locked');
  end if;
  select value into need from public.app_config where key = 'create_code';
  if need is not null and need <> '' and coalesce(p_create_code, '') <> need then
    perform public._note_fail('*create*');
    return jsonb_build_object('error', 'forbidden');
  end if;
  if char_length(nm) < 2 or char_length(nm) > 40
     or char_length(coalesce(p_admin_code, '')) < 4 or char_length(coalesce(p_view_code, '')) < 4
     or p_admin_code = p_view_code then
    return jsonb_build_object('error', 'invalid');
  end if;
  insert into public.app_groups (name, display_name, view_code, admin_code)
  values (nm, trim(p_name), p_view_code, p_admin_code);
  return jsonb_build_object('ok', true);
exception when unique_violation then
  return jsonb_build_object('error', 'exists');
end $$;

create or replace function public.rename_group(p_group text, p_code text, p_new_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k text := lower(trim(coalesce(p_group, '')));
  nm text := lower(trim(coalesce(p_new_name, '')));
begin
  if not public._admin_ok(k, p_code) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if char_length(nm) < 2 or char_length(nm) > 40 then
    return jsonb_build_object('error', 'invalid');
  end if;
  update public.app_groups set name = nm, display_name = trim(p_new_name), updated_at = now() where name = k;
  update public.app_backups set grp = nm where grp = k;
  return jsonb_build_object('ok', true, 'name', trim(p_new_name));
exception when unique_violation then
  return jsonb_build_object('error', 'exists');
end $$;

create or replace function public.change_codes(p_group text, p_code text, p_new_view text, p_new_admin text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k text := lower(trim(coalesce(p_group, '')));
  nv text := nullif(trim(coalesce(p_new_view, '')), '');
  na text := nullif(trim(coalesce(p_new_admin, '')), '');
  r public.app_groups;
begin
  if not public._admin_ok(k, p_code) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into r from public.app_groups where name = k for update;
  if (nv is not null and char_length(nv) < 4) or (na is not null and char_length(na) < 4) then
    return jsonb_build_object('error', 'invalid');
  end if;
  if coalesce(nv, r.view_code) = coalesce(na, r.admin_code) then
    return jsonb_build_object('error', 'same');
  end if;
  update public.app_groups
    set view_code = coalesce(nv, view_code), admin_code = coalesce(na, admin_code), updated_at = now()
    where name = k;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.save_backup(p_group text, p_code text, p_label text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k text := lower(trim(coalesce(p_group, '')));
begin
  if not public._admin_ok(k, p_code) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  insert into public.app_backups (grp, label, data) values (k, left(coalesce(p_label, ''), 120), p_data);
  delete from public.app_backups
    where grp = k and id not in (select id from public.app_backups where grp = k order by created_at desc, id desc limit 25);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.list_backups(p_group text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k text := lower(trim(coalesce(p_group, '')));
begin
  if not public._admin_ok(k, p_code) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id, 'label', b.label, 'created_at', b.created_at,
      'players', jsonb_array_length(coalesce(b.data -> 'players', '[]'::jsonb)),
      'nights', jsonb_array_length(coalesce(b.data -> 'nights', '[]'::jsonb))
    ) order by b.created_at desc, b.id desc)
    from public.app_backups b where b.grp = k
  ), '[]'::jsonb));
end $$;

create or replace function public.get_backup(p_group text, p_code text, p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k text := lower(trim(coalesce(p_group, '')));
  d jsonb;
begin
  if not public._admin_ok(k, p_code) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select data into d from public.app_backups where id = p_id and grp = k;
  if d is null then
    return jsonb_build_object('error', 'notfound');
  end if;
  return jsonb_build_object('data', d);
end $$;

revoke all on function public._note_fail(text) from public, anon;
revoke all on function public._is_locked(text) from public, anon;
revoke all on function public._admin_ok(text, text) from public, anon;

grant execute on function public.get_state(text, text) to anon;
grant execute on function public.save_state(text, text, jsonb, int) to anon;
grant execute on function public.create_group(text, text, text, text) to anon;
grant execute on function public.rename_group(text, text, text) to anon;
grant execute on function public.change_codes(text, text, text, text) to anon;
grant execute on function public.save_backup(text, text, text, jsonb) to anon;
grant execute on function public.list_backups(text, text) to anon;
grant execute on function public.get_backup(text, text, bigint) to anon;
