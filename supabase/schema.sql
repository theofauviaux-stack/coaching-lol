-- Coaching LoL : base en ligne (Supabase / PostgreSQL)
-- À exécuter une fois dans Supabase › SQL Editor (le script peut être relancé sans risque).
--
-- Principe
--   * L'app du coach (seule à parler à l'API Riot) envoie un instantané complet des données
--     avec la clé secrète du projet : fonction admin_push, interdite aux autres.
--   * L'app d'un joueur se connecte avec son code à 4 chiffres (fonction login), reçoit un jeton,
--     puis lit uniquement ses données (fonction get_data). Le code coach donne accès à tous les joueurs.
--   * Les tables ne sont pas lisibles directement (RLS activée, aucune règle d'accès) :
--     tout passe par ces fonctions.
--   * Contre les essais au hasard : 8 codes faux par adresse IP et 60 au total en 15 minutes, puis blocage.

create table if not exists public.app_secret (
  id int primary key default 1 check (id = 1),
  pepper text not null
);
insert into public.app_secret (id, pepper)
values (1, encode(sha256((gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text)::bytea), 'hex'))
on conflict (id) do nothing;

create table if not exists public.coach (
  id int primary key default 1 check (id = 1),
  code_hash text
);

create table if not exists public.players (
  id text primary key,
  riot_id text not null,
  code_hash text unique,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.games (
  player_id text not null references public.players(id) on delete cascade,
  match_id text not null,
  date bigint,
  data jsonb not null,
  primary key (player_id, match_id)
);

create table if not exists public.ranks (
  player_id text not null references public.players(id) on delete cascade,
  date bigint not null,
  data jsonb not null,
  primary key (player_id, date)
);

create table if not exists public.sessions (
  id text primary key,
  player_id text not null references public.players(id) on delete cascade,
  data jsonb not null
);

create table if not exists public.auth_tokens (
  token_hash text primary key,
  role text not null,
  player_id text,
  expires_at timestamptz not null
);

create table if not exists public.login_attempts (
  id bigserial primary key,
  ip text not null,
  ok boolean not null,
  at timestamptz not null default now()
);
create index if not exists login_attempts_at on public.login_attempts (at);

create table if not exists public.meta (
  id int primary key default 1 check (id = 1),
  pushed_at timestamptz,
  settings jsonb not null default '{}'::jsonb
);
alter table public.meta add column if not exists settings jsonb not null default '{}'::jsonb;

alter table public.app_secret enable row level security;
alter table public.coach enable row level security;
alter table public.players enable row level security;
alter table public.games enable row level security;
alter table public.ranks enable row level security;
alter table public.sessions enable row level security;
alter table public.auth_tokens enable row level security;
alter table public.login_attempts enable row level security;
alter table public.meta enable row level security;

-- empreinte d'un code (le « poivre » est secret et propre à ce projet)
create or replace function public.hash_code(p_code text) returns text
language sql stable security definer set search_path = public as $$
  select encode(sha256((pepper || ':' || p_code)::bytea), 'hex') from public.app_secret where id = 1
$$;

-- Envoi complet des données par l'app du coach (clé secrète uniquement)
create or replace function public.admin_push(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p->>'coachCode', '') ~ '^[0-9]{4}$' then
    insert into coach (id, code_hash) values (1, hash_code(p->>'coachCode'))
    on conflict (id) do update set code_hash = excluded.code_hash;
  end if;

  delete from sessions where true;
  delete from ranks where true;
  delete from games where true;
  -- joueurs : on garde les lignes existantes (leurs réservations y sont rattachées), on retire les supprimés
  delete from players where id not in (select x->>'id' from jsonb_array_elements(coalesce(p->'players', '[]'::jsonb)) x);
  update players set code_hash = null where true; -- évite un conflit passager si deux joueurs échangent leurs codes
  insert into players (id, riot_id, code_hash, data, updated_at)
  select x->>'id', x->>'riotId',
         case when coalesce(x->>'code', '') ~ '^[0-9]{4}$' then hash_code(x->>'code') end,
         x - 'code', now()
  from jsonb_array_elements(coalesce(p->'players', '[]'::jsonb)) x
  on conflict (id) do update set riot_id = excluded.riot_id, code_hash = excluded.code_hash, data = excluded.data, updated_at = now();

  insert into games (player_id, match_id, date, data)
  select x->>'playerId', x->>'matchId', (x->>'date')::bigint, x
  from jsonb_array_elements(coalesce(p->'games', '[]'::jsonb)) x
  where x->>'playerId' in (select id from players)
  on conflict do nothing;

  insert into ranks (player_id, date, data)
  select x->>'playerId', (x->>'date')::bigint, x
  from jsonb_array_elements(coalesce(p->'ranks', '[]'::jsonb)) x
  where x->>'playerId' in (select id from players)
  on conflict do nothing;

  insert into sessions (id, player_id, data)
  select x->>'id', x->>'playerId', x
  from jsonb_array_elements(coalesce(p->'sessions', '[]'::jsonb)) x
  where x->>'playerId' in (select id from players)
  on conflict do nothing;

  insert into meta (id, pushed_at, settings) values (1, now(), coalesce(p->'settings', '{}'::jsonb))
  on conflict (id) do update set pushed_at = now(), settings = excluded.settings;
  return jsonb_build_object('ok', true, 'players', (select count(*) from players), 'games', (select count(*) from games));
end $$;

-- Connexion avec un code à 4 chiffres
create or replace function public.login(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ip text;
  v_fails_ip int;
  v_fails_all int;
  v_hash text;
  v_role text;
  v_player text;
  v_token text;
begin
  v_ip := trim(split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1));
  if v_ip = '' then v_ip := 'inconnue'; end if;

  select count(*) into v_fails_ip from login_attempts where ip = v_ip and not ok and at > now() - interval '15 minutes';
  select count(*) into v_fails_all from login_attempts where not ok and at > now() - interval '15 minutes';
  if v_fails_ip >= 8 or v_fails_all >= 60 then
    return jsonb_build_object('error', 'trop_essais');
  end if;

  if coalesce(p_code, '') ~ '^[0-9]{4}$' then
    v_hash := hash_code(p_code);
    if exists (select 1 from coach where id = 1 and code_hash = v_hash) then
      v_role := 'coach';
    else
      select id into v_player from players where code_hash = v_hash;
      if v_player is not null then v_role := 'joueur'; end if;
    end if;
  end if;

  insert into login_attempts (ip, ok) values (v_ip, v_role is not null);
  delete from login_attempts where at < now() - interval '1 day';
  if v_role is null then
    return jsonb_build_object('error', 'code_inconnu');
  end if;

  v_token := encode(sha256((gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text)::bytea), 'hex');
  delete from auth_tokens where expires_at < now();
  insert into auth_tokens (token_hash, role, player_id, expires_at)
  values (encode(sha256(v_token::bytea), 'hex'), v_role, v_player, now() + interval '30 days');
  return jsonb_build_object('token', v_token, 'role', v_role, 'playerId', v_player);
end $$;

-- Lecture des données autorisées pour ce jeton
create or replace function public.get_data(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_role text;
  v_player text;
begin
  select role, player_id into v_role, v_player
  from auth_tokens where token_hash = encode(sha256(coalesce(p_token, '')::bytea), 'hex') and expires_at > now();
  if v_role is null then
    return jsonb_build_object('error', 'session_expiree');
  end if;
  return jsonb_build_object(
    'role', v_role,
    'playerId', v_player,
    'pushedAt', (select pushed_at from meta where id = 1),
    'settings', (select settings from meta where id = 1),
    'players', (select coalesce(jsonb_agg(data || jsonb_build_object('id', id, 'riotId', riot_id)), '[]'::jsonb) from players where v_role = 'coach' or id = v_player),
    'games', (select coalesce(jsonb_agg(data order by date), '[]'::jsonb) from games where v_role = 'coach' or player_id = v_player),
    'ranks', (select coalesce(jsonb_agg(data order by date), '[]'::jsonb) from ranks where v_role = 'coach' or player_id = v_player),
    'sessions', (select coalesce(jsonb_agg(data), '[]'::jsonb) from sessions where v_role = 'coach' or player_id = v_player)
  );
end $$;

create or replace function public.logout(p_token text) returns void
language sql security definer set search_path = public as $$
  delete from auth_tokens where token_hash = encode(sha256(coalesce(p_token, '')::bytea), 'hex')
$$;

-- Envoi par l'app du coach sans clé secrète : l'app génère elle-même un jeton aléatoire (256 bits)
-- et seule son empreinte est enregistrée ici (table push_keys, remplie depuis le SQL Editor).
create table if not exists public.push_keys (
  hash text primary key,
  label text,
  created_at timestamptz not null default now()
);
alter table public.push_keys enable row level security;

create or replace function public.coach_push(p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from push_keys where hash = encode(sha256(coalesce(p_key, '')::bytea), 'hex')) then
    return jsonb_build_object('error', 'jeton_inconnu');
  end if;
  return admin_push(p);
end $$;

-- ============================================================ Réservations de coaching
-- Créneaux d'1 h, de 17 h à minuit (heure de Paris), jusqu'à 30 jours à l'avance, 2 h maximum par joueur et par jour.
-- Statuts : en_attente (demande du joueur) → acceptee | proposee (le coach propose un autre horaire)
--           proposee → acceptee | refusee (réponse du joueur) ; acceptee → en_cours (bouton Démarrer) → terminee ;
--           annulee, expiree (demande restée sans réponse jusqu'à l'heure du créneau).
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  player_id text not null references public.players(id) on delete cascade,
  start_at timestamptz not null,
  proposed_start timestamptz,
  status text not null default 'en_attente',
  started_at timestamptz,
  duration_min int not null default 60,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.bookings enable row level security;
create index if not exists bookings_start on public.bookings (start_at);

create or replace function public._slot(b public.bookings) returns timestamptz
language sql immutable as $$ select case when b.status = 'proposee' then b.proposed_start else b.start_at end $$;

create or replace function public._slot_ok(p_start timestamptz) returns boolean
language sql stable as $$
  select p_start > now() and p_start < now() + interval '30 days'
     and extract(minute from p_start at time zone 'Europe/Paris') = 0
     and extract(second from p_start at time zone 'Europe/Paris') = 0
     and extract(hour from p_start at time zone 'Europe/Paris') between 17 and 23
$$;

-- créneau libre (aucune réservation active d'un joueur, quelle qu'elle soit, sur ce créneau)
create or replace function public._slot_free(p_start timestamptz, p_except uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from bookings b where b.id is distinct from p_except
    and b.status in ('en_attente', 'proposee', 'acceptee', 'en_cours') and _slot(b) = p_start)
$$;

-- heures déjà réservées par ce joueur le même jour (heure de Paris)
create or replace function public._day_hours(p_player text, p_start timestamptz, p_except uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from bookings b where b.player_id = p_player and b.id is distinct from p_except
    and b.status in ('en_attente', 'proposee', 'acceptee', 'en_cours')
    and (_slot(b) at time zone 'Europe/Paris')::date = (p_start at time zone 'Europe/Paris')::date
$$;

-- ménage : demandes dépassées, séances oubliées
create or replace function public._bookings_tidy() returns void
language sql security definer set search_path = public as $$
  update bookings set status = 'expiree', updated_at = now() where status in ('en_attente', 'proposee') and _slot(bookings) <= now();
  update bookings set status = 'terminee', updated_at = now() where status = 'en_cours' and started_at < now() - interval '3 hours';
$$;

create or replace function public._booking_json(b public.bookings, p_with_player boolean) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', b.id, 'start', b.start_at, 'proposed', b.proposed_start, 'status', b.status,
    'startedAt', b.started_at, 'duration', b.duration_min, 'createdAt', b.created_at)
    || case when p_with_player then jsonb_build_object('playerId', b.player_id) else '{}'::jsonb end
$$;

create or replace function public._player_of(p_token text) returns text
language sql stable security definer set search_path = public as $$
  select player_id from auth_tokens where token_hash = encode(sha256(coalesce(p_token, '')::bytea), 'hex')
    and expires_at > now() and role = 'joueur'
$$;
create or replace function public._coach_ok(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from push_keys where hash = encode(sha256(coalesce(p_key, '')::bytea), 'hex'))
$$;

-- actions d'un joueur (appelées avec son jeton, ou par l'app du coach pour un joueur connecté sur son ordinateur)
create or replace function public._player_action(p_player text, p_action text, p_id uuid, p_start timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b bookings;
begin
  if p_player is null then return jsonb_build_object('error', 'session_expiree'); end if;
  perform pg_advisory_xact_lock(4242);
  perform _bookings_tidy();
  if p_action = 'demander' then
    if not _slot_ok(p_start) then return jsonb_build_object('error', 'creneau_invalide'); end if;
    if not _slot_free(p_start, null) then return jsonb_build_object('error', 'creneau_pris'); end if;
    if _day_hours(p_player, p_start, null) >= 2 then return jsonb_build_object('error', 'max_jour'); end if;
    if (select count(*) from bookings where player_id = p_player and status in ('en_attente', 'proposee', 'acceptee')) >= 8 then
      return jsonb_build_object('error', 'trop_de_reservations');
    end if;
    insert into bookings (player_id, start_at) values (p_player, p_start) returning * into b;
    return _booking_json(b, false);
  end if;
  select * into b from bookings where id = p_id and player_id = p_player;
  if b.id is null then return jsonb_build_object('error', 'reservation_inconnue'); end if;
  if p_action = 'annuler' and b.status in ('en_attente', 'proposee', 'acceptee') then
    update bookings set status = 'annulee', updated_at = now() where id = b.id returning * into b;
  elsif p_action in ('accepter_proposition', 'refuser_proposition') and b.status = 'proposee' then
    if p_action = 'refuser_proposition' then
      update bookings set status = 'refusee', updated_at = now() where id = b.id returning * into b;
    elsif not _slot_ok(b.proposed_start) or not _slot_free(b.proposed_start, b.id) then
      return jsonb_build_object('error', 'creneau_pris');
    else
      update bookings set status = 'acceptee', start_at = proposed_start, proposed_start = null, updated_at = now() where id = b.id returning * into b;
    end if;
  else
    return jsonb_build_object('error', 'action_impossible');
  end if;
  return _booking_json(b, false);
end $$;

create or replace function public.book(p_token text, p_action text, p_id uuid default null, p_start timestamptz default null) returns jsonb
language sql security definer set search_path = public as $$ select _player_action(_player_of(p_token), p_action, p_id, p_start) $$;

-- réservations d'un joueur + créneaux pris par les autres (sans dire par qui)
create or replace function public.bookings_mine(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_player text := _player_of(p_token);
begin
  if v_player is null then return jsonb_build_object('error', 'session_expiree'); end if;
  perform _bookings_tidy();
  return jsonb_build_object(
    'mine', (select coalesce(jsonb_agg(_booking_json(b, false) order by b.start_at), '[]'::jsonb) from bookings b
             where b.player_id = v_player and (b.start_at > now() - interval '2 days' or b.status = 'en_cours')),
    'busy', (select coalesce(jsonb_agg(_slot(b)), '[]'::jsonb) from bookings b
             where b.player_id <> v_player and b.status in ('en_attente', 'proposee', 'acceptee', 'en_cours') and _slot(b) > now() - interval '1 hour'));
end $$;

-- côté coach (jeton d'envoi de son ordinateur)
create or replace function public.coach_bookings(p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not _coach_ok(p_key) then return jsonb_build_object('error', 'jeton_inconnu'); end if;
  perform _bookings_tidy();
  return jsonb_build_object('all', (select coalesce(jsonb_agg(_booking_json(b, true) order by b.start_at), '[]'::jsonb) from bookings b
    where b.start_at > now() - interval '2 days' or b.status = 'en_cours'));
end $$;

create or replace function public.coach_book(p_key text, p_action text, p_id uuid default null, p_start timestamptz default null, p_player text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b bookings;
begin
  if not _coach_ok(p_key) then return jsonb_build_object('error', 'jeton_inconnu'); end if;
  -- le coach agit pour un joueur connecté sur son ordinateur
  if p_action in ('demander', 'annuler_joueur', 'accepter_proposition', 'refuser_proposition') then
    return _player_action(p_player, case when p_action = 'annuler_joueur' then 'annuler' else p_action end, p_id, p_start);
  end if;
  perform pg_advisory_xact_lock(4242);
  perform _bookings_tidy();
  select * into b from bookings where id = p_id;
  if b.id is null then return jsonb_build_object('error', 'reservation_inconnue'); end if;
  if p_action = 'accepter' and b.status = 'en_attente' then
    update bookings set status = 'acceptee', updated_at = now() where id = b.id returning * into b;
  elsif p_action = 'proposer' and b.status in ('en_attente', 'acceptee', 'proposee') then
    if not _slot_ok(p_start) then return jsonb_build_object('error', 'creneau_invalide'); end if;
    if not _slot_free(p_start, b.id) then return jsonb_build_object('error', 'creneau_pris'); end if;
    if _day_hours(b.player_id, p_start, b.id) >= 2 then return jsonb_build_object('error', 'max_jour'); end if;
    update bookings set status = 'proposee', proposed_start = p_start, updated_at = now() where id = b.id returning * into b;
  elsif p_action = 'annuler' and b.status in ('en_attente', 'proposee', 'acceptee') then
    update bookings set status = 'annulee', updated_at = now() where id = b.id returning * into b;
  elsif p_action = 'demarrer' and b.status = 'acceptee' then
    -- possible de 30 min avant le créneau jusqu'à sa fin ; un créneau accepté qui suit immédiatement est inclus (séance de 2 h)
    if now() < b.start_at - interval '30 minutes' or now() > b.start_at + interval '1 hour' then
      return jsonb_build_object('error', 'trop_tot');
    end if;
    update bookings set status = 'en_cours', started_at = now(), updated_at = now()
      where player_id = b.player_id and status = 'acceptee' and start_at in (b.start_at, b.start_at + interval '1 hour');
    select * into b from bookings where id = b.id;
  elsif p_action = 'terminer' and b.status = 'en_cours' then
    update bookings set status = 'terminee', updated_at = now() where player_id = b.player_id and status = 'en_cours';
    select * into b from bookings where id = b.id;
  else
    return jsonb_build_object('error', 'action_impossible');
  end if;
  return _booking_json(b, true);
end $$;

-- Droits : login / get_data / logout / coach_push sont ouvertes au public (coach_push exige un jeton enregistré) ;
-- admin_push est réservée à la clé secrète.
revoke all on function public.hash_code(text) from public, anon, authenticated;
revoke all on function public.admin_push(jsonb) from public, anon, authenticated;
grant execute on function public.admin_push(jsonb) to service_role;
grant execute on function public.login(text) to anon, authenticated;
grant execute on function public.get_data(text) to anon, authenticated;
grant execute on function public.logout(text) to anon, authenticated;
revoke all on function public.coach_push(text, jsonb) from public;
grant execute on function public.coach_push(text, jsonb) to anon, authenticated;
-- réservations : seules les fonctions publiques sont ouvertes ; les fonctions internes (_…) restent fermées
revoke all on function public._slot_free(timestamptz, uuid) from public, anon, authenticated;
revoke all on function public._day_hours(text, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public._bookings_tidy() from public, anon, authenticated;
revoke all on function public._player_of(text) from public, anon, authenticated;
revoke all on function public._coach_ok(text) from public, anon, authenticated;
revoke all on function public._player_action(text, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.book(text, text, uuid, timestamptz) from public;
revoke all on function public.bookings_mine(text) from public;
revoke all on function public.coach_bookings(text) from public;
revoke all on function public.coach_book(text, text, uuid, timestamptz, text) from public;
grant execute on function public.book(text, text, uuid, timestamptz) to anon, authenticated;
grant execute on function public.bookings_mine(text) to anon, authenticated;
grant execute on function public.coach_bookings(text) to anon, authenticated;
grant execute on function public.coach_book(text, text, uuid, timestamptz, text) to anon, authenticated;
