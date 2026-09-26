-- Couch-Dungeon: Grundschema (Teil B1)
-- Räume, Spieler, Spielstand, geheime Wahrheit, Ereignis-Log
-- + Zugriffsregeln (RLS) für Tabellen und private Realtime-Kanäle.
--
-- Kanäle:
--   room:{CODE}              -> alle im Raum (Broadcast + Presence)
--   room:{CODE}:p:{user_id}  -> nur dieser Spieler + Host (geheime Nachrichten, Wurfaufforderungen)

-- ---------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------

create table public.rooms (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique
                check (code ~ '^[A-HJ-NP-Z2-9]{4}$'),          -- 4 Zeichen, ohne 0/O/1/I
  host_user_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  status        text not null default 'lobby'
                check (status in ('lobby', 'playing', 'paused', 'finished')),
  story_id      text,
  duration      text check (duration in ('kurz', 'mittel', 'lang')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.players (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 24),
  class       text,
  color       text,
  appearance  jsonb not null default '{}'::jsonb,   -- Figur-Baukasten
  sheet       jsonb not null default '{}'::jsonb,   -- Charakterbogen (schreibt der Host)
  joined_at   timestamptz not null default now(),
  unique (room_id, user_id)
);

-- Öffentlicher Spielstand: alles, was Spieler sehen dürfen
create table public.game_states (
  room_id     uuid primary key references public.rooms (id) on delete cascade,
  state       jsonb not null default '{}'::jsonb,
  version     integer not null default 0,
  updated_at  timestamptz not null default now()
);

-- Geheime Wahrheit, Hinweise, NPC-Ziele: NUR der Host darf das lesen
create table public.game_secrets (
  room_id     uuid primary key references public.rooms (id) on delete cascade,
  secret      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

create table public.event_log (
  id          bigint generated always as identity primary key,
  room_id     uuid not null references public.rooms (id) on delete cascade,
  type        text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index players_room_id_idx   on public.players (room_id);
create index players_user_id_idx   on public.players (user_id);
create index rooms_host_idx        on public.rooms (host_user_id);
create index event_log_room_idx    on public.event_log (room_id, created_at);

-- ---------------------------------------------------------------
-- Hilfsfunktionen (security definer, damit RLS sich nicht selbst blockiert)
-- ---------------------------------------------------------------

create or replace function public.is_room_host(p_room_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.rooms r
    where r.id = p_room_id and r.host_user_id = (select auth.uid())
  );
$$;

create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_room_host(p_room_id)
      or exists (
        select 1 from public.players p
        where p.room_id = p_room_id and p.user_id = (select auth.uid())
      );
$$;

-- Beitreten per Raum-Code (Handys kennen nur den Code, nicht die Raum-ID)
create or replace function public.join_room(
  p_code text, p_name text, p_class text default null,
  p_color text default null, p_appearance jsonb default '{}'::jsonb
)
returns public.players
language plpgsql security definer set search_path = ''
as $$
declare
  v_room   public.rooms;
  v_player public.players;
  v_count  integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Nicht angemeldet';
  end if;

  select * into v_room from public.rooms where code = upper(p_code);
  if not found then
    raise exception 'Raum nicht gefunden';
  end if;

  -- Wiedereintritt: gleicher Nutzer bekommt seinen alten Platz
  select * into v_player from public.players
   where room_id = v_room.id and user_id = (select auth.uid());
  if found then
    update public.players
       set name = p_name,
           class = coalesce(p_class, class),
           color = coalesce(p_color, color),
           appearance = coalesce(p_appearance, appearance)
     where id = v_player.id
     returning * into v_player;
    return v_player;
  end if;

  if v_room.status <> 'lobby' then
    raise exception 'Das Spiel läuft schon';
  end if;

  select count(*) into v_count from public.players where room_id = v_room.id;
  if v_count >= 4 then
    raise exception 'Der Raum ist voll (max. 4 Spieler)';
  end if;

  insert into public.players (room_id, user_id, name, class, color, appearance)
  values (v_room.id, (select auth.uid()), p_name, p_class, p_color, coalesce(p_appearance, '{}'::jsonb))
  returning * into v_player;

  return v_player;
end;
$$;

-- Realtime-Topic -> darf der aktuelle Nutzer rein?
create or replace function public.can_access_topic(p_topic text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_parts   text[] := string_to_array(p_topic, ':');
  v_room_id uuid;
begin
  if v_parts[1] <> 'room' or array_length(v_parts, 1) not in (2, 4) then
    return false;
  end if;

  select id into v_room_id from public.rooms where code = v_parts[2];
  if v_room_id is null then
    return false;
  end if;

  -- room:{CODE}
  if array_length(v_parts, 1) = 2 then
    return public.is_room_member(v_room_id);
  end if;

  -- room:{CODE}:p:{user_id}  -> nur dieser Spieler oder der Host
  if v_parts[3] = 'p' then
    return public.is_room_host(v_room_id)
        or v_parts[4] = (select auth.uid())::text;
  end if;

  return false;
end;
$$;

-- updated_at automatisch pflegen
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger rooms_touch        before update on public.rooms        for each row execute function public.touch_updated_at();
create trigger game_states_touch  before update on public.game_states  for each row execute function public.touch_updated_at();
create trigger game_secrets_touch before update on public.game_secrets for each row execute function public.touch_updated_at();

-- Rechte der Hilfsfunktionen: nur angemeldete Nutzer
revoke execute on function public.is_room_host(uuid)       from public, anon;
revoke execute on function public.is_room_member(uuid)     from public, anon;
revoke execute on function public.can_access_topic(text)   from public, anon;
revoke execute on function public.join_room(text, text, text, text, jsonb) from public, anon;
grant  execute on function public.is_room_host(uuid)       to authenticated;
grant  execute on function public.is_room_member(uuid)     to authenticated;
grant  execute on function public.can_access_topic(text)   to authenticated;
grant  execute on function public.join_room(text, text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------
-- Row Level Security
-- (Anonyme Anmeldung zählt als Rolle "authenticated")
-- ---------------------------------------------------------------

alter table public.rooms        enable row level security;
alter table public.players      enable row level security;
alter table public.game_states  enable row level security;
alter table public.game_secrets enable row level security;
alter table public.event_log    enable row level security;

-- rooms
create policy "Mitglieder sehen ihren Raum" on public.rooms
  for select to authenticated using (public.is_room_member(id));
create policy "Jeder kann einen Raum als Host anlegen" on public.rooms
  for insert to authenticated with check (host_user_id = (select auth.uid()));
create policy "Host ändert seinen Raum" on public.rooms
  for update to authenticated using (host_user_id = (select auth.uid()))
  with check (host_user_id = (select auth.uid()));
create policy "Host löscht seinen Raum" on public.rooms
  for delete to authenticated using (host_user_id = (select auth.uid()));

-- players (Beitritt nur über join_room)
create policy "Mitglieder sehen Mitspieler" on public.players
  for select to authenticated using (public.is_room_member(room_id));
create policy "Host verwaltet Spieler" on public.players
  for update to authenticated using (public.is_room_host(room_id))
  with check (public.is_room_host(room_id));
create policy "Spieler verlässt Raum oder Host entfernt ihn" on public.players
  for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_room_host(room_id));

-- game_states
create policy "Mitglieder lesen Spielstand" on public.game_states
  for select to authenticated using (public.is_room_member(room_id));
create policy "Host legt Spielstand an" on public.game_states
  for insert to authenticated with check (public.is_room_host(room_id));
create policy "Host schreibt Spielstand" on public.game_states
  for update to authenticated using (public.is_room_host(room_id))
  with check (public.is_room_host(room_id));

-- game_secrets: ausschließlich Host
create policy "Nur Host liest Geheimnisse" on public.game_secrets
  for select to authenticated using (public.is_room_host(room_id));
create policy "Nur Host legt Geheimnisse an" on public.game_secrets
  for insert to authenticated with check (public.is_room_host(room_id));
create policy "Nur Host ändert Geheimnisse" on public.game_secrets
  for update to authenticated using (public.is_room_host(room_id))
  with check (public.is_room_host(room_id));

-- event_log
create policy "Mitglieder lesen Log" on public.event_log
  for select to authenticated using (public.is_room_member(room_id));
create policy "Host schreibt Log" on public.event_log
  for insert to authenticated with check (public.is_room_host(room_id));

-- ---------------------------------------------------------------
-- Realtime: private Kanäle (Broadcast + Presence)
-- ---------------------------------------------------------------

create policy "Raum-Mitglieder empfangen" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.can_access_topic((select realtime.topic()))
  );

create policy "Raum-Mitglieder senden" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.can_access_topic((select realtime.topic()))
  );

-- ---------------------------------------------------------------
-- Aufräumen: Räume älter als 24 h (per pg_cron, falls aktiviert)
-- ---------------------------------------------------------------

create or replace function public.cleanup_old_rooms()
returns void language sql security definer set search_path = ''
as $$
  delete from public.rooms where updated_at < now() - interval '24 hours';
$$;
revoke execute on function public.cleanup_old_rooms() from public, anon, authenticated;
