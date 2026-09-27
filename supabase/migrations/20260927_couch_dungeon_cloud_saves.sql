-- Couch-Dungeon cloud save games (applied to the project via MCP).
-- Own schema, not exposed through the API: only the two functions below reach it.
create schema if not exists couch_dungeon;
revoke all on schema couch_dungeon from public, anon, authenticated;

create table if not exists couch_dungeon.saves (
  code text primary key check (code ~ '^[A-Z0-9]{8}$'),
  data jsonb not null,
  updated_at timestamptz not null default now(),
  -- Only the device that made a save may overwrite it (sha256 of its secret token).
  token_hash text
);
alter table couch_dungeon.saves enable row level security;
revoke all on couch_dungeon.saves from public, anon, authenticated;

create or replace function public.couch_dungeon_save(p_code text, p_token text, p_data jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  h text;
begin
  if p_code !~ '^[A-Z0-9]{8}$' then
    raise exception 'bad code';
  end if;
  if length(coalesce(p_token, '')) < 16 then
    raise exception 'bad token';
  end if;
  if pg_column_size(p_data) > 400000 then
    raise exception 'save too large';
  end if;
  h := encode(extensions.digest(p_token, 'sha256'), 'hex');
  insert into couch_dungeon.saves (code, data, updated_at, token_hash)
  values (p_code, p_data, now(), h)
  on conflict (code) do update set data = excluded.data, updated_at = now()
    where couch_dungeon.saves.token_hash = h;
  if not found then
    return false;
  end if;
  if random() < 0.02 then
    delete from couch_dungeon.saves where updated_at < now() - interval '120 days';
  end if;
  return true;
end;
$$;

create or replace function public.couch_dungeon_load(p_code text)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select data from couch_dungeon.saves where code = upper(p_code);
$$;

revoke all on function public.couch_dungeon_save(text, text, jsonb) from public;
revoke all on function public.couch_dungeon_load(text) from public;
grant execute on function public.couch_dungeon_save(text, text, jsonb) to anon, authenticated;
grant execute on function public.couch_dungeon_load(text) to anon, authenticated;
