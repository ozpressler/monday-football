create table if not exists public.app_state (
  id          int primary key default 1 check (id = 1),
  data        jsonb   not null default '{"players":[],"nights":[]}',
  version     int     not null default 0,
  view_code   text    not null,
  admin_code  text    not null,
  public_view boolean not null default false,
  updated_at  timestamptz not null default now()
);

insert into public.app_state (id, view_code, admin_code)
values (1, '1974', '0987')
on conflict (id) do nothing;

alter table public.app_state enable row level security;

create or replace function public.get_state(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.app_state;
begin
  select * into r from public.app_state where id = 1;
  if not (r.public_view or p_code = r.view_code or p_code = r.admin_code) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return jsonb_build_object('data', r.data, 'version', r.version, 'admin', p_code = r.admin_code);
end $$;

create or replace function public.save_state(p_code text, p_data jsonb, p_version int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.app_state;
begin
  select * into r from public.app_state where id = 1 for update;
  if p_code is distinct from r.admin_code then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if p_version <> r.version then
    return jsonb_build_object('error', 'conflict', 'data', r.data, 'version', r.version);
  end if;
  update public.app_state set data = p_data, version = version + 1, updated_at = now() where id = 1;
  return jsonb_build_object('ok', true, 'version', r.version + 1);
end $$;

grant execute on function public.get_state(text) to anon;
grant execute on function public.save_state(text, jsonb, int) to anon;
