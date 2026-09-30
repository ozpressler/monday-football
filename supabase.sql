create table if not exists public.app_groups (
  name         text primary key,
  display_name text not null,
  data         jsonb not null default '{"players":[],"nights":[]}',
  version      int not null default 0,
  view_code    text not null,
  admin_code   text not null,
  public_view  boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.app_config (
  key   text primary key,
  value text not null
);

insert into public.app_config (key, value) values ('create_code', 'CHANGE-ME-CREATE-CODE')
on conflict (key) do nothing;

alter table public.app_groups enable row level security;
alter table public.app_config enable row level security;

do $$
begin
  if to_regclass('public.app_state') is not null then
    insert into public.app_groups (name, display_name, data, version, view_code, admin_code, public_view)
    select lower('CHANGE-ME-GROUP-NAME'), 'CHANGE-ME-GROUP-NAME', data, version, view_code, admin_code, public_view
    from public.app_state where id = 1
    on conflict (name) do nothing;
  end if;
end $$;

drop function if exists public.get_state(text);
drop function if exists public.save_state(text, jsonb, int);

create or replace function public.get_state(p_group text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.app_groups;
  c text := coalesce(p_code, '');
begin
  select * into r from public.app_groups where name = lower(trim(coalesce(p_group, '')));
  if not found then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if not (r.public_view or c = r.view_code or c = r.admin_code) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return jsonb_build_object('data', r.data, 'version', r.version, 'admin', c = r.admin_code, 'name', r.display_name);
end $$;

create or replace function public.save_state(p_group text, p_code text, p_data jsonb, p_version int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.app_groups;
begin
  select * into r from public.app_groups where name = lower(trim(coalesce(p_group, ''))) for update;
  if not found or coalesce(p_code, '') <> r.admin_code then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if p_version is distinct from r.version then
    return jsonb_build_object('error', 'conflict', 'data', r.data, 'version', r.version);
  end if;
  update public.app_groups set data = p_data, version = version + 1, updated_at = now() where name = r.name;
  return jsonb_build_object('ok', true, 'version', r.version + 1);
end $$;

create or replace function public.create_group(p_name text, p_view_code text, p_admin_code text, p_create_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  need text;
  nm text := lower(trim(coalesce(p_name, '')));
begin
  select value into need from public.app_config where key = 'create_code';
  if need is not null and need <> '' and coalesce(p_create_code, '') <> need then
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

grant execute on function public.get_state(text, text) to anon;
grant execute on function public.save_state(text, text, jsonb, int) to anon;
grant execute on function public.create_group(text, text, text, text) to anon;

create or replace function public.rename_group(p_group text, p_code text, p_new_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.app_groups;
  nm text := lower(trim(coalesce(p_new_name, '')));
begin
  select * into r from public.app_groups where name = lower(trim(coalesce(p_group, ''))) for update;
  if not found or coalesce(p_code, '') <> r.admin_code then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if char_length(nm) < 2 or char_length(nm) > 40 then
    return jsonb_build_object('error', 'invalid');
  end if;
  update public.app_groups set name = nm, display_name = trim(p_new_name), updated_at = now() where name = r.name;
  return jsonb_build_object('ok', true, 'name', trim(p_new_name));
exception when unique_violation then
  return jsonb_build_object('error', 'exists');
end $$;

grant execute on function public.rename_group(text, text, text) to anon;
